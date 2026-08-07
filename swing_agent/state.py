"""Strategy-level position state: entry, stop-loss, target, and side per
open symbol. Neither broker knows about our stop-loss/target (a raw
brokerage account just holds shares), so this is tracked independently and
persisted to JSON — shared by both PaperBroker and KiteBroker runs.

Also records closed-trade P&L for the daily-loss circuit breaker and for
after-the-fact performance review.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional


@dataclass
class OpenPosition:
    symbol: str
    side: Literal["long", "short"]
    quantity: int
    entry_price: float
    stop_loss: float
    target_price: Optional[float]
    opened_at: str


@dataclass
class ClosedTrade:
    symbol: str
    side: Literal["long", "short"]
    quantity: int
    entry_price: float
    exit_price: float
    pnl: float
    opened_at: str
    closed_at: str
    exit_reason: str


class StrategyState:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._data = self._load()

    def _load(self) -> dict:
        if self.path.exists():
            with open(self.path, "r") as f:
                return json.load(f)
        return {"positions": {}, "closed_trades": []}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w") as f:
            json.dump(self._data, f, indent=2, default=str)

    def open_symbols(self) -> set[str]:
        return set(self._data["positions"].keys())

    def count_open(self) -> int:
        return len(self._data["positions"])

    def get(self, symbol: str) -> Optional[OpenPosition]:
        p = self._data["positions"].get(symbol)
        return OpenPosition(**p) if p else None

    def all_open(self) -> list[OpenPosition]:
        return [OpenPosition(**p) for p in self._data["positions"].values()]

    def open_position(self, symbol: str, side: str, quantity: int, entry_price: float, stop_loss: float, target_price: Optional[float]) -> None:
        pos = OpenPosition(
            symbol=symbol, side=side, quantity=quantity, entry_price=entry_price,
            stop_loss=stop_loss, target_price=target_price,
            opened_at=datetime.now(timezone.utc).isoformat(),
        )
        self._data["positions"][symbol] = asdict(pos)
        self._save()

    def update_stop(self, symbol: str, new_stop: float) -> None:
        if symbol in self._data["positions"]:
            self._data["positions"][symbol]["stop_loss"] = new_stop
            self._save()

    def close_position(self, symbol: str, exit_price: float, exit_reason: str) -> Optional[ClosedTrade]:
        raw = self._data["positions"].pop(symbol, None)
        if raw is None:
            return None
        pos = OpenPosition(**raw)
        direction = 1 if pos.side == "long" else -1
        pnl = (exit_price - pos.entry_price) * pos.quantity * direction
        trade = ClosedTrade(
            symbol=symbol, side=pos.side, quantity=pos.quantity,
            entry_price=pos.entry_price, exit_price=exit_price, pnl=pnl,
            opened_at=pos.opened_at, closed_at=datetime.now(timezone.utc).isoformat(),
            exit_reason=exit_reason,
        )
        self._data["closed_trades"].append(asdict(trade))
        self._save()
        return trade

    def realized_pnl_today(self) -> float:
        today = datetime.now(timezone.utc).date().isoformat()
        return sum(
            t["pnl"] for t in self._data["closed_trades"]
            if str(t["closed_at"]).startswith(today)
        )

    def closed_trades(self) -> list[ClosedTrade]:
        return [ClosedTrade(**t) for t in self._data["closed_trades"]]
