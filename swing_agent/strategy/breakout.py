"""Pure price-action entry/exit trigger — Kar's core, indicator-free method:
a daily close beyond the prior range (previous day's high/low, or the
`lookback_range_days` window approximating "previous month's range").

This module only decides *if/where* to enter and *where* the initial stop
goes; `swing_agent/risk/position_sizing.py` turns that into a share
quantity, and trailing-stop management for open positions also lives here
so agent.py can call one function per day per open trade.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional

import pandas as pd

from swing_agent.config import Config
from swing_agent.strategy import indicators as ind

Side = Literal["long", "short"]


@dataclass
class BreakoutSignal:
    symbol: str
    triggered: bool
    side: Optional[Side] = None
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    target_price: Optional[float] = None
    reason: str = ""


def detect_breakout(symbol: str, ohlcv: pd.DataFrame, config: Config) -> BreakoutSignal:
    """Looks at the most recent completed bar only — call this once per
    trading day after the close (or, per Kar's timing guidance, near the
    end of the session on the live/forming bar if you want same-day fills).
    """
    if len(ohlcv) < config.lookback_range_days + 2:
        return BreakoutSignal(symbol, False, reason="insufficient history")

    high, low, close = ohlcv["high"], ohlcv["low"], ohlcv["close"]
    range_high = ind.rolling_range_high(high, config.lookback_range_days)
    range_low = ind.rolling_range_low(low, config.lookback_range_days)

    prior_high = range_high.iloc[-1]
    prior_low = range_low.iloc[-1]
    if pd.isna(prior_high) or pd.isna(prior_low):
        return BreakoutSignal(symbol, False, reason="range not yet established")

    last_close = float(close.iloc[-1])
    last_high = float(high.iloc[-1])
    last_low = float(low.iloc[-1])

    check_price = last_close if config.breakout_confirmation == "close" else last_high
    check_price_short = last_close if config.breakout_confirmation == "close" else last_low

    range_height = float(prior_high - prior_low)
    if range_height <= 0:
        return BreakoutSignal(symbol, False, reason="degenerate range (high <= low)")

    if check_price > prior_high:
        # Long breakout: stop below the breakout bar's low (Kar's rule: stop
        # placed at the setup's structural invalidation point, never moved
        # against the trade), target projects the range height above entry.
        entry = last_close
        stop = last_low
        if stop >= entry:
            return BreakoutSignal(symbol, False, reason="breakout bar low is not below close; unsafe stop")
        target = entry + range_height
        return BreakoutSignal(symbol, True, side="long", entry_price=entry, stop_loss=stop, target_price=target,
                               reason=f"close {entry:.2f} broke above prior range high {float(prior_high):.2f}")

    if check_price_short < prior_low:
        entry = last_close
        stop = last_high
        if stop <= entry:
            return BreakoutSignal(symbol, False, reason="breakout bar high is not above close; unsafe stop")
        target = entry - range_height
        return BreakoutSignal(symbol, True, side="short", entry_price=entry, stop_loss=stop, target_price=target,
                               reason=f"close {entry:.2f} broke below prior range low {float(prior_low):.2f}")

    return BreakoutSignal(symbol, False, reason="no breakout of prior range yet")


def update_trailing_stop(
    *,
    side: Side,
    entry_price: float,
    initial_stop: float,
    current_stop: float,
    ohlcv: pd.DataFrame,
    config: Config,
) -> float:
    """Returns the new stop-loss for an open position. Never returns a stop
    that would widen risk (long: never lower than current_stop; short:
    never higher) — trailing only ever tightens, per Kar's rule that a stop
    is only touched to lock in profit, never to give a trade more room."""
    close = float(ohlcv["close"].iloc[-1])
    risk_per_share = abs(entry_price - initial_stop)
    if risk_per_share <= 0:
        return current_stop

    r_multiple = ((close - entry_price) / risk_per_share) if side == "long" else ((entry_price - close) / risk_per_share)
    if r_multiple < config.trail_after_r_multiple:
        return current_stop  # not yet in enough profit to trail

    if config.trail_method == "breakeven":
        candidate = entry_price
    elif config.trail_method == "atr":
        atr_val = float(ind.atr(ohlcv["high"], ohlcv["low"], ohlcv["close"], config.atr_period).iloc[-1])
        candidate = close - config.atr_trail_multiple * atr_val if side == "long" else close + config.atr_trail_multiple * atr_val
    else:
        raise ValueError(f"unknown trail_method: {config.trail_method}")

    if side == "long":
        return max(current_stop, candidate)
    return min(current_stop, candidate)
