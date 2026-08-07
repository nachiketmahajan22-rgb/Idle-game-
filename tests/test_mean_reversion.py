import pandas as pd

from swing_agent.strategy.mean_reversion import (
    check_exit,
    check_limit_fill,
    detect_pullback_signal,
    screen_symbol_mr,
)
from tests.helpers import make_config


def uptrend_with_pullback(n_base: int = 25, base_price: float = 100.0, dip_price: float = 90.0) -> pd.DataFrame:
    """A stock trading in a range around base_price (with real daily
    range, so ATR is nonzero) that then drops sharply on the last bar --
    should trigger a mean-reversion pullback signal."""
    dates = pd.date_range("2024-01-01", periods=n_base + 1, freq="B")
    closes = [base_price] * n_base + [dip_price]
    highs = [c + 1.0 for c in closes]
    lows = [c - 1.0 for c in closes]
    opens = closes[:1] + closes[:-1]
    volumes = [500_000] * (n_base + 1)
    return pd.DataFrame({"open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes}, index=dates)


def flat_no_dip(n: int = 30, price: float = 100.0) -> pd.DataFrame:
    """Gentle, steady uptrend (not literally flat) with real daily range,
    so the last close sits above its own trailing SMA and ATR is nonzero."""
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    closes = [price + i * 0.5 for i in range(n)]
    highs = [c + 1.0 for c in closes]
    lows = [c - 1.0 for c in closes]
    opens = closes[:1] + closes[:-1]
    volumes = [500_000] * n
    return pd.DataFrame({"open": opens, "high": highs, "low": lows, "close": closes, "volume": volumes}, index=dates)


def test_screen_symbol_mr_passes_above_trend_and_liquid():
    config = make_config(trend_sma_period=20, min_avg_volume=100_000, mr_min_atr_pct=0.001)
    ohlcv = flat_no_dip(30)
    result = screen_symbol_mr("TEST", ohlcv, config)
    assert result.passed, result.reasons_failed


def test_screen_symbol_mr_fails_below_trend():
    config = make_config(trend_sma_period=20, min_avg_volume=0, mr_min_atr_pct=0.001)
    dates = pd.date_range("2024-01-01", periods=30, freq="B")
    closes = list(pd.Series(range(130, 100, -1)))  # steady downtrend -> below its own SMA
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    df = pd.DataFrame({"open": closes, "high": highs, "low": lows, "close": closes, "volume": [500_000] * 30}, index=dates)
    result = screen_symbol_mr("TEST", df, config)
    assert not result.passed
    assert any("trend SMA" in r for r in result.reasons_failed)


def test_screen_symbol_mr_fails_illiquid():
    config = make_config(trend_sma_period=20, min_avg_volume=1_000_000, mr_min_atr_pct=0.001)
    ohlcv = flat_no_dip(30)
    result = screen_symbol_mr("TEST", ohlcv, config)
    assert not result.passed
    assert any("liquidity floor" in r for r in result.reasons_failed)


def test_screen_symbol_mr_fails_low_volatility():
    config = make_config(trend_sma_period=20, min_avg_volume=0, mr_min_atr_pct=0.5)  # unreachably high floor
    ohlcv = flat_no_dip(30)
    result = screen_symbol_mr("TEST", ohlcv, config)
    assert not result.passed
    assert any("volatility floor" in r for r in result.reasons_failed)


def test_screen_symbol_mr_insufficient_history():
    config = make_config(trend_sma_period=20)
    ohlcv = flat_no_dip(5)
    result = screen_symbol_mr("TEST", ohlcv, config)
    assert not result.passed
    assert result.reasons_failed == ["insufficient history"]


def test_detect_pullback_signal_triggers_on_sharp_dip():
    config = make_config(mr_ma_period=5, mr_atr_period=5, mr_entry_atr_multiple=1.0, mr_limit_atr_multiple=0.75)
    ohlcv = uptrend_with_pullback(n_base=25, base_price=100.0, dip_price=85.0)
    signal = detect_pullback_signal("TEST", ohlcv, config)
    assert signal.triggered
    assert signal.limit_price < 85.0  # limit sits below the already-depressed close
    assert signal.stop_loss < signal.limit_price


def test_detect_pullback_signal_no_trigger_on_flat_data():
    config = make_config(mr_ma_period=5, mr_atr_period=5, mr_entry_atr_multiple=1.0)
    ohlcv = flat_no_dip(15)
    signal = detect_pullback_signal("TEST", ohlcv, config)
    assert not signal.triggered


def test_detect_pullback_signal_insufficient_history():
    config = make_config(mr_ma_period=5)
    ohlcv = flat_no_dip(3)
    signal = detect_pullback_signal("TEST", ohlcv, config)
    assert not signal.triggered
    assert "insufficient history" in signal.reason


def test_check_limit_fill():
    assert check_limit_fill(limit_price=95.0, today_low=94.5) is True
    assert check_limit_fill(limit_price=95.0, today_low=95.0) is True
    assert check_limit_fill(limit_price=95.0, today_low=95.5) is False


def test_check_exit_stop_loss_hit():
    config = make_config(mr_max_hold_days=5)
    dates = pd.date_range("2024-01-03", periods=3, freq="B")
    df = pd.DataFrame({
        "open": [100.0, 99.0, 90.0], "high": [101.0, 100.0, 91.0],
        "low": [99.0, 97.0, 88.0], "close": [100.0, 98.0, 89.0], "volume": [500_000] * 3,
    }, index=dates)
    exit_price, reason = check_exit(entry_price=100.0, stop_loss=90.0, entry_date=str(dates[0].date()), ohlcv=df, config=config)
    assert exit_price == 90.0
    assert reason == "stop_loss"


def test_check_exit_rising_day():
    config = make_config(mr_max_hold_days=5)
    dates = pd.date_range("2024-01-03", periods=3, freq="B")
    df = pd.DataFrame({
        "open": [100.0, 95.0, 96.0], "high": [101.0, 96.0, 98.0],
        "low": [99.0, 93.0, 95.5], "close": [100.0, 94.0, 97.0], "volume": [500_000] * 3,
    }, index=dates)
    # entry on day 0, day 1 close=94 (down), day 2 close=97 > day1 close=94 -> rising day exit
    exit_price, reason = check_exit(entry_price=100.0, stop_loss=85.0, entry_date=str(dates[0].date()), ohlcv=df, config=config)
    assert exit_price == 97.0
    assert reason == "rising_day"


def test_check_exit_max_hold():
    config = make_config(mr_max_hold_days=2)
    dates = pd.date_range("2024-01-03", periods=3, freq="B")
    # never rises, never hits stop, but exceeds max_hold_days=2
    df = pd.DataFrame({
        "open": [100.0, 95.0, 90.0], "high": [101.0, 96.0, 91.0],
        "low": [99.0, 93.0, 88.5], "close": [100.0, 94.0, 89.0], "volume": [500_000] * 3,
    }, index=dates)
    exit_price, reason = check_exit(entry_price=100.0, stop_loss=80.0, entry_date=str(dates[0].date()), ohlcv=df, config=config)
    assert exit_price == 89.0
    assert reason == "max_hold"


def test_check_exit_holds_on_entry_day():
    config = make_config(mr_max_hold_days=5)
    dates = pd.date_range("2024-01-03", periods=1, freq="B")
    df = pd.DataFrame({
        "open": [100.0], "high": [101.0], "low": [99.0], "close": [100.0], "volume": [500_000],
    }, index=dates)
    exit_price, reason = check_exit(entry_price=100.0, stop_loss=90.0, entry_date=str(dates[0].date()), ohlcv=df, config=config)
    assert exit_price is None
    assert reason is None


def test_check_exit_holds_when_no_condition_met():
    config = make_config(mr_max_hold_days=5)
    dates = pd.date_range("2024-01-03", periods=2, freq="B")
    # day2 close (94) is lower than day1 close (95) -> not a rising day; not at max hold; stop not hit
    df = pd.DataFrame({
        "open": [100.0, 95.5], "high": [101.0, 96.0],
        "low": [99.0, 93.5], "close": [100.0, 94.0], "volume": [500_000] * 2,
    }, index=dates)
    exit_price, reason = check_exit(entry_price=100.0, stop_loss=85.0, entry_date=str(dates[0].date()), ohlcv=df, config=config)
    assert exit_price is None
    assert reason is None
