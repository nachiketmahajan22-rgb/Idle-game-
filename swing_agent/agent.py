"""Daily orchestration: manage exits on open positions, then screen the
universe and take new entries — either via the breakout strategy or the
mean-reversion strategy, per `config.strategy_style`.

Run once per day, ideally after the close (or near session end per Kar's
"first/last hour" timing guidance if you want to catch same-day breakouts).
Safe to run repeatedly — it reconciles against persisted state rather than
assuming a clean slate.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from swing_agent.broker.base import BrokerInterface
from swing_agent.broker.paper_broker import PaperBroker
from swing_agent.config import Config, load_config
from swing_agent.data.market_data import load_universe_history
from swing_agent.notify.telegram import send_telegram_message
from swing_agent.risk.position_sizing import ExposureGuard, cap_quantity_by_capital, size_position
from swing_agent.state import StrategyState
from swing_agent.strategy.breakout import detect_breakout, update_trailing_stop
from swing_agent.strategy.mean_reversion import check_exit, check_limit_fill, detect_pullback_signal, screen_symbol_mr
from swing_agent.strategy.screener import run_screener, shortlist

logger = logging.getLogger("swing_agent")


def build_broker(config: Config) -> BrokerInterface:
    if config.is_live:
        from swing_agent.broker.kite_broker import KiteBroker
        return KiteBroker(api_key=config.kite_api_key, access_token=config.kite_access_token)

    # Paper mode: price feed for LTP comes from the same yfinance history we
    # already fetch for screening, refreshed once per run.
    price_cache: dict[str, float] = {}

    def price_provider(symbol: str) -> float:
        if symbol not in price_cache:
            from swing_agent.data.market_data import fetch_history_yfinance
            df = fetch_history_yfinance(symbol, period="5d")
            if df.empty:
                raise ValueError(f"no price data for {symbol}")
            price_cache[symbol] = float(df["close"].iloc[-1])
        return price_cache[symbol]

    return PaperBroker(
        state_file=config.log_path / "paper_broker_state.json",
        price_provider=price_provider,
        starting_cash=config.capital,
        config=config,
    )


def confirm_live_trading() -> bool:
    print("=" * 60)
    print(" LIVE TRADING IS ENABLED — REAL ORDERS WITH REAL MONEY.")
    print(" This run may place actual buy/sell orders on your Zerodha account.")
    print("=" * 60)
    answer = input("Type 'yes' to proceed, anything else to abort: ").strip().lower()
    return answer == "yes"


# ---------------------------------------------------------------- breakout --

def manage_exits_breakout(config: Config, broker: BrokerInterface, state: StrategyState, universe: dict) -> None:
    for pos in state.all_open():
        df = universe.get(pos.symbol)
        if df is None or df.empty:
            logger.warning("no fresh data for open position %s, skipping exit check", pos.symbol)
            continue

        last_low = float(df["low"].iloc[-1])
        last_high = float(df["high"].iloc[-1])
        exit_price, exit_reason = None, None

        if pos.side == "long":
            if last_low <= pos.stop_loss:
                exit_price, exit_reason = pos.stop_loss, "stop_loss_hit"
            elif pos.target_price is not None and last_high >= pos.target_price:
                exit_price, exit_reason = pos.target_price, "target_hit"
        else:
            if last_high >= pos.stop_loss:
                exit_price, exit_reason = pos.stop_loss, "stop_loss_hit"
            elif pos.target_price is not None and last_low <= pos.target_price:
                exit_price, exit_reason = pos.target_price, "target_hit"

        if exit_price is not None:
            order_side = "SELL" if pos.side == "long" else "BUY"
            broker.place_order(pos.symbol, order_side, pos.quantity, product=config.order_product, price=exit_price)
            trade = state.close_position(pos.symbol, exit_price, exit_reason)
            msg = f"EXIT {pos.symbol} ({pos.side}) @ {exit_price:.2f} — {exit_reason}, P&L: {trade.pnl:.2f}" if trade else f"EXIT {pos.symbol}"
            logger.info(msg)
            send_telegram_message(config, msg)
        else:
            new_stop = update_trailing_stop(
                side=pos.side, entry_price=pos.entry_price, initial_stop=pos.stop_loss,
                current_stop=pos.stop_loss, ohlcv=df, config=config,
            )
            if new_stop != pos.stop_loss:
                state.update_stop(pos.symbol, new_stop)
                logger.info("trailed stop for %s: %.2f -> %.2f", pos.symbol, pos.stop_loss, new_stop)


def find_new_entries_breakout(config: Config, broker: BrokerInterface, state: StrategyState, universe: dict) -> list[str]:
    # Screen using data up to (not including) today's bar, then confirm the
    # breakout trigger on today's full bar. Kar's process is shortlist-the-
    # setup-first, then-wait-for-the-trigger — not simultaneous. Checking
    # the screener's RSI band on the same bar as the breakout itself would
    # reject most real breakouts, since a genuine breakout pop naturally
    # pushes RSI up as it happens.
    screening_universe = {sym: df.iloc[:-1] for sym, df in universe.items() if len(df) > 1}
    results = run_screener(screening_universe, config)
    shortlisted = shortlist(results)
    logger.info("screener: %d/%d symbols shortlisted", len(shortlisted), len(results))

    guard = ExposureGuard(
        max_open_positions=config.max_open_positions,
        max_daily_loss_pct=config.max_daily_loss_pct,
        capital=config.capital,
    )

    live_confirmed = False
    opened: list[str] = []

    for result in shortlisted:
        if result.symbol in state.open_symbols():
            continue

        can_open, block_reason = guard.can_open_new_position(
            currently_open=state.count_open(),
            realized_pnl_today=state.realized_pnl_today(),
        )
        if not can_open:
            logger.info("skipping new entries: %s", block_reason)
            break

        df = universe[result.symbol]
        signal = detect_breakout(result.symbol, df, config)
        if not signal.triggered:
            continue
        if signal.side == "short" and not config.allow_shorts:
            logger.info("skipping short signal on %s (allow_shorts=false, CNC can't hold overnight shorts)", result.symbol)
            continue

        sizing = size_position(
            capital=config.capital,
            risk_pct_per_trade=config.risk_pct_per_trade,
            entry_price=signal.entry_price,
            stop_loss_price=signal.stop_loss,
            target_price=signal.target_price,
            reward_risk_min=config.reward_risk_min,
            side=signal.side,
        )
        if not sizing.is_valid:
            logger.info("skipping %s signal: %s", result.symbol, sizing.skipped_reason)
            continue

        # Fixed-fractional risk sizing can call for more shares than the
        # account can actually afford when the stop is tight relative to
        # price — never let an order cost more than available margin.
        available_margin = broker.get_available_margin()
        quantity = cap_quantity_by_capital(sizing.quantity, signal.entry_price, available_margin)
        if quantity < sizing.quantity:
            logger.info("%s: capped quantity %d -> %d (available margin %.2f)", result.symbol, sizing.quantity, quantity, available_margin)
        if quantity <= 0:
            logger.info("skipping %s signal: insufficient available margin (%.2f) at entry %.2f", result.symbol, available_margin, signal.entry_price)
            continue

        if config.is_live and not live_confirmed:
            if not confirm_live_trading():
                logger.warning("live trading aborted by user at confirmation prompt")
                break
            live_confirmed = True

        order_side = "BUY" if signal.side == "long" else "SELL"
        broker.place_order(result.symbol, order_side, quantity, product=config.order_product, price=signal.entry_price)
        state.open_position(
            symbol=result.symbol, side=signal.side, quantity=quantity,
            entry_price=signal.entry_price, stop_loss=signal.stop_loss, target_price=signal.target_price,
        )
        actual_risk = abs(signal.entry_price - signal.stop_loss) * quantity
        msg = (f"ENTRY {result.symbol} ({signal.side}) qty={quantity} @ {signal.entry_price:.2f} "
               f"stop={signal.stop_loss:.2f} target={signal.target_price} risk={actual_risk:.2f} "
               f"R:R={sizing.reward_risk:.2f} [{signal.reason}]")
        logger.info(msg)
        send_telegram_message(config, msg)
        opened.append(result.symbol)

    return opened


# ---------------------------------------------------------- mean-reversion --

def manage_exits_mean_reversion(config: Config, broker: BrokerInterface, state: StrategyState, universe: dict) -> None:
    for pos in state.all_open():
        df = universe.get(pos.symbol)
        if df is None or df.empty or pos.entry_date is None:
            logger.warning("no fresh data / entry_date for open MR position %s, skipping exit check", pos.symbol)
            continue

        exit_price, exit_reason = check_exit(
            entry_price=pos.entry_price, stop_loss=pos.stop_loss,
            entry_date=pos.entry_date, ohlcv=df, config=config,
        )
        if exit_price is not None:
            broker.place_order(pos.symbol, "SELL", pos.quantity, product=config.order_product, price=exit_price)
            trade = state.close_position(pos.symbol, exit_price, exit_reason)
            msg = f"EXIT {pos.symbol} (mean_reversion) @ {exit_price:.2f} — {exit_reason}, P&L: {trade.pnl:.2f}" if trade else f"EXIT {pos.symbol}"
            logger.info(msg)
            send_telegram_message(config, msg)


def process_pending_orders_mean_reversion(config: Config, broker: BrokerInterface, state: StrategyState, universe: dict) -> list[str]:
    """Attempt to fill each resting limit order (generated by yesterday's
    signal) against today's low. Every pending order is resolved (filled or
    expired) within this call — none carry over past one trading day."""
    guard = ExposureGuard(
        max_open_positions=config.max_open_positions,
        max_daily_loss_pct=config.max_daily_loss_pct,
        capital=config.capital,
    )
    live_confirmed = False
    filled: list[str] = []

    for pending in state.list_pending():
        df = universe.get(pending.symbol)
        if df is None or df.empty:
            state.clear_pending(pending.symbol)
            continue

        today_low = float(df["low"].iloc[-1])
        if not check_limit_fill(pending.limit_price, today_low):
            state.clear_pending(pending.symbol)  # expired unfilled
            continue

        if pending.symbol in state.open_symbols():
            state.clear_pending(pending.symbol)
            continue

        can_open, block_reason = guard.can_open_new_position(
            currently_open=state.count_open(), realized_pnl_today=state.realized_pnl_today(),
        )
        if not can_open:
            logger.info("skipping fill for %s: %s", pending.symbol, block_reason)
            state.clear_pending(pending.symbol)
            continue

        sizing = size_position(
            capital=config.capital, risk_pct_per_trade=config.risk_pct_per_trade,
            entry_price=pending.limit_price, stop_loss_price=pending.stop_loss,
            target_price=None, reward_risk_min=config.reward_risk_min, side="long",
        )
        state.clear_pending(pending.symbol)
        if not sizing.is_valid:
            logger.info("skipping %s fill: %s", pending.symbol, sizing.skipped_reason)
            continue

        available_margin = broker.get_available_margin()
        quantity = cap_quantity_by_capital(sizing.quantity, pending.limit_price, available_margin)
        if quantity <= 0:
            logger.info("skipping %s fill: insufficient available margin (%.2f)", pending.symbol, available_margin)
            continue

        if config.is_live and not live_confirmed:
            if not confirm_live_trading():
                logger.warning("live trading aborted by user at confirmation prompt")
                break
            live_confirmed = True

        broker.place_order(pending.symbol, "BUY", quantity, product=config.order_product, price=pending.limit_price)
        today_date = str(df.index[-1].date()) if hasattr(df.index[-1], "date") else str(df.index[-1])
        state.open_position(
            symbol=pending.symbol, side="long", quantity=quantity,
            entry_price=pending.limit_price, stop_loss=pending.stop_loss, target_price=None,
            entry_date=today_date,
        )
        msg = f"ENTRY {pending.symbol} (mean_reversion) qty={quantity} @ {pending.limit_price:.2f} stop={pending.stop_loss:.2f}"
        logger.info(msg)
        send_telegram_message(config, msg)
        filled.append(pending.symbol)

    return filled


def find_new_signals_mean_reversion(config: Config, state: StrategyState, universe: dict) -> list[str]:
    """Screen today's close for pullback setups and queue a limit order for
    tomorrow — never fires an order today off today's own close."""
    signaled: list[str] = []
    for sym, df in universe.items():
        if sym in state.open_symbols() or df.empty:
            continue
        screen = screen_symbol_mr(sym, df, config)
        if not screen.passed:
            continue
        signal = detect_pullback_signal(sym, df, config)
        if not signal.triggered:
            continue
        signal_date = str(df.index[-1].date()) if hasattr(df.index[-1], "date") else str(df.index[-1])
        state.add_pending(sym, signal.limit_price, signal.stop_loss, signal_date)
        logger.info("PENDING %s: limit=%.2f stop=%.2f [%s]", sym, signal.limit_price, signal.stop_loss, signal.reason)
        signaled.append(sym)
    return signaled


# -------------------------------------------------------------- orchestrator --

def run_daily_cycle(config: Config | None = None) -> None:
    config = config or load_config()

    if config.is_live and config.strategy_style == "mean_reversion":
        raise RuntimeError(
            "Live trading is not yet implemented for strategy_style='mean_reversion'. "
            "process_pending_orders_mean_reversion() decides fills from historical OHLC "
            "(today's low touching the limit price) rather than placing a real resting "
            "LIMIT order with the broker and polling its fill status — correct for "
            "backtest/paper, but on a real exchange the order needs to actually be "
            "resting during the live session and its fill (or non-fill) confirmed via "
            "kite.orders()/kite.trades() on the next run, which isn't built yet. "
            "Run this strategy in paper mode (broker: paper or live_trading: false) "
            "until that's added — breakout live trading is unaffected."
        )

    config.log_path.mkdir(parents=True, exist_ok=True)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(config.log_path / "agent.log"),
            logging.StreamHandler(),
        ],
    )

    logger.info("=== swing agent run start (%s), mode=%s, strategy=%s ===",
                datetime.now(timezone.utc).isoformat(), "LIVE" if config.is_live else "PAPER", config.strategy_style)

    broker = build_broker(config)
    state = StrategyState(config.log_path / "positions.json")

    from swing_agent.data.market_data import load_universe_symbols
    symbols = load_universe_symbols(config)
    universe = load_universe_history(config, symbols=symbols)
    logger.info("loaded history for %d/%d universe symbols", len(universe), len(symbols))

    if config.strategy_style == "mean_reversion":
        manage_exits_mean_reversion(config, broker, state, universe)
        filled = process_pending_orders_mean_reversion(config, broker, state, universe)
        signaled = find_new_signals_mean_reversion(config, state, universe)
        logger.info("=== run complete: %d open positions, %d filled today, %d new signals queued for tomorrow ===",
                    state.count_open(), len(filled), len(signaled))
    elif config.strategy_style == "breakout":
        manage_exits_breakout(config, broker, state, universe)
        opened = find_new_entries_breakout(config, broker, state, universe)
        logger.info("=== run complete: %d open positions, %d new entries this run ===",
                    state.count_open(), len(opened))
    else:
        raise ValueError(f"unknown strategy_style: {config.strategy_style!r} (expected 'breakout' or 'mean_reversion')")


if __name__ == "__main__":
    run_daily_cycle()
