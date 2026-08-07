"""Tests for the recommended, simplified strategy: screener_mode='simple'
(trend + liquidity only) and stop_method='atr' (volatility-scaled stop,
no fixed target)."""
import numpy as np
import pandas as pd

from swing_agent.strategy.breakout import detect_breakout
from swing_agent.strategy.screener import screen_symbol
from tests.helpers import flat_range_ohlcv, make_config


def trending_liquid_ohlcv(n: int = 210, avg_volume: float = 500_000, seed: int = 1) -> pd.DataFrame:
    """A noisy uptrend with plenty of history for a 200-day SMA, healthy
    liquidity, ending in a breakout pop."""
    rng = np.random.default_rng(seed)
    dates = pd.date_range("2023-01-01", periods=n, freq="B")
    trend = np.linspace(50, 90, n - 1) + rng.normal(0, 1.0, n - 1)
    closes = list(trend) + [trend[-1] * 1.06]
    highs = [c * 1.01 for c in closes]
    lows = [c * 0.99 for c in closes]
    opens = closes[:1] + closes[:-1]
    volumes = list(rng.normal(avg_volume, avg_volume * 0.1, n - 1)) + [avg_volume * 2]
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes},
        index=dates,
    )


def test_simple_screener_passes_on_uptrend_with_liquidity():
    config = make_config(screener_mode="simple", trend_sma_period=200, min_avg_volume=200_000)
    ohlcv = trending_liquid_ohlcv()
    result = screen_symbol("TEST", ohlcv, config)
    assert result.passed, f"expected pass, got: {result.reasons_failed}"


def test_simple_screener_fails_below_trend():
    config = make_config(screener_mode="simple", trend_sma_period=200, min_avg_volume=200_000)
    dates = pd.date_range("2023-01-01", periods=210, freq="B")
    # downtrend -> price below its 200-day SMA
    closes = np.linspace(100, 60, 210)
    df = pd.DataFrame(
        {"open": closes, "high": closes, "low": closes, "close": closes, "volume": [500_000] * 210},
        index=dates,
    )
    result = screen_symbol("TEST", df, config)
    assert not result.passed
    assert any("trend SMA" in r for r in result.reasons_failed)


def test_simple_screener_fails_on_illiquid_stock():
    config = make_config(screener_mode="simple", trend_sma_period=200, min_avg_volume=500_000)
    ohlcv = trending_liquid_ohlcv(avg_volume=50_000)  # well below the liquidity floor
    result = screen_symbol("TEST", ohlcv, config)
    assert not result.passed
    assert any("liquidity floor" in r for r in result.reasons_failed)


def test_simple_screener_rejects_unknown_mode():
    config = make_config(screener_mode="bogus")
    ohlcv = trending_liquid_ohlcv()
    try:
        screen_symbol("TEST", ohlcv, config)
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_atr_stop_scales_with_volatility_not_a_single_wick():
    """Regression test for the original bug: a candle-wick stop can be
    razor-thin (huge position size); the ATR stop must stay proportional
    to typical daily range regardless of one skinny breakout wick."""
    config = make_config(stop_method="atr", atr_period=14, atr_stop_multiple=2.5, lookback_range_days=10)
    dates = pd.date_range("2024-01-01", periods=20, freq="B")
    # Consistent ~2-point daily range for the base, then a breakout bar
    # with an artificially tiny wick (low barely below close) that would
    # have produced a near-zero stop under stop_method='candle'.
    base_close = [100.0] * 17
    base_high = [102.0] * 17
    base_low = [98.0] * 17
    breakout_close = [110.0, 110.0, 112.0]
    breakout_high = [110.5, 110.5, 112.5]
    breakout_low = [109.9, 109.9, 111.9]  # tiny wick on the trigger bar
    closes = base_close + breakout_close
    highs = base_high + breakout_high
    lows = base_low + breakout_low
    volumes = [100_000] * 20
    df = pd.DataFrame({"open": closes, "high": highs, "low": lows, "close": closes, "volume": volumes}, index=dates)

    signal = detect_breakout("TEST", df, config)
    assert signal.triggered
    stop_distance = signal.entry_price - signal.stop_loss
    # ATR over this data is on the order of the ~2-4 point daily ranges,
    # not the ~0.1 candle wick -- stop distance should be well above 1.0.
    assert stop_distance > 1.0, f"stop too tight ({stop_distance}), ATR stop isn't scaling with volatility"


def test_no_fixed_target_lets_trade_run():
    config = make_config(use_fixed_target=False, stop_method="candle", lookback_range_days=10)
    base = flat_range_ohlcv(12, low=90.0, high=100.0)
    breakout_day = pd.DataFrame({
        "open": [101.0], "high": [103.0], "low": [99.0], "close": [102.0], "volume": [150_000],
    }, index=[base.index[-1] + pd.Timedelta(days=1)])
    df = pd.concat([base, breakout_day])

    signal = detect_breakout("TEST", df, config)
    assert signal.triggered
    assert signal.target_price is None
