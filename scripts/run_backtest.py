#!/usr/bin/env python3
"""Backtest entrypoint:

    python scripts/run_backtest.py --start 2023-01-01 --end 2024-12-31
    python scripts/run_backtest.py --start 2023-01-01 --end 2024-12-31 --symbols RELIANCE TCS INFY
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swing_agent.backtest import run_backtest
from swing_agent.config import load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="Backtest the swing agent strategy")
    parser.add_argument("--start", required=True, help="Start date, YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="End date, YYYY-MM-DD")
    parser.add_argument("--symbols", nargs="*", default=None, help="Override universe (default: config/watchlist.csv)")
    args = parser.parse_args()

    config = load_config()
    result = run_backtest(config, args.start, args.end, symbols=args.symbols)

    print(f"\nBacktest {args.start} -> {args.end}")
    print(result.summary())
    print("\nTrades:")
    for t in result.trades:
        print(f"  {t.entry_date} -> {t.exit_date}  {t.symbol:12s} {t.side:5s} qty={t.quantity:5d} "
              f"entry={t.entry_price:8.2f} exit={t.exit_price:8.2f} pnl={t.pnl:10.2f} R={t.r_multiple:5.2f} [{t.exit_reason}]")


if __name__ == "__main__":
    main()
