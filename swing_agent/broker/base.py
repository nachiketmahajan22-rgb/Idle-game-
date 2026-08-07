"""Broker-agnostic interface. Every execution backend (paper, Kite, and any
future broker) implements this so `agent.py` never talks to a broker SDK
directly — swap brokers by changing config, not code.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional

OrderSide = Literal["BUY", "SELL"]


@dataclass
class OrderResult:
    order_id: str
    symbol: str
    side: OrderSide
    quantity: int
    price: float
    status: str
    timestamp: datetime
    simulated: bool


@dataclass
class Position:
    symbol: str
    side: Literal["long", "short"]
    quantity: int
    entry_price: float
    stop_loss: float
    target_price: Optional[float]
    opened_at: datetime


class BrokerInterface(ABC):
    """All prices are in ₹, all quantities are whole shares (NSE has no
    fractional shares)."""

    @abstractmethod
    def get_ltp(self, symbol: str) -> float:
        """Last traded price for a symbol."""

    @abstractmethod
    def place_order(self, symbol: str, side: OrderSide, quantity: int, order_type: str = "MARKET", product: str = "CNC", price: Optional[float] = None) -> OrderResult:
        """Place an order. Paper implementations simulate the fill; live
        implementations submit to the real exchange.

        `price`: for a MARKET order this is ignored by KiteBroker (the
        exchange decides the fill price) but PaperBroker fills at exactly
        this price when given, instead of querying a live/last price —
        pass the strategy's own computed entry/exit price (e.g. a
        mean-reversion limit price) so the simulated fill and the
        strategy's own bookkeeping never silently diverge. For a LIMIT
        order, `price` is the limit price submitted to the exchange."""

    @abstractmethod
    def get_positions(self) -> list[Position]:
        """Currently open positions held by this strategy."""

    @abstractmethod
    def get_available_margin(self) -> float:
        """Cash/margin available for new positions."""

    @property
    @abstractmethod
    def is_simulated(self) -> bool:
        """True for paper brokers — used to double-check real money is
        never at risk unless explicitly configured."""
