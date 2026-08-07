"""Transaction cost model for NSE equity delivery (CNC) trades.

Modeled on a standard Indian discount-broker fee schedule (₹0 delivery
brokerage — the norm since Zerodha popularized it, matched by most
competitors), current as of 2026:

  - Brokerage: ₹0 for delivery/CNC (intraday/F&O are not modeled here —
    this agent only trades delivery, see order_product in settings.yaml).
  - STT (Securities Transaction Tax): 0.1% on BOTH the buy and sell value.
  - Stamp duty: 0.015% of buy value, buy side only.
  - Exchange transaction charges: 0.00345% of trade value, both sides.
  - GST: 18% on (brokerage + exchange transaction charges).
  - DP (Depository Participant) charges: a flat fee per scrip per day sold
    (charged by the depository for debiting shares from your demat
    account), independent of quantity or trade value.

These add up to a small percentage on a single round trip, but compound
fast for a strategy that trades often — a mean-reversion strategy with a
short average hold and a high trade count pays proportionally far more in
DP charges (a flat fee per trade) than a low-frequency breakout strategy
holding for weeks. All rates are configurable in `config/settings.yaml`
so this stays accurate if your broker's fee schedule differs.
"""
from __future__ import annotations

from dataclasses import dataclass

from swing_agent.config import Config


@dataclass
class TradeCosts:
    buy_side: float
    sell_side: float

    @property
    def total(self) -> float:
        return self.buy_side + self.sell_side


def buy_side_cost(trade_value: float, config: Config) -> float:
    stt = trade_value * config.stt_pct
    stamp_duty = trade_value * config.stamp_duty_pct
    exchange_txn = trade_value * config.exchange_txn_pct
    gst = (config.brokerage_flat + exchange_txn) * config.gst_pct
    return config.brokerage_flat + stt + stamp_duty + exchange_txn + gst


def sell_side_cost(trade_value: float, config: Config) -> float:
    stt = trade_value * config.stt_pct
    exchange_txn = trade_value * config.exchange_txn_pct
    gst = (config.brokerage_flat + exchange_txn) * config.gst_pct
    return config.brokerage_flat + stt + exchange_txn + gst + config.dp_charge_flat


def round_trip_cost(entry_price: float, exit_price: float, quantity: int, config: Config) -> TradeCosts:
    """Total cost of opening AND closing one position. Use `buy_side_cost`/
    `sell_side_cost` directly if you need to charge each leg as it happens
    (e.g. in a live/paper broker) rather than all at once."""
    return TradeCosts(
        buy_side=buy_side_cost(entry_price * quantity, config),
        sell_side=sell_side_cost(exit_price * quantity, config),
    )
