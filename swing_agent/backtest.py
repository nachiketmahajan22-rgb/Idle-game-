"""Walk-forward backtest: replays the exact screener + breakout + risk
rules used live, one trading day at a time, so backtest results reflect
what the agent would actually have done — not a vectorized approximation.

Performance note: this recomputes indicators on an expanding window for
every symbol on every day, which is O(days x symbols x indicator_cost).
Fine for a watchlist of a few dozen stocks over a few years (seconds to low
minutes); for large universes, consider caching indicator series and
slicing instead of recomputing from scratch.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pandas as pd

from swing_agent.config import Config
from swing_agent.data.market_data import fetch_history_yfinance, load_universe_symbols
from swing_agent.risk.position_sizing import ExposureGuard, size_position
from swing_agent.strategy.breakout import detect_breakout, update_trailing_stop
from swing_agent.strategy.screener import screen_symbol


@dataclass
class BacktestTrade:
    symbol: str
    side: str
    quantity: int
    entry_price: float
    exit_price: float
    entry_date: str
    exit_date: str
    exit_reason: str
    pnl: float
    risk_amount: float

    @property
    def r_multiple(self) -> float:
        return self.pnl / self.risk_amount if self.risk_amount else 0.0


@dataclass
class BacktestResult:
    trades: list[BacktestTrade] = field(default_factory=list)
    equity_curve: pd.Series = field(default_factory=lambda: pd.Series(dtype=float))

    @property
    def win_rate(self) -> float:
        if not self.trades:
            return 0.0
        wins = sum(1 for t in self.trades if t.pnl > 0)
        return wins / len(self.trades)

    @property
    def avg_r_multiple(self) -> float:
        if not self.trades:
            return 0.0
        return sum(t.r_multiple for t in self.trades) / len(self.trades)

    @property
    def total_pnl(self) -> float:
        return sum(t.pnl for t in self.trades)

    @property
    def max_drawdown_pct(self) -> float:
        if self.equity_curve.empty:
            return 0.0
        running_max = self.equity_curve.cummax()
        drawdown = (self.equity_curve - running_max) / running_max
        return float(drawdown.min())

    def summary(self) -> str:
        return (
            f"Trades: {len(self.trades)} | Win rate: {self.win_rate:.1%} | "
            f"Avg R: {self.avg_r_multiple:.2f} | Total P&L: {self.total_pnl:,.2f} | "
            f"Max drawdown: {self.max_drawdown_pct:.1%}"
        )


def run_backtest(config: Config, start_date: str, end_date: str, symbols: list[str] | None = None) -> BacktestResult:
    symbols = symbols or load_universe_symbols(config)

    history: dict[str, pd.DataFrame] = {}
    for sym in symbols:
        df = fetch_history_yfinance(sym, period="max")
        if not df.empty:
            df.index = pd.to_datetime(df.index).tz_localize(None)
            history[sym] = df

    if not history:
        return BacktestResult()

    all_dates = sorted(set().union(*[set(df.index) for df in history.values()]))
    trading_dates = [d for d in all_dates if pd.Timestamp(start_date) <= d <= pd.Timestamp(end_date)]

    cash = config.capital
    open_positions: dict[str, dict] = {}
    trades: list[BacktestTrade] = []
    equity_points: list[tuple[pd.Timestamp, float]] = []
    realized_today: dict[pd.Timestamp, float] = {}

    guard = ExposureGuard(
        max_open_positions=config.max_open_positions,
        max_daily_loss_pct=config.max_daily_loss_pct,
        capital=config.capital,
    )

    for today in trading_dates:
        day_realized = 0.0

        # 1. Manage exits on open positions using today's bar
        for sym in list(open_positions.keys()):
            df = history.get(sym)
            if df is None or today not in df.index:
                continue
            df_upto_today = df.loc[:today]
            pos = open_positions[sym]
            last_low = float(df_upto_today["low"].iloc[-1])
            last_high = float(df_upto_today["high"].iloc[-1])

            exit_price, exit_reason = None, None
            if pos["side"] == "long":
                if last_low <= pos["stop_loss"]:
                    exit_price, exit_reason = pos["stop_loss"], "stop_loss_hit"
                elif pos["target_price"] is not None and last_high >= pos["target_price"]:
                    exit_price, exit_reason = pos["target_price"], "target_hit"
            else:
                if last_high >= pos["stop_loss"]:
                    exit_price, exit_reason = pos["stop_loss"], "stop_loss_hit"
                elif pos["target_price"] is not None and last_low <= pos["target_price"]:
                    exit_price, exit_reason = pos["target_price"], "target_hit"

            if exit_price is not None:
                direction = 1 if pos["side"] == "long" else -1
                pnl = (exit_price - pos["entry_price"]) * pos["quantity"] * direction
                cash += pos["entry_price"] * pos["quantity"] + pnl if pos["side"] == "long" else pos["entry_price"] * pos["quantity"] - pnl
                day_realized += pnl
                trades.append(BacktestTrade(
                    symbol=sym, side=pos["side"], quantity=pos["quantity"],
                    entry_price=pos["entry_price"], exit_price=exit_price,
                    entry_date=str(pos["entry_date"].date()), exit_date=str(today.date()),
                    exit_reason=exit_reason, pnl=pnl, risk_amount=pos["risk_amount"],
                ))
                del open_positions[sym]
            else:
                new_stop = update_trailing_stop(
                    side=pos["side"], entry_price=pos["entry_price"], initial_stop=pos["stop_loss"],
                    current_stop=pos["stop_loss"], ohlcv=df_upto_today, config=config,
                )
                pos["stop_loss"] = new_stop

        # 2. Look for new entries
        for sym, df in history.items():
            if sym in open_positions or today not in df.index:
                continue
            can_open, _ = guard.can_open_new_position(
                currently_open=len(open_positions), realized_pnl_today=day_realized,
            )
            if not can_open:
                break

            df_upto_today = df.loc[:today]
            # Screen on data through yesterday, confirm the breakout trigger
            # on today's bar — see the matching comment in agent.py.
            screen = screen_symbol(sym, df_upto_today.iloc[:-1], config) if len(df_upto_today) > 1 else None
            if screen is None or not screen.passed:
                continue
            signal = detect_breakout(sym, df_upto_today, config)
            if not signal.triggered:
                continue
            if signal.side == "short" and not config.allow_shorts:
                continue

            sizing = size_position(
                capital=config.capital, risk_pct_per_trade=config.risk_pct_per_trade,
                entry_price=signal.entry_price, stop_loss_price=signal.stop_loss,
                target_price=signal.target_price, reward_risk_min=config.reward_risk_min,
                side=signal.side,
            )
            if not sizing.is_valid:
                continue

            # Note: cash accounting here assumes a long (cash outlay at entry,
            # proceeds at exit). Shorts are gated off by default (allow_shorts:
            # false) because NSE cash-equity CNC delivery can't hold an
            # overnight short in the first place — if you extend this to
            # F&O/MIS shorting, model margin instead of a cash debit here.
            cost = signal.entry_price * sizing.quantity
            if cost > cash:
                continue  # not enough backtest cash to take this position

            cash -= cost
            open_positions[sym] = {
                "side": signal.side, "quantity": sizing.quantity, "entry_price": signal.entry_price,
                "stop_loss": signal.stop_loss, "target_price": signal.target_price,
                "entry_date": today, "risk_amount": sizing.risk_amount,
            }

        # 3. Mark-to-market equity for this day
        mtm = cash
        for sym, pos in open_positions.items():
            df = history.get(sym)
            if df is not None and today in df.index:
                price = float(df.loc[today, "close"])
                direction = 1 if pos["side"] == "long" else -1
                mtm += pos["entry_price"] * pos["quantity"] + (price - pos["entry_price"]) * pos["quantity"] * direction
        equity_points.append((today, mtm))

    equity_curve = pd.Series({d: v for d, v in equity_points}).sort_index()
    return BacktestResult(trades=trades, equity_curve=equity_curve)
