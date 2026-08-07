import pandas as pd

from swing_agent.strategy.breakout import detect_breakout, update_trailing_stop
from tests.helpers import flat_range_ohlcv, make_config


def test_detect_breakout_long_trigger():
    config = make_config(lookback_range_days=10)
    base = flat_range_ohlcv(12, low=90.0, high=100.0)
    breakout_day = pd.DataFrame({
        "open": [101.0], "high": [103.0], "low": [99.0], "close": [102.0], "volume": [150_000],
    }, index=[base.index[-1] + pd.Timedelta(days=1)])
    ohlcv = pd.concat([base, breakout_day])

    signal = detect_breakout("TEST", ohlcv, config)
    assert signal.triggered
    assert signal.side == "long"
    assert signal.entry_price == 102.0
    assert signal.stop_loss == 99.0
    assert signal.target_price == 102.0 + (100.0 - 90.0)


def test_detect_breakout_short_trigger():
    config = make_config(lookback_range_days=10)
    base = flat_range_ohlcv(12, low=90.0, high=100.0)
    breakdown_day = pd.DataFrame({
        "open": [89.0], "high": [91.0], "low": [85.0], "close": [86.0], "volume": [150_000],
    }, index=[base.index[-1] + pd.Timedelta(days=1)])
    ohlcv = pd.concat([base, breakdown_day])

    signal = detect_breakout("TEST", ohlcv, config)
    assert signal.triggered
    assert signal.side == "short"
    assert signal.entry_price == 86.0
    assert signal.stop_loss == 91.0


def test_detect_breakout_no_trigger_inside_range():
    config = make_config(lookback_range_days=10)
    ohlcv = flat_range_ohlcv(15, low=90.0, high=100.0)
    signal = detect_breakout("TEST", ohlcv, config)
    assert not signal.triggered


def test_detect_breakout_insufficient_history():
    config = make_config(lookback_range_days=10)
    ohlcv = flat_range_ohlcv(5, low=90.0, high=100.0)
    signal = detect_breakout("TEST", ohlcv, config)
    assert not signal.triggered
    assert "insufficient history" in signal.reason


def test_update_trailing_stop_does_not_trail_before_threshold():
    config = make_config(trail_after_r_multiple=1.0, trail_method="breakeven")
    ohlcv = flat_range_ohlcv(15, low=100.0, high=100.0)  # close pinned at 100
    new_stop = update_trailing_stop(
        side="long", entry_price=100.0, initial_stop=95.0, current_stop=95.0,
        ohlcv=ohlcv, config=config,
    )
    assert new_stop == 95.0  # no profit yet, stop untouched


def test_update_trailing_stop_moves_to_breakeven_after_threshold():
    config = make_config(trail_after_r_multiple=1.0, trail_method="breakeven")
    dates = pd.date_range("2024-01-01", periods=15, freq="B")
    closes = [100.0] * 14 + [106.0]  # last close is 1R above entry (entry=100, stop=95, risk=5)
    ohlcv = pd.DataFrame({
        "open": closes, "high": closes, "low": closes, "close": closes, "volume": [100_000] * 15,
    }, index=dates)

    new_stop = update_trailing_stop(
        side="long", entry_price=100.0, initial_stop=95.0, current_stop=95.0,
        ohlcv=ohlcv, config=config,
    )
    assert new_stop == 100.0  # trailed to breakeven


def test_update_trailing_stop_never_widens_risk():
    config = make_config(trail_after_r_multiple=1.0, trail_method="breakeven")
    dates = pd.date_range("2024-01-01", periods=15, freq="B")
    closes = [100.0] * 15
    ohlcv = pd.DataFrame({
        "open": closes, "high": closes, "low": closes, "close": closes, "volume": [100_000] * 15,
    }, index=dates)

    # current_stop is already above breakeven candidate -> must not be lowered
    new_stop = update_trailing_stop(
        side="long", entry_price=90.0, initial_stop=85.0, current_stop=98.0,
        ohlcv=ohlcv, config=config,
    )
    assert new_stop == 98.0
