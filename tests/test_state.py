from pathlib import Path

from swing_agent.state import StrategyState


def test_open_and_close_position_roundtrip(tmp_path: Path):
    state = StrategyState(tmp_path / "positions.json")
    state.open_position("RELIANCE", "long", 10, entry_price=2500.0, stop_loss=2450.0, target_price=2600.0)

    assert state.count_open() == 1
    assert "RELIANCE" in state.open_symbols()

    pos = state.get("RELIANCE")
    assert pos is not None
    assert pos.quantity == 10
    assert pos.stop_loss == 2450.0

    trade = state.close_position("RELIANCE", exit_price=2600.0, exit_reason="target_hit")
    assert trade is not None
    assert trade.pnl == (2600.0 - 2500.0) * 10
    assert state.count_open() == 0


def test_update_stop_persists(tmp_path: Path):
    state = StrategyState(tmp_path / "positions.json")
    state.open_position("TCS", "long", 5, entry_price=3500.0, stop_loss=3400.0, target_price=None)
    state.update_stop("TCS", 3500.0)

    reloaded = StrategyState(tmp_path / "positions.json")
    assert reloaded.get("TCS").stop_loss == 3500.0


def test_short_position_pnl_direction(tmp_path: Path):
    state = StrategyState(tmp_path / "positions.json")
    state.open_position("BANKNIFTY", "short", 100, entry_price=50.0, stop_loss=55.0, target_price=40.0)
    trade = state.close_position("BANKNIFTY", exit_price=42.0, exit_reason="target_hit")
    assert trade.pnl == (50.0 - 42.0) * 100


def test_realized_pnl_today_sums_todays_closed_trades(tmp_path: Path):
    state = StrategyState(tmp_path / "positions.json")
    state.open_position("A", "long", 10, entry_price=100.0, stop_loss=95.0, target_price=None)
    state.close_position("A", exit_price=110.0, exit_reason="target_hit")
    state.open_position("B", "long", 10, entry_price=50.0, stop_loss=45.0, target_price=None)
    state.close_position("B", exit_price=40.0, exit_reason="stop_loss_hit")

    assert state.realized_pnl_today() == (110.0 - 100.0) * 10 + (40.0 - 50.0) * 10
