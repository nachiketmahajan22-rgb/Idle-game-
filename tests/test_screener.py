import numpy as np
import pandas as pd

from swing_agent.strategy.screener import screen_symbol
from tests.helpers import make_config


def uptrend_breakout_ohlcv(n: int = 60) -> pd.DataFrame:
    """A gentle, noisy uptrend (small daily pullbacks, like real price
    action — a pure straight-line uptrend pins RSI at 100) that then breaks
    out with a volume surge on the last bar — should clear every screener
    filter."""
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    rng = np.random.default_rng(7)
    base_trend = np.linspace(80, 98, n - 1)
    noise = rng.normal(0, 0.4, n - 1)
    base = base_trend + noise
    closes = list(base) + [base[-1] * 1.05]  # breakout pop on the last bar
    highs = [c * 1.01 for c in closes]
    lows = [c * 0.99 for c in closes]
    opens = closes[:1] + closes[:-1]
    volumes = [100_000] * (n - 1) + [400_000]  # volume surge on breakout day
    return pd.DataFrame(
        {"open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes},
        index=dates,
    )


def flat_choppy_ohlcv(n: int = 60) -> pd.DataFrame:
    """No trend, no volume surge — should fail the screener."""
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    rng = np.random.default_rng(42)
    closes = 100 + rng.normal(0, 0.5, n).cumsum() * 0  # pinned near 100
    closes = [100.0] * n
    return pd.DataFrame(
        {"open": closes, "high": closes, "low": closes, "close": closes, "volume": [50_000] * n},
        index=dates,
    )


def test_screen_symbol_passes_on_clean_uptrend_breakout():
    config = make_config(sma_period=20, lookback_range_days=20, rsi_min=40, rsi_max=100, volume_surge_multiple=1.5)
    ohlcv = uptrend_breakout_ohlcv(60)
    result = screen_symbol("TEST", ohlcv, config)
    assert result.passed, f"expected pass, got failures: {result.reasons_failed}"


def test_screen_symbol_fails_on_flat_no_volume():
    config = make_config(sma_period=20, lookback_range_days=20, rsi_min=50, rsi_max=70, volume_surge_multiple=1.5)
    ohlcv = flat_choppy_ohlcv(60)
    result = screen_symbol("TEST", ohlcv, config)
    assert not result.passed
    assert len(result.reasons_failed) > 0


def test_screen_symbol_reports_insufficient_history():
    config = make_config(sma_period=20, lookback_range_days=20)
    ohlcv = uptrend_breakout_ohlcv(10)
    result = screen_symbol("TEST", ohlcv, config)
    assert not result.passed
    assert result.reasons_failed == ["insufficient history"]


def test_screen_symbol_fundamentals_hook_can_reject():
    config = make_config(sma_period=20, lookback_range_days=20, rsi_min=40, rsi_max=90, volume_surge_multiple=1.5)
    ohlcv = uptrend_breakout_ohlcv(60)
    result = screen_symbol("TEST", ohlcv, config, fundamentals_lookup=lambda sym: {"pe": 120})
    assert not result.passed
    assert any("PE" in r for r in result.reasons_failed)
