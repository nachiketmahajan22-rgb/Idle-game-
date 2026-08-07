"""Stock shortlist ("correct stock selection" — the ~40% half of Kar's edge).

Approximates the public "Abhishek Kar Swing" Chartink screener's stated
inputs (RSI, MACD, PE, breakout, volume) using plain OHLCV data:

  - RSI in a bullish-but-not-overbought band (default 50-70): momentum is
    turning up without being stretched.
  - Price above its `sma_period` SMA: only trade with the trend.
  - MACD histogram positive: momentum confirmation.
  - Close within the configured lookback window's range breakout zone
    (within touching distance of the prior high) OR already breaking out.
  - Volume today (or most recent bar) above `volume_surge_multiple`x the
    20-day average: institutional participation, not a low-volume drift.

Fundamentals (PE, book value, dividend yield) aren't available from
OHLCV alone. `fundamentals_lookup` is an optional callable
(symbol -> dict) you can wire up to a data source; when absent, fundamental
filters are simply skipped.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional

import pandas as pd

from swing_agent.config import Config
from swing_agent.strategy import indicators as ind


@dataclass
class ScreenResult:
    symbol: str
    passed: bool
    reasons_failed: list[str]
    rsi: float | None = None
    close: float | None = None
    sma: float | None = None
    macd_hist: float | None = None
    volume_ratio: float | None = None
    prior_range_high: float | None = None
    prior_range_low: float | None = None


def screen_symbol(
    symbol: str,
    ohlcv: pd.DataFrame,
    config: Config,
    fundamentals_lookup: Optional[Callable[[str], dict]] = None,
) -> ScreenResult:
    """`ohlcv` must have columns: open, high, low, close, volume, sorted
    ascending by date, and enough history to cover the longest lookback
    (sma_period, lookback_range_days, rsi_period, macd 26+9)."""
    required_cols = {"open", "high", "low", "close", "volume"}
    missing = required_cols - set(ohlcv.columns)
    if missing:
        raise ValueError(f"ohlcv missing columns: {missing}")

    reasons: list[str] = []

    if len(ohlcv) < max(config.sma_period, config.lookback_range_days, config.rsi_period, 35) + 1:
        return ScreenResult(symbol, False, ["insufficient history"])

    close = ohlcv["close"]
    rsi_series = ind.rsi(close, config.rsi_period)
    sma_series = ind.sma(close, config.sma_period)
    macd_df = ind.macd(close)
    vol_ratio_series = ind.volume_surge_ratio(ohlcv["volume"], period=20)
    range_high = ind.rolling_range_high(ohlcv["high"], config.lookback_range_days)
    range_low = ind.rolling_range_low(ohlcv["low"], config.lookback_range_days)

    last_rsi = float(rsi_series.iloc[-1])
    last_close = float(close.iloc[-1])
    last_sma = float(sma_series.iloc[-1]) if pd.notna(sma_series.iloc[-1]) else None
    last_macd_hist = float(macd_df["hist"].iloc[-1])
    last_vol_ratio = float(vol_ratio_series.iloc[-1]) if pd.notna(vol_ratio_series.iloc[-1]) else None
    last_range_high = float(range_high.iloc[-1]) if pd.notna(range_high.iloc[-1]) else None
    last_range_low = float(range_low.iloc[-1]) if pd.notna(range_low.iloc[-1]) else None

    if not (config.rsi_min <= last_rsi <= config.rsi_max):
        reasons.append(f"RSI {last_rsi:.1f} outside [{config.rsi_min}, {config.rsi_max}]")

    if last_sma is None or last_close <= last_sma:
        reasons.append("price not above trend SMA")

    if last_macd_hist <= 0:
        reasons.append("MACD histogram not positive")

    if last_vol_ratio is None or last_vol_ratio < config.volume_surge_multiple:
        got = f"{last_vol_ratio:.2f}" if last_vol_ratio is not None else "n/a"
        reasons.append(f"volume ratio {got} below {config.volume_surge_multiple}x average")

    if last_range_high is not None and last_close < last_range_high * 0.98:
        # Not near (within 2%) or above the prior range high — no breakout in sight yet.
        reasons.append("price not near/above prior range high")

    if fundamentals_lookup is not None:
        try:
            fundamentals = fundamentals_lookup(symbol)
        except Exception:
            fundamentals = {}
        pe = fundamentals.get("pe")
        if pe is not None and pe > 60:
            reasons.append(f"PE {pe:.1f} too high")

    return ScreenResult(
        symbol=symbol,
        passed=(len(reasons) == 0),
        reasons_failed=reasons,
        rsi=last_rsi,
        close=last_close,
        sma=last_sma,
        macd_hist=last_macd_hist,
        volume_ratio=last_vol_ratio,
        prior_range_high=last_range_high,
        prior_range_low=last_range_low,
    )


def run_screener(
    universe: dict[str, pd.DataFrame],
    config: Config,
    fundamentals_lookup: Optional[Callable[[str], dict]] = None,
) -> list[ScreenResult]:
    """universe: {symbol: ohlcv_dataframe}. Returns results for every symbol
    (pass and fail) so callers can log/debug why a stock was excluded."""
    return [screen_symbol(sym, df, config, fundamentals_lookup) for sym, df in universe.items()]


def shortlist(results: list[ScreenResult]) -> list[ScreenResult]:
    return [r for r in results if r.passed]
