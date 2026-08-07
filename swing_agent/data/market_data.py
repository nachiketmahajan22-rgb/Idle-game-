"""Historical/live OHLCV data access.

Default source is `yfinance` (free, no broker credentials needed) — good
for paper trading and backtesting. When running live against Kite, prefer
`fetch_history_kite` so prices match your broker's feed exactly.

`yfinance`'s underlying HTTP client (`curl_cffi`) impersonates a browser's
TLS fingerprint to get past Yahoo's bot detection, which fails outright
behind some TLS-intercepting corporate/sandbox proxies (SSL errors, not
just slow). `fetch_history_yfinance` automatically falls back to a plain
`requests` call against Yahoo's public chart API (which only needs a
normal User-Agent header, no fingerprinting) when the yfinance library
call raises — so this keeps working in those environments without any
config change.
"""
from __future__ import annotations

import csv
import time
from pathlib import Path

import pandas as pd
import requests
import yfinance as yf

from swing_agent.config import Config

_YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{ticker}"
_HTTP_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/122.0 Safari/537.36"),
}


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


def _fetch_via_yfinance_lib(ticker: str, period: str, interval: str) -> pd.DataFrame:
    raw = yf.Ticker(ticker).history(period=period, interval=interval, auto_adjust=True)
    if raw.empty:
        return raw
    df = raw.rename(columns={"Open": "open", "High": "high", "Low": "low", "Close": "close", "Volume": "volume"})
    df = df[["open", "high", "low", "close", "volume"]].dropna()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    return df


def _fetch_via_yahoo_http(ticker: str, period: str, interval: str, retries: int = 3) -> pd.DataFrame:
    """Direct call to Yahoo's public chart JSON API with a plain browser
    User-Agent — no TLS fingerprint impersonation, so it works through
    proxies that break curl_cffi. `period` accepts the same range tokens
    as yfinance (e.g. '1y', '2y', '5y', 'max')."""
    url = _YAHOO_CHART_URL.format(ticker=ticker)
    params = {"range": period, "interval": interval}

    last_error: Exception | None = None
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=_HTTP_HEADERS, params=params, timeout=15)
            if resp.status_code == 429:
                time.sleep(1.5 * (attempt + 1))
                continue
            resp.raise_for_status()
            data = resp.json()
            result = data.get("chart", {}).get("result")
            if not result:
                return pd.DataFrame()

            r = result[0]
            timestamps = r.get("timestamp")
            if not timestamps:
                return pd.DataFrame()
            quote = r["indicators"]["quote"][0]
            gmtoffset = r.get("meta", {}).get("gmtoffset", 0)

            df = pd.DataFrame({
                "open": quote.get("open"), "high": quote.get("high"),
                "low": quote.get("low"), "close": quote.get("close"),
                "volume": quote.get("volume"),
            })
            # Yahoo timestamps are UTC seconds at the exchange's local open;
            # shift by the exchange's UTC offset before truncating to a date
            # so bars land on the correct trading day.
            local_ts = pd.to_datetime(timestamps, unit="s", utc=True) + pd.Timedelta(seconds=gmtoffset)
            df.index = local_ts.tz_localize(None).normalize()
            return df.dropna(subset=["open", "high", "low", "close"])
        except (requests.RequestException, KeyError, ValueError, IndexError) as exc:
            last_error = exc
            time.sleep(0.5 * (attempt + 1))

    if last_error:
        raise last_error
    return pd.DataFrame()


def fetch_history_yfinance(symbol: str, period: str = "1y", interval: str = "1d") -> pd.DataFrame:
    """Returns a DataFrame with columns open/high/low/close/volume, ascending
    by date. Empty DataFrame if the symbol has no data. Tries the yfinance
    library first, falls back to a direct Yahoo HTTP call on any failure
    (network, TLS, or empty result)."""
    ticker = _to_yfinance_ticker(symbol)
    try:
        df = _fetch_via_yfinance_lib(ticker, period, interval)
        if not df.empty:
            return df
    except Exception:
        pass
    return _fetch_via_yahoo_http(ticker, period, interval)


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
