"""Market-regime and relative-strength filters — the two ingredients every
well-established trend-following screening system checks that this repo's
screeners didn't (Mark Minervini's Trend Template, William O'Neil's
CANSLIM/IBD): trade only when the broader market itself is healthy, and
only in stocks actually leading it, not just drifting up with it.

Pure functions, no I/O and no `Config` dependency (matching
`swing_agent/strategy/indicators.py`'s style) — callers fetch the
benchmark index's OHLCV once per run/backtest and pass its `close` series
in here.
"""
from __future__ import annotations

import pandas as pd

from swing_agent.strategy import indicators as ind


def index_above_sma(index_close: pd.Series, period: int) -> pd.Series:
    """Boolean series: True on days the index closed above its own
    `period`-day SMA — the market-regime signal. NaN (insufficient
    history) is treated as False (no regime confirmation yet)."""
    sma = ind.sma(index_close, period)
    return (index_close > sma).fillna(False)


def _weighted_roc(close: pd.Series, lookback_days: int) -> pd.Series:
    """IBD-style relative-strength input: a 63/126/189/252-day (~1/2/3/4
    quarter) weighted rate-of-change, weighted 40/20/20/20 toward the most
    recent quarter. `lookback_days` scales those four windows
    proportionally (default 252 reproduces IBD's exact windows)."""
    w = [(0.4, 0.25), (0.2, 0.5), (0.2, 0.75), (0.2, 1.0)]
    total = pd.Series(0.0, index=close.index)
    for weight, frac in w:
        period = max(1, round(lookback_days * frac))
        roc = close.pct_change(periods=period)
        total = total + weight * roc
    return total


def relative_strength(stock_close: pd.Series, index_close: pd.Series, lookback_days: int = 252) -> pd.Series:
    """Stock's weighted rate-of-change minus the index's, over the same
    calendar window — positive means the stock is outperforming the
    market, not just moving with it. `index_close` is reindexed onto the
    stock's calendar (forward-filled) so the two series always align even
    if their trading calendars differ slightly."""
    index_aligned = index_close.reindex(stock_close.index).ffill()
    stock_roc = _weighted_roc(stock_close, lookback_days)
    index_roc = _weighted_roc(index_aligned, lookback_days)
    return stock_roc - index_roc
