"""Simulated broker — the default execution backend. Places no real orders;
fills instantly at the given price (or a supplied live/last price) and
persists state to a local JSON file so cash/positions survive across daily
runs.

This mirrors what a real broker actually knows: quantity and average entry
price. It does NOT track our strategy's stop-loss/target — that's
strategy-specific state the broker has no concept of, so (same as
KiteBroker) it's kept by `swing_agent.state.StrategyState` instead. This
is intentionally simple (no slippage/partial-fill modeling) — good enough
to validate the *logic* of the agent end-to-end before ever touching a real
broker. For realistic performance estimates, use `backtest.py` instead,
which replays historical bars.
"""
from __future__ import annotations

import json
import uuid
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from swing_agent.broker.base import BrokerInterface, OrderResult, OrderSide, Position
from swing_agent.config import Config


class PaperBroker(BrokerInterface):
    def __init__(self, state_file: Path, price_provider: Callable[[str], float], starting_cash: float, config: Optional[Config] = None):
        self.state_file = Path(state_file)
        self.price_provider = price_provider
        self.config = config  # if None, orders fill at zero transaction cost
        self._state = self._load_state(starting_cash)

    # -- persistence --------------------------------------------------
    def _load_state(self, starting_cash: float) -> dict:
        if self.state_file.exists():
            with open(self.state_file, "r") as f:
                return json.load(f)
        return {"cash": starting_cash, "positions": {}, "trade_log": []}

    def _save_state(self) -> None:
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.state_file, "w") as f:
            json.dump(self._state, f, indent=2, default=str)

    # -- BrokerInterface ------------------------------------------------
    @property
    def is_simulated(self) -> bool:
        return True

    def get_ltp(self, symbol: str) -> float:
        return self.price_provider(symbol)

    def get_available_margin(self) -> float:
        return float(self._state["cash"])

    def get_positions(self) -> list[Position]:
        out = []
        for sym, p in self._state["positions"].items():
            if p["quantity"] == 0:
                continue
            out.append(Position(
                symbol=sym,
                side="long" if p["quantity"] > 0 else "short",
                quantity=abs(p["quantity"]),
                entry_price=p["avg_price"],
                stop_loss=0.0,  # strategy stop is tracked in StrategyState, not here
                target_price=None,
                opened_at=datetime.fromisoformat(p["opened_at"]),
            ))
        return out

    def place_order(self, symbol: str, side: OrderSide, quantity: int, order_type: str = "MARKET", product: str = "CNC", price: float | None = None) -> OrderResult:
        price = price if price is not None else self.price_provider(symbol)
        now = datetime.now(timezone.utc)
        order_id = f"paper-{uuid.uuid4().hex[:10]}"
        signed_qty = quantity if side == "BUY" else -quantity
        trade_value = price * quantity

        txn_cost = 0.0
        if self.config is not None:
            from swing_agent.costs import buy_side_cost, sell_side_cost
            txn_cost = buy_side_cost(trade_value, self.config) if side == "BUY" else sell_side_cost(trade_value, self.config)

        if side == "BUY":
            self._state["cash"] -= (trade_value + txn_cost)
        else:
            self._state["cash"] += (trade_value - txn_cost)

        pos = self._state["positions"].get(symbol, {"quantity": 0, "avg_price": 0.0, "opened_at": now.isoformat()})
        old_qty = pos["quantity"]
        new_qty = old_qty + signed_qty

        if old_qty == 0:
            # opening a fresh position
            pos["avg_price"] = price
            pos["opened_at"] = now.isoformat()
        elif (old_qty > 0) == (signed_qty > 0):
            # adding to an existing position in the same direction -> blend average price
            total_cost = pos["avg_price"] * abs(old_qty) + price * abs(signed_qty)
            pos["avg_price"] = total_cost / (abs(old_qty) + abs(signed_qty))
        elif new_qty != 0 and (new_qty > 0) != (old_qty > 0):
            # reduced through zero and flipped direction in one order -> new leg opens at current price
            pos["avg_price"] = price
            pos["opened_at"] = now.isoformat()
        # else: partial or full close in the opposite direction -> avg_price unchanged

        pos["quantity"] = new_qty
        self._state["positions"][symbol] = pos

        result = OrderResult(
            order_id=order_id, symbol=symbol, side=side, quantity=quantity,
            price=price, status="COMPLETE", timestamp=now, simulated=True,
        )
        self._state["trade_log"].append({**asdict(result), "timestamp": now.isoformat()})
        self._save_state()
        return result

    def realized_pnl_today(self) -> float:
        """Cash-flow approximation: today's SELL proceeds minus today's BUY
        cost. Good enough for the daily-loss circuit breaker; not a
        substitute for proper FIFO P&L accounting."""
        today = datetime.now(timezone.utc).date().isoformat()
        buys, sells = 0.0, 0.0
        for t in self._state["trade_log"]:
            if not str(t["timestamp"]).startswith(today):
                continue
            amt = t["price"] * t["quantity"]
            if t["side"] == "BUY":
                buys += amt
            else:
                sells += amt
        return sells - buys
