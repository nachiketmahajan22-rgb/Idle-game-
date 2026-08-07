"""Historical/live OHLCV data access.

Default source is `yfinance` (free, no broker credentials needed) — good
for paper trading and backtesting. When running live against Kite, prefer
`fetch_history_kite` so prices match your broker's feed exactly.
"""
from __future__ import annotations

import csv
from pathlib import Path

import pandas as pd
import yfinance as yf

from swing_agent.config import Config


def load_universe_symbols(config: Config) -> list[str]:
    path = Path(config.universe_path)
    symbols = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sym = row.get("symbol", "").strip()
            if sym:
                symbols.append(sym)
    return symbols


def _to_yfinance_ticker(nse_symbol: str) -> str:
    return f"{nse_symbol}.NS"


def fetch_history_yfinance(symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    """Returns a DataFrame with columns open/high/low/close/volume, ascending
    by date. Empty DataFrame if the symbol has no data."""
    ticker = _to_yfinance_ticker(symbol)
    raw = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=True)
    if raw.empty:
        return raw
    df = raw.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
    return df[["open", "high", "low", "close", "volume"]].dropna()


def fetch_history_kite(kite_client, instrument_token: int, from_date, to_date, interval: str = "day") -> pd.DataFrame:
    """`kite_client` is an authenticated `kiteconnect.KiteConnect` instance.
    `instrument_token` must be looked up once via kite.instruments('NSE')
    and cached — Kite's historical API takes tokens, not symbols."""
    candles = kite_client.historical_data(instrument_token, from_date, to_date, interval)
    df = pd.DataFrame(candles)
    if df.empty:
        return df
    df = df.rename(columns={"date": "timestamp"}).set_index("timestamp")
    return df[["open", "high", "low", "close", "volume"]]


def load_universe_history(config: Config, symbols: list[str] | None = None, period: str = "1y") -> dict[str, pd.DataFrame]:
    """Bulk-fetch history for the whole (or a given) symbol list via
    yfinance. Skips symbols with no/insufficient data rather than raising,
    so one delisted/renamed ticker doesn't kill the whole scan."""
    symbols = symbols or load_universe_symbols(config)
    out: dict[str, pd.DataFrame] = {}
    for sym in symbols:
        df = fetch_history_yfinance(sym, period=period)
        if not df.empty:
            out[sym] = df
    return out
