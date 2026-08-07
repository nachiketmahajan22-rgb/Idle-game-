from swing_agent.costs import buy_side_cost, round_trip_cost, sell_side_cost
from tests.helpers import make_config


def test_buy_side_cost_includes_stt_stamp_duty_and_exchange_charges():
    config = make_config()
    cost = buy_side_cost(100_000, config)
    # 0.1% STT + 0.015% stamp duty + 0.00345% exchange txn + 18% GST on (brokerage(0)+exchange txn)
    stt = 100_000 * 0.001
    stamp = 100_000 * 0.00015
    exch = 100_000 * 0.0000345
    gst = exch * 0.18
    expected = stt + stamp + exch + gst
    assert abs(cost - expected) < 1e-6


def test_sell_side_cost_includes_dp_charge():
    config = make_config()
    cost = sell_side_cost(100_000, config)
    stt = 100_000 * 0.001
    exch = 100_000 * 0.0000345
    gst = exch * 0.18
    expected = stt + exch + gst + config.dp_charge_flat
    assert abs(cost - expected) < 1e-6


def test_sell_side_cost_higher_than_buy_side_due_to_dp_charge():
    config = make_config()
    # same trade value on both sides -> sell costs more because of the flat DP charge
    assert sell_side_cost(50_000, config) > buy_side_cost(50_000, config)


def test_round_trip_cost_sums_both_legs():
    config = make_config()
    rt = round_trip_cost(entry_price=100.0, exit_price=110.0, quantity=50, config=config)
    assert rt.buy_side == buy_side_cost(100.0 * 50, config)
    assert rt.sell_side == sell_side_cost(110.0 * 50, config)
    assert rt.total == rt.buy_side + rt.sell_side


def test_costs_scale_with_trade_value():
    config = make_config()
    small = buy_side_cost(1_000, config)
    large = buy_side_cost(100_000, config)
    assert large > small
    # percentage-based components should scale roughly linearly with value
    assert large > small * 50
