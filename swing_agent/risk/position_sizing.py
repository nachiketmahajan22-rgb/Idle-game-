"""Risk management: the ~50% of Kar's stated edge.

Rules encoded here:
  - Every trade risks a fixed, small % of capital (risk_pct_per_trade),
    regardless of the stock's price — so a ₹3000 stock and a ₹300 stock get
    proportionally sized quantities for identical account risk.
  - Stop-loss distance drives position size, not the other way around: we
    never size a trade first and then decide the stop.
  - A trade is skipped if quantity would round to zero, or if reward:risk
    is below the configured minimum.
  - Hard caps: max concurrent open positions, and a daily-loss circuit
    breaker that blocks new entries once today's realized loss exceeds a
    threshold.
"""
from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class PositionSize:
    quantity: int
    risk_amount: float
    reward_risk: float
    skipped_reason: str | None = None

    @property
    def is_valid(self) -> bool:
        return self.skipped_reason is None and self.quantity > 0


def size_position(
    *,
    capital: float,
    risk_pct_per_trade: float,
    entry_price: float,
    stop_loss_price: float,
    target_price: float | None,
    reward_risk_min: float,
    side: str = "long",
) -> PositionSize:
    """Compute share quantity for a fixed-fractional-risk trade.

    side: 'long' -> stop must be below entry; 'short' -> stop must be above entry.
    """
    if side not in ("long", "short"):
        raise ValueError(f"side must be 'long' or 'short', got {side!r}")

    stop_distance = (entry_price - stop_loss_price) if side == "long" else (stop_loss_price - entry_price)
    if stop_distance <= 0:
        return PositionSize(0, 0.0, 0.0, skipped_reason="stop_loss is on the wrong side of entry")

    risk_amount = capital * risk_pct_per_trade
    raw_qty = risk_amount / stop_distance
    quantity = math.floor(raw_qty)

    if quantity <= 0:
        return PositionSize(0, risk_amount, 0.0, skipped_reason="risk budget too small for one share at this stop distance")

    reward_risk = 0.0
    if target_price is not None:
        reward_distance = (target_price - entry_price) if side == "long" else (entry_price - target_price)
        reward_risk = reward_distance / stop_distance if stop_distance > 0 else 0.0
        if reward_risk < reward_risk_min:
            return PositionSize(quantity, risk_amount, reward_risk, skipped_reason=f"reward:risk {reward_risk:.2f} below minimum {reward_risk_min:.2f}")

    return PositionSize(quantity, risk_amount, reward_risk)


def cap_quantity_by_capital(quantity: int, entry_price: float, available_capital: float) -> int:
    """Fixed-fractional risk sizing can demand more capital than you have
    when the stop is very tight relative to price (a small risk_amount /
    small stop_distance still yields a huge share count). Cap the share
    count so the order never costs more than what's actually available —
    this changes the trade's realized risk% below the target, it never
    lets it exceed the capital on hand."""
    if entry_price <= 0:
        return 0
    max_affordable = math.floor(available_capital / entry_price)
    return max(0, min(quantity, max_affordable))


@dataclass
class ExposureGuard:
    """Circuit breakers evaluated before every new entry."""

    max_open_positions: int
    max_daily_loss_pct: float
    capital: float

    def can_open_new_position(self, *, currently_open: int, realized_pnl_today: float) -> tuple[bool, str | None]:
        if currently_open >= self.max_open_positions:
            return False, f"max_open_positions ({self.max_open_positions}) reached"

        daily_loss_limit = -abs(self.max_daily_loss_pct) * self.capital
        if realized_pnl_today <= daily_loss_limit:
            return False, f"daily loss circuit breaker tripped ({realized_pnl_today:.2f} <= {daily_loss_limit:.2f})"

        return True, None
