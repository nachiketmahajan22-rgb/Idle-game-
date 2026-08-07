"""Zerodha Kite Connect broker — places REAL orders with REAL money.

Only ever instantiated by agent.py when `config.is_live` is True, which
requires BOTH `live_trading: true` in settings.yaml AND `LIVE_TRADING=true`
in the environment. Even then, agent.py asks for a typed confirmation
before the first order of a run.

Kite access tokens expire daily. Run the login flow each morning:

    python -c "from swing_agent.broker.kite_broker import print_login_url; print_login_url()"

then, after logging in and being redirected, exchange the `request_token`
from the redirect URL for an access token:

    python -c "from swing_agent.broker.kite_broker import generate_session; generate_session('<request_token>')"

and paste the printed access token into .env as KITE_ACCESS_TOKEN.
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

from swing_agent.broker.base import BrokerInterface, OrderResult, OrderSide, Position

try:
    from kiteconnect import KiteConnect
except ImportError:  # pragma: no cover - only needed when actually going live
    KiteConnect = None  # type: ignore


def _require_kiteconnect():
    if KiteConnect is None:
        raise ImportError("kiteconnect is not installed. Run: pip install kiteconnect")


def print_login_url(api_key: str | None = None) -> str:
    _require_kiteconnect()
    api_key = api_key or os.environ["KITE_API_KEY"]
    kite = KiteConnect(api_key=api_key)
    url = kite.login_url()
    print(url)
    return url


def generate_session(request_token: str, api_key: str | None = None, api_secret: str | None = None) -> str:
    _require_kiteconnect()
    api_key = api_key or os.environ["KITE_API_KEY"]
    api_secret = api_secret or os.environ["KITE_API_SECRET"]
    kite = KiteConnect(api_key=api_key)
    session = kite.generate_session(request_token, api_secret=api_secret)
    access_token = session["access_token"]
    print(f"KITE_ACCESS_TOKEN={access_token}")
    return access_token


class KiteBroker(BrokerInterface):
    def __init__(self, api_key: str, access_token: str):
        _require_kiteconnect()
        if not api_key or not access_token:
            raise ValueError("KiteBroker requires a non-empty api_key and access_token")
        self.kite = KiteConnect(api_key=api_key)
        self.kite.set_access_token(access_token)

    @property
    def is_simulated(self) -> bool:
        return False

    def get_ltp(self, symbol: str) -> float:
        quote_key = f"NSE:{symbol}"
        data = self.kite.ltp([quote_key])
        return float(data[quote_key]["last_price"])

    def get_available_margin(self) -> float:
        margins = self.kite.margins(segment="equity")
        return float(margins["available"]["live_balance"])

    def get_positions(self) -> list[Position]:
        # Kite's positions API returns overnight ('day'/'net') holdings for
        # CNC products; we map that into our generic Position shape.
        raw = self.kite.positions().get("net", [])
        out = []
        for p in raw:
            qty = int(p.get("quantity", 0))
            if qty == 0:
                continue
            out.append(Position(
                symbol=p["tradingsymbol"],
                side="long" if qty > 0 else "short",
                quantity=abs(qty),
                entry_price=float(p.get("average_price", 0.0)),
                stop_loss=0.0,       # Kite doesn't track our strategy's stop; agent.py keeps that in its own state file
                target_price=None,
                opened_at=datetime.now(timezone.utc),
            ))
        return out

    def place_order(self, symbol: str, side: OrderSide, quantity: int, order_type: str = "MARKET", product: str = "CNC") -> OrderResult:
        order_id = self.kite.place_order(
            variety=self.kite.VARIETY_REGULAR,
            exchange=self.kite.EXCHANGE_NSE,
            tradingsymbol=symbol,
            transaction_type=side,  # "BUY" / "SELL"
            quantity=quantity,
            order_type=order_type,
            product=product,
        )
        price = self.get_ltp(symbol)
        return OrderResult(
            order_id=str(order_id), symbol=symbol, side=side, quantity=quantity,
            price=price, status="PLACED", timestamp=datetime.now(timezone.utc), simulated=False,
        )
