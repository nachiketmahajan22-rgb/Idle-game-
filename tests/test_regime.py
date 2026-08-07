import numpy as np
import pandas as pd

from swing_agent.strategy.regime import index_above_sma, relative_strength


def _series(closes: list[float], start: str = "2024-01-01") -> pd.Series:
    dates = pd.date_range(start, periods=len(closes), freq="B")
    return pd.Series(closes, index=dates)


def test_index_above_sma_true_in_uptrend():
    # steady uptrend -> last close comfortably above its own trailing SMA
    closes = [100 + i * 0.5 for i in range(60)]
    result = index_above_sma(_series(closes), period=20)
    assert bool(result.iloc[-1]) is True


def test_index_above_sma_false_in_downtrend():
    closes = [200 - i * 0.5 for i in range(60)]
    result = index_above_sma(_series(closes), period=20)
    assert bool(result.iloc[-1]) is False


def test_index_above_sma_false_when_insufficient_history():
    closes = [100 + i for i in range(5)]  # far fewer than period=20
    result = index_above_sma(_series(closes), period=20)
    assert bool(result.iloc[-1]) is False


def test_relative_strength_positive_when_stock_outperforms():
    n = 300
    # index drifts up gently; stock rallies much harder over the same window
    index_closes = [100 + i * 0.05 for i in range(n)]
    stock_closes = [100 + i * 0.5 for i in range(n)]
    rs = relative_strength(_series(stock_closes), _series(index_closes), lookback_days=252)
    assert rs.iloc[-1] > 0


def test_relative_strength_negative_when_stock_underperforms():
    n = 300
    index_closes = [100 + i * 0.5 for i in range(n)]
    stock_closes = [100 + i * 0.05 for i in range(n)]
    rs = relative_strength(_series(stock_closes), _series(index_closes), lookback_days=252)
    assert rs.iloc[-1] < 0


def test_relative_strength_near_zero_when_moving_together():
    n = 300
    closes = [100 + i * 0.3 for i in range(n)]
    rs = relative_strength(_series(closes), _series(closes), lookback_days=252)
    assert abs(rs.iloc[-1]) < 1e-9


def test_relative_strength_aligns_index_onto_stock_calendar():
    """Index series with a different (sparser) calendar than the stock
    should still align via reindex+ffill rather than raising or silently
    misaligning."""
    n = 300
    stock_dates = pd.date_range("2024-01-01", periods=n, freq="B")
    stock = pd.Series([100 + i * 0.3 for i in range(n)], index=stock_dates)
    # index only has every other business day
    index_dates = stock_dates[::2]
    index = pd.Series([100 + i * 0.3 for i in range(len(index_dates))], index=index_dates)
    rs = relative_strength(stock, index, lookback_days=252)
    assert len(rs) == n
    assert pd.notna(rs.iloc[-1])
