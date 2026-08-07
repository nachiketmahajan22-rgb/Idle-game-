"""Plain-pandas technical indicators — no extra TA library dependency needed.

Every function takes/returns pandas Series indexed the same as the input
OHLCV DataFrame, oldest row first.
"""
from __future__ import annotations

import pandas as pd


def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(window=period, min_periods=period).mean()


def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    # Wilder's smoothing (matches the RSI most charting platforms show)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()

    rs = avg_gain / avg_loss.replace(0, pd.NA)
    out = 100 - (100 / (1 + rs))
    return out.fillna(100)  # avg_loss == 0 means pure upside -> RSI 100


def macd(series: pd.Series, fast: int = 12, slow: int = 26, signal: int = 9) -> pd.DataFrame:
    ema_fast = series.ewm(span=fast, adjust=False).mean()
    ema_slow = series.ewm(span=slow, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=signal, adjust=False).mean()
    hist = macd_line - signal_line
    return pd.DataFrame({"macd": macd_line, "signal": signal_line, "hist": hist})


def atr(high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14) -> pd.Series:
    prev_close = close.shift(1)
    tr = pd.concat(
        [
            (high - low),
            (high - prev_close).abs(),
            (low - prev_close).abs(),
        ],
        axis=1,
    ).max(axis=1)
    return tr.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()


def rolling_range_high(high: pd.Series, period: int, exclude_current: bool = True) -> pd.Series:
    """Highest high over the trailing `period` bars, excluding today's bar
    by default (so 'breakout of prior range' doesn't look at itself)."""
    base = high.shift(1) if exclude_current else high
    return base.rolling(window=period, min_periods=period).max()


def rolling_range_low(low: pd.Series, period: int, exclude_current: bool = True) -> pd.Series:
    base = low.shift(1) if exclude_current else low
    return base.rolling(window=period, min_periods=period).min()


def volume_surge_ratio(volume: pd.Series, period: int = 20) -> pd.Series:
    avg_vol = volume.rolling(window=period, min_periods=period).mean().shift(1)
    return volume / avg_vol.replace(0, pd.NA)
