"""Stock shortlist — the "correct stock selection" half of the strategy's
edge. Two modes, selected by `config.screener_mode`:

  - "simple" (recommended default): a long-term trend filter (price above
    its `trend_sma_period` SMA, e.g. 200-day) plus a liquidity floor
    (`min_avg_volume`). Two robust, well-established conditions instead of
    five correlated indicator thresholds stacked together — fewer knobs
    means less risk of curve-fitting the backtest and a strategy that's
    easier to reason about when it's wrong.

  - "full": approximates the public "Abhishek Kar Swing" Chartink
    screener's stated inputs (RSI, MACD, breakout proximity, volume) using
    plain OHLCV data. Kept for comparison/backtesting against the simple
    mode, not because it's the recommended default.

Fundamentals (PE, book value, dividend yield) aren't available from
OHLCV alone. `fundamentals_lookup` is an optional callable
(symbol -> dict) you can wire up to a data source; when absent, fundamental
filters are simply skipped. Only used by "full" mode.

On top of either mode, two more gates apply uniformly when enabled (see
`swing_agent/strategy/regime.py`):

  - `use_regime_filter`: the benchmark index itself must be above its own
    `regime_sma_period` SMA — don't trade individual breakouts while the
    broader market is choppy/declining, regardless of how good one stock
    looks in isolation.
  - `use_relative_strength_filter`: the stock's IBD-style relative strength
    vs. the benchmark index must clear `rs_min_relative_return` — only
    trade stocks actually leading the market, not merely moving with it.

Both need the benchmark index's OHLCV passed in as `index_ohlcv`; if either
flag is on and `index_ohlcv` is missing, `screen_symbol` raises rather than
silently skipping the check — a wiring bug here should be loud, since the
whole point is not trading in a bad regime.
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import Callable, Optional

import pandas as pd

from swing_agent.config import Config
from swing_agent.strategy import indicators as ind
from swing_agent.strategy import regime as regime_mod


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
    avg_volume: float | None = None
    prior_range_high: float | None = None
    prior_range_low: float | None = None
    regime_ok: bool | None = None
    relative_strength: float | None = None


def _validate(ohlcv: pd.DataFrame) -> None:
    required_cols = {"open", "high", "low", "close", "volume"}
    missing = required_cols - set(ohlcv.columns)
    if missing:
        raise ValueError(f"ohlcv missing columns: {missing}")


def _screen_simple(symbol: str, ohlcv: pd.DataFrame, config: Config) -> ScreenResult:
    min_history = config.trend_sma_period + 1
    if len(ohlcv) < min_history:
        return ScreenResult(symbol, False, ["insufficient history"])

    close = ohlcv["close"]
    sma_series = ind.sma(close, config.trend_sma_period)
    avg_vol_series = ohlcv["volume"].rolling(window=20, min_periods=20).mean()

    last_close = float(close.iloc[-1])
    last_sma = float(sma_series.iloc[-1]) if pd.notna(sma_series.iloc[-1]) else None
    last_avg_vol = float(avg_vol_series.iloc[-1]) if pd.notna(avg_vol_series.iloc[-1]) else None

    reasons: list[str] = []
    if last_sma is None or last_close <= last_sma:
        reasons.append(f"price not above {config.trend_sma_period}-day trend SMA")
    if last_avg_vol is None or last_avg_vol < config.min_avg_volume:
        got = f"{last_avg_vol:,.0f}" if last_avg_vol is not None else "n/a"
        reasons.append(f"avg volume {got} below liquidity floor {config.min_avg_volume:,.0f}")

    return ScreenResult(
        symbol=symbol, passed=(len(reasons) == 0), reasons_failed=reasons,
        close=last_close, sma=last_sma, avg_volume=last_avg_vol,
    )


def _screen_full(
    symbol: str, ohlcv: pd.DataFrame, config: Config,
    fundamentals_lookup: Optional[Callable[[str], dict]] = None,
) -> ScreenResult:
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


def _apply_regime_and_rs(result: ScreenResult, ohlcv: pd.DataFrame, config: Config, index_ohlcv: Optional[pd.DataFrame]) -> ScreenResult:
    """Layers the market-regime and relative-strength gates on top of
    whichever mode-specific result was already computed. Applied
    regardless of screener_mode."""
    if not (config.use_regime_filter or config.use_relative_strength_filter):
        return result

    if index_ohlcv is None or index_ohlcv.empty:
        raise ValueError(
            "use_regime_filter/use_relative_strength_filter is enabled but no index_ohlcv "
            "was supplied to screen_symbol() -- this must be wired to a real benchmark "
            "index series (see swing_agent/strategy/regime.py), not silently skipped."
        )

    reasons = list(result.reasons_failed)
    regime_ok = None
    rel_strength = None

    if config.use_regime_filter:
        regime_series = regime_mod.index_above_sma(index_ohlcv["close"], config.regime_sma_period)
        regime_ok = bool(regime_series.iloc[-1])
        if not regime_ok:
            reasons.append(f"benchmark index below its {config.regime_sma_period}-day SMA (regime filter)")

    if config.use_relative_strength_filter:
        rs_series = regime_mod.relative_strength(ohlcv["close"], index_ohlcv["close"], config.rs_lookback_days)
        rs_last = rs_series.iloc[-1]
        rel_strength = float(rs_last) if pd.notna(rs_last) else None
        if rel_strength is None or rel_strength < config.rs_min_relative_return:
            got = f"{rel_strength:.4f}" if rel_strength is not None else "n/a"
            reasons.append(f"relative strength {got} below minimum {config.rs_min_relative_return:.4f}")

    return dataclasses.replace(
        result, passed=(len(reasons) == 0), reasons_failed=reasons,
        regime_ok=regime_ok, relative_strength=rel_strength,
    )


def screen_symbol(
    symbol: str,
    ohlcv: pd.DataFrame,
    config: Config,
    fundamentals_lookup: Optional[Callable[[str], dict]] = None,
    index_ohlcv: Optional[pd.DataFrame] = None,
) -> ScreenResult:
    """`ohlcv` must have columns: open, high, low, close, volume, sorted
    ascending by date, with enough history for the active mode's longest
    lookback ("simple": trend_sma_period; "full": sma_period/rsi_period/
    lookback_range_days/MACD's 26+9).

    `index_ohlcv`: the benchmark index's OHLCV (same shape), required only
    when `use_regime_filter`/`use_relative_strength_filter` is on."""
    _validate(ohlcv)
    if config.screener_mode == "simple":
        result = _screen_simple(symbol, ohlcv, config)
    elif config.screener_mode == "full":
        result = _screen_full(symbol, ohlcv, config, fundamentals_lookup)
    else:
        raise ValueError(f"unknown screener_mode: {config.screener_mode!r} (expected 'simple' or 'full')")
    return _apply_regime_and_rs(result, ohlcv, config, index_ohlcv)


def run_screener(
    universe: dict[str, pd.DataFrame],
    config: Config,
    fundamentals_lookup: Optional[Callable[[str], dict]] = None,
    index_ohlcv: Optional[pd.DataFrame] = None,
) -> list[ScreenResult]:
    """universe: {symbol: ohlcv_dataframe}. Returns results for every symbol
    (pass and fail) so callers can log/debug why a stock was excluded."""
    return [screen_symbol(sym, df, config, fundamentals_lookup, index_ohlcv) for sym, df in universe.items()]


def shortlist(results: list[ScreenResult]) -> list[ScreenResult]:
    return [r for r in results if r.passed]
