from swing_agent.risk.position_sizing import ExposureGuard, size_position


def test_size_position_basic_long():
    result = size_position(
        capital=100_000, risk_pct_per_trade=0.01,
        entry_price=100.0, stop_loss_price=95.0, target_price=115.0,
        reward_risk_min=1.5, side="long",
    )
    # risk_amount = 1000, stop_distance = 5 -> qty = 200
    assert result.quantity == 200
    assert result.risk_amount == 1000.0
    assert result.reward_risk == 3.0
    assert result.is_valid


def test_size_position_rejects_reward_risk_below_minimum():
    result = size_position(
        capital=100_000, risk_pct_per_trade=0.01,
        entry_price=100.0, stop_loss_price=95.0, target_price=102.0,
        reward_risk_min=1.5, side="long",
    )
    assert not result.is_valid
    assert "reward:risk" in result.skipped_reason


def test_size_position_rejects_bad_stop_side():
    result = size_position(
        capital=100_000, risk_pct_per_trade=0.01,
        entry_price=100.0, stop_loss_price=105.0, target_price=120.0,
        reward_risk_min=1.5, side="long",
    )
    assert not result.is_valid
    assert "wrong side" in result.skipped_reason


def test_size_position_short():
    result = size_position(
        capital=100_000, risk_pct_per_trade=0.02,
        entry_price=200.0, stop_loss_price=210.0, target_price=170.0,
        reward_risk_min=1.0, side="short",
    )
    # risk_amount = 2000, stop_distance = 10 -> qty = 200
    assert result.quantity == 200
    assert result.reward_risk == 3.0
    assert result.is_valid


def test_size_position_zero_quantity_when_risk_too_small():
    result = size_position(
        capital=1000, risk_pct_per_trade=0.001,  # risk_amount = 1
        entry_price=5000.0, stop_loss_price=4900.0,  # stop_distance = 100
        target_price=None, reward_risk_min=1.5, side="long",
    )
    assert not result.is_valid
    assert result.quantity == 0


def test_exposure_guard_blocks_at_max_positions():
    guard = ExposureGuard(max_open_positions=3, max_daily_loss_pct=0.03, capital=100_000)
    ok, reason = guard.can_open_new_position(currently_open=3, realized_pnl_today=0.0)
    assert not ok
    assert "max_open_positions" in reason


def test_exposure_guard_blocks_on_daily_loss():
    guard = ExposureGuard(max_open_positions=5, max_daily_loss_pct=0.03, capital=100_000)
    ok, reason = guard.can_open_new_position(currently_open=1, realized_pnl_today=-3500.0)
    assert not ok
    assert "circuit breaker" in reason


def test_exposure_guard_allows_when_under_limits():
    guard = ExposureGuard(max_open_positions=5, max_daily_loss_pct=0.03, capital=100_000)
    ok, reason = guard.can_open_new_position(currently_open=2, realized_pnl_today=-500.0)
    assert ok
    assert reason is None
