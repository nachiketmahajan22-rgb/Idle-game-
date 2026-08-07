"""Entry trigger: a daily close beyond the prior `lookback_range_days`-day
range (a Donchian-channel breakout — the same mechanic as Kar's "close
beyond previous day/month's range" and the classic Turtle Trading entry).

Two config-driven choices affect *where the stop and target go*, not
whether a breakout fires:

  - `stop_method: atr` (recommended default): stop = entry -/+
    `atr_stop_multiple` x ATR. Scales with the stock's actual volatility,
    so it's never accidentally tiny the way a single candle's wick can be
    (a skinny wick gives a razor-thin stop, which forces a huge
    risk-sized position — a real bug this replaced).
    `stop_method: candle` (Kar-style): stop at the breakout bar's opposite
    extreme (low for longs, high for shorts).

  - `use_fixed_target: false` (recommended default): no fixed take-profit;
    the trailing stop harvests the trade, letting winners run — standard
    trend-following practice, since a fixed target caps upside on the
    trades that matter most.
    `use_fixed_target: true` (Kar-style): projects the range height above
    entry as a fixed target.

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
    min_history = config.lookback_range_days
    if config.stop_method == "atr":
        min_history = max(min_history, config.atr_period)
    min_history += 2
    if len(ohlcv) < min_history:
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

    atr_val = None
    if config.stop_method == "atr":
        atr_val = float(ind.atr(high, low, close, config.atr_period).iloc[-1])
        if pd.isna(atr_val) or atr_val <= 0:
            return BreakoutSignal(symbol, False, reason="ATR not yet available")

    if check_price > prior_high:
        entry = last_close
        if config.stop_method == "atr":
            stop = entry - config.atr_stop_multiple * atr_val
        elif config.stop_method == "candle":
            # Kar-style: stop at the breakout bar's low (the setup's
            # structural invalidation point), never moved against the trade.
            stop = last_low
        else:
            raise ValueError(f"unknown stop_method: {config.stop_method!r} (expected 'atr' or 'candle')")
        if stop >= entry:
            return BreakoutSignal(symbol, False, reason="computed stop is not below entry; unsafe stop")
        target = entry + range_height if config.use_fixed_target else None
        return BreakoutSignal(symbol, True, side="long", entry_price=entry, stop_loss=stop, target_price=target,
                               reason=f"close {entry:.2f} broke above prior range high {float(prior_high):.2f}")

    if check_price_short < prior_low:
        entry = last_close
        if config.stop_method == "atr":
            stop = entry + config.atr_stop_multiple * atr_val
        elif config.stop_method == "candle":
            stop = last_high
        else:
            raise ValueError(f"unknown stop_method: {config.stop_method!r} (expected 'atr' or 'candle')")
        if stop <= entry:
            return BreakoutSignal(symbol, False, reason="computed stop is not above entry; unsafe stop")
        target = entry - range_height if config.use_fixed_target else None
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
    is only touched to lock in profit, never to give a trade more room.

    `trail_method: 'breakeven'` locks the stop at entry once the trade
    reaches `trail_after_r_multiple`, *then keeps ratcheting it up via ATR*
    as price extends further — breakeven is a floor it will never fall
    below, not a permanent freeze. (An earlier version returned a constant
    `entry_price` candidate forever once armed, which meant a trade could
    never close as a realized win: it either stopped out for a loss, ran
    unrealized indefinitely, or gave back to exactly breakeven for a $0
    scratch. Caught via backtesting — every trade in a real run exited via
    stop_loss_hit, ~40% at a price identical to entry to the last decimal.)
    `trail_method: 'atr'` trails continuously by ATR with no breakeven
    floor, so it can sit below entry briefly on a fresh, volatile breakout.
    """
    close = float(ohlcv["close"].iloc[-1])
    risk_per_share = abs(entry_price - initial_stop)
    if risk_per_share <= 0:
        return current_stop

    r_multiple = ((close - entry_price) / risk_per_share) if side == "long" else ((entry_price - close) / risk_per_share)
    if r_multiple < config.trail_after_r_multiple:
        return current_stop  # not yet in enough profit to trail

    if config.trail_method not in ("breakeven", "atr"):
        raise ValueError(f"unknown trail_method: {config.trail_method!r} (expected 'breakeven' or 'atr')")

    atr_series = ind.atr(ohlcv["high"], ohlcv["low"], ohlcv["close"], config.atr_period)
    atr_val = float(atr_series.iloc[-1]) if pd.notna(atr_series.iloc[-1]) else None

    if atr_val is None:
        # Not enough history for ATR yet -- fall back to the breakeven floor
        # alone (for 'breakeven') or hold the current stop (for 'atr').
        candidate = entry_price if config.trail_method == "breakeven" else current_stop
    else:
        atr_candidate = close - config.atr_trail_multiple * atr_val if side == "long" else close + config.atr_trail_multiple * atr_val
        candidate = (max(entry_price, atr_candidate) if side == "long" else min(entry_price, atr_candidate)) \
            if config.trail_method == "breakeven" else atr_candidate

    if side == "long":
        return max(current_stop, candidate)
    return min(current_stop, candidate)
