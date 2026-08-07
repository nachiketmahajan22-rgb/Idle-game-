"""Mean-reversion pullback strategy — the alternative to the Donchian
breakout, built for the choppy/range-bound conditions the breakout
strategy struggles in (see README for the backtest comparison).

Rules (adapted from a publicly-described NSE swing mean-reversion
approach, "Cracking Markets" — https://crackingmarkets.substack.com/p/swing-mean-reversion-strategies-in):

  1. Shortlist: price above its long-term trend SMA (still an uptrend on a
     longer horizon), liquid (`min_avg_volume`), and volatile enough to be
     worth trading (`mr_min_atr_pct` floor on ATR5/close).
  2. Signal: yesterday's close pulled below `MA5 - mr_entry_atr_multiple x
     ATR5` — a short-term oversold dip within the longer uptrend.
  3. Entry: a limit order today at `signal_close - mr_limit_atr_multiple x
     ATR5`, valid for one trading day only (today). If today's low never
     reaches that price, the signal expires unfilled — no chasing.
  4. Exit: whichever comes first — a hard stop at `entry -
     mr_stop_atr_multiple x ATR5` (added on top of the original rule set,
     which relied only on the time exit below — a bad gap-down needs a
     real stop), the first day price closes higher than the previous
     day's close ("first rising day"), or `mr_max_hold_days` elapsed.

Long only — mean-reversion shorts (rallies above `MA5 + N*ATR5` in a
downtrend) aren't implemented since `allow_shorts: false` is the default
for the same CNC-delivery reason as the breakout strategy.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pandas as pd

from swing_agent.config import Config
from swing_agent.strategy import indicators as ind
from swing_agent.strategy.screener import ScreenResult


def screen_symbol_mr(symbol: str, ohlcv: pd.DataFrame, config: Config) -> ScreenResult:
    """Trend + liquidity + volatility shortlist for the mean-reversion
    strategy. Evaluated on the full `ohlcv` passed in (typically data
    through yesterday's close, matching how the caller screens before
    checking today's signal)."""
    required_cols = {"open", "high", "low", "close", "volume"}
    missing = required_cols - set(ohlcv.columns)
    if missing:
        raise ValueError(f"ohlcv missing columns: {missing}")

    min_history = max(config.trend_sma_period, config.mr_atr_period) + 1
    if len(ohlcv) < min_history:
        return ScreenResult(symbol, False, ["insufficient history"])

    close = ohlcv["close"]
    sma_trend = float(ind.sma(close, config.trend_sma_period).iloc[-1])
    atr = float(ind.atr(ohlcv["high"], ohlcv["low"], close, config.mr_atr_period).iloc[-1])
    avg_vol = float(ohlcv["volume"].rolling(20, min_periods=20).mean().iloc[-1])
    last_close = float(close.iloc[-1])

    reasons: list[str] = []
    if pd.isna(sma_trend) or last_close <= sma_trend:
        reasons.append(f"price not above {config.trend_sma_period}-day trend SMA")
    if pd.isna(avg_vol) or avg_vol < config.min_avg_volume:
        got = f"{avg_vol:,.0f}" if pd.notna(avg_vol) else "n/a"
        reasons.append(f"avg volume {got} below liquidity floor {config.min_avg_volume:,.0f}")
    if pd.isna(atr) or (atr / last_close) < config.mr_min_atr_pct:
        got = f"{atr / last_close * 100:.2f}%" if pd.notna(atr) else "n/a"
        reasons.append(f"ATR {got} below volatility floor {config.mr_min_atr_pct * 100:.2f}%")

    return ScreenResult(symbol=symbol, passed=(len(reasons) == 0), reasons_failed=reasons,
                         close=last_close, sma=sma_trend)


@dataclass
class PullbackSignal:
    symbol: str
    triggered: bool
    limit_price: Optional[float] = None
    stop_loss: Optional[float] = None
    reason: str = ""


def detect_pullback_signal(symbol: str, ohlcv: pd.DataFrame, config: Config) -> PullbackSignal:
    """Looks at the most recent completed bar to decide whether a pullback
    signal fired — the resulting limit order/stop is meant to be attempted
    on the *next* trading day (see `check_limit_fill`), not today."""
    if len(ohlcv) < config.mr_ma_period + 1:
        return PullbackSignal(symbol, False, reason="insufficient history")

    close = ohlcv["close"]
    ma = float(ind.sma(close, config.mr_ma_period).iloc[-1])
    atr = float(ind.atr(ohlcv["high"], ohlcv["low"], close, config.mr_atr_period).iloc[-1])
    last_close = float(close.iloc[-1])

    if pd.isna(ma) or pd.isna(atr):
        return PullbackSignal(symbol, False, reason="MA/ATR not yet available")

    threshold = ma - config.mr_entry_atr_multiple * atr
    if last_close >= threshold:
        return PullbackSignal(symbol, False, reason=f"close {last_close:.2f} not below pullback threshold {threshold:.2f}")

    limit_price = last_close - config.mr_limit_atr_multiple * atr
    stop_loss = limit_price - config.mr_stop_atr_multiple * atr
    return PullbackSignal(symbol, True, limit_price=limit_price, stop_loss=stop_loss,
                           reason=f"close {last_close:.2f} pulled below MA{config.mr_ma_period}-ATR band ({threshold:.2f})")


def check_limit_fill(limit_price: float, today_low: float) -> bool:
    """A resting buy-limit order fills if the day's low reaches (or goes
    below) the limit price. Optimistic assumption (no slippage/queue
    priority modeled) -- see README for the caveat."""
    return today_low <= limit_price


def check_exit(
    *,
    entry_price: float,
    stop_loss: float,
    entry_date,
    ohlcv: pd.DataFrame,
    config: Config,
) -> tuple[Optional[float], Optional[str]]:
    """Returns (exit_price, exit_reason) if the position should close
    today, or (None, None) to keep holding. `ohlcv` must include today as
    its last row and enough history to look back to `entry_date`."""
    today = ohlcv.index[-1]
    today_low = float(ohlcv["low"].iloc[-1])
    today_close = float(ohlcv["close"].iloc[-1])

    if today_low <= stop_loss:
        return stop_loss, "stop_loss"

    entry_ts = pd.Timestamp(entry_date)  # normalizes both a "YYYY-MM-DD" string (live/paper, from JSON) and a pd.Timestamp (backtest)
    since_entry = ohlcv.loc[ohlcv.index >= entry_ts]
    days_held = len(since_entry) - 1  # entry day itself doesn't count as a day held
    if days_held <= 0:
        return None, None  # can't exit on the entry day itself

    prev_close = float(ohlcv["close"].iloc[-2])
    if today_close > prev_close:
        return today_close, "rising_day"
    if days_held >= config.mr_max_hold_days:
        return today_close, "max_hold"
    return None, None
