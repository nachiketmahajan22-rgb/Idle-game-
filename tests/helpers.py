"""Shared test fixtures/helpers — not a test module itself (no test_ prefix)."""
import pandas as pd

from swing_agent.config import Config


def make_config(**overrides) -> Config:
    """Defaults pin the original Kar-style ("full"/"candle"/fixed-target)
    behavior so existing tests keep validating that mode unchanged. Pass
    screener_mode="simple", stop_method="atr" to test the recommended
    simplified mode instead."""
    defaults = dict(
        strategy_style="breakout",
        capital=100_000, risk_pct_per_trade=0.01, max_open_positions=5,
        max_daily_loss_pct=0.03, reward_risk_min=1.0,
        brokerage_flat=0.0, stt_pct=0.001, stamp_duty_pct=0.00015,
        exchange_txn_pct=0.0000345, gst_pct=0.18, dp_charge_flat=15.34,
        mr_ma_period=5, mr_atr_period=5, mr_entry_atr_multiple=1.0,
        mr_limit_atr_multiple=0.75, mr_stop_atr_multiple=2.0,
        mr_max_hold_days=5, mr_min_atr_pct=0.005,
        screener_mode="full", rsi_period=14, rsi_min=50, rsi_max=70, sma_period=10,
        volume_surge_multiple=1.5, lookback_range_days=10,
        trend_sma_period=20, min_avg_volume=0,
        breakout_confirmation="close", stop_method="candle", atr_stop_multiple=2.5,
        use_fixed_target=True, trail_after_r_multiple=1.0,
        trail_method="breakeven", atr_period=14, atr_trail_multiple=2.0,
        use_regime_filter=False, regime_index_symbol="^NSEI", regime_sma_period=200,
        use_relative_strength_filter=False, rs_lookback_days=252, rs_min_relative_return=0.0,
        universe_file="config/watchlist.csv", broker="paper",
        live_trading=False, live_trading_env=False, order_product="CNC",
        order_type="MARKET", allow_shorts=True, notify_telegram=False,
        log_dir="logs",
    )
    defaults.update(overrides)
    return Config(**defaults)


def flat_range_ohlcv(n: int, low: float, high: float) -> pd.DataFrame:
    """n days of range-bound trading between low and high."""
    dates = pd.date_range("2024-01-01", periods=n, freq="B")
    mid = (low + high) / 2
    return pd.DataFrame({
        "open": [mid] * n, "high": [high] * n, "low": [low] * n,
        "close": [mid] * n, "volume": [100_000] * n,
    }, index=dates)
