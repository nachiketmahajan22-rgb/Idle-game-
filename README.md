# Swing Trading Agent — Abhishek Kar Strategy (NSE)

An algorithmic swing-trading agent for Indian equities (NSE), modeled on the
publicly-taught approach of trader/educator **Abhishek Kar**: price-action
breakouts filtered through a technical shortlist, strict stop-loss risk
management, and low trade frequency.

> **Disclaimer**: This project is an independent, educational implementation
> inferred from Abhishek Kar's public YouTube content and his public
> [Chartink screener](https://chartink.com/screener/abhishek-kar-swing-2). It
> is **not affiliated with, endorsed by, or reviewed by Abhishek Kar**. Swing
> trading and algorithmic trading carry real financial risk — you can lose
> money, including more than you invest if you misconfigure risk settings.
> Nothing here is investment advice. Test extensively in **paper mode**
> before ever enabling live orders, and comply with your broker's and
> SEBI's algo-trading rules (see [Going Live](#going-live) below).

## Strategy summary

Kar describes stock selection as ~40% of the edge and risk
management/psychology/position-sizing as ~50%. This agent encodes both
halves:

1. **Shortlist (screener)** — `swing_agent/strategy/screener.py`
   Scans a universe of NSE stocks for technical setups similar to the public
   "Abhishek Kar Swing" Chartink scan: RSI in a bullish-but-not-overbought
   band, price above its 26/50-period SMA, a recent breakout of the prior
   month's trading range, and a volume surge versus the recent average.
   Optional fundamental filters (PE, dividend yield) can be layered in if you
   provide a fundamentals data source.

2. **Entry trigger (price action)** — `swing_agent/strategy/breakout.py`
   For stocks that clear the shortlist, the agent waits for the pure
   price-action trigger Kar teaches: a daily close **above the previous
   day/month's high** (long) or **below the previous low** (short), i.e. a
   breakout of the prior range — no indicators required at this stage.

3. **Risk management** — `swing_agent/risk/position_sizing.py`
   - Stop-loss is placed at the breakout candle's opposite extreme (low for
     longs, high for shorts) and is **never widened**, only trailed once the
     trade is in profit.
   - Position size = `(account_risk_pct × capital) / (entry − stop)`, so
     every trade risks a fixed, small percentage of capital regardless of
     the stock's price or volatility.
   - Hard caps on concurrent open positions and (optional) daily loss limit
     act as circuit breakers.

4. **Execution** — `swing_agent/broker/`
   A broker-agnostic interface (`BrokerInterface`) with two implementations:
   - `PaperBroker` — simulates fills against live/historical prices, the
     **default** and safe for testing.
   - `KiteBroker` — places real CNC (delivery) orders via Zerodha's Kite
     Connect API. Only used when `LIVE_TRADING=true` and you've supplied API
     credentials.

## Project layout

```
swing_agent/
  config.py            # loads config/settings.yaml + .env secrets
  agent.py              # orchestrates: screen -> confirm breakout -> size -> order
  backtest.py           # replay the strategy over historical OHLCV data
  broker/
    base.py             # BrokerInterface (abstract)
    paper_broker.py      # simulated broker (default, safe)
    kite_broker.py        # Zerodha Kite Connect (real orders)
  data/
    market_data.py        # historical/live OHLCV fetch (yfinance for backtest, Kite for live)
  strategy/
    screener.py            # stock shortlist filters
    breakout.py             # price-action entry/exit rules
  risk/
    position_sizing.py       # position sizing + exposure limits
  notify/
    telegram.py               # optional trade alerts via Telegram
config/
  settings.yaml               # capital, risk %, universe, live/paper toggle
  watchlist.csv                # sample NSE stock universe to scan
scripts/
  run_agent.py                  # daily entrypoint (cron/scheduler target)
  run_backtest.py                # backtest entrypoint
tests/                             # unit tests, no network calls
```

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in broker/telegram credentials
```

Edit `config/settings.yaml` to set your capital, risk per trade, max
positions, and stock universe (or point `universe_file` at your own CSV of
NSE trading symbols).

## Running

**Paper trading (default, safe):**

```bash
python scripts/run_agent.py
```

This scans the universe, applies the screener + breakout rules, sizes any
signals, and logs simulated fills to `logs/trades.csv` — no real orders are
placed. Run it once daily after market close (e.g. via cron/APScheduler) to
build tomorrow's watchlist, or intraday during the first/last hour per Kar's
timing guidance.

**Backtest:**

```bash
python scripts/run_backtest.py --start 2023-01-01 --end 2024-12-31
```

Prints win rate, average R-multiple, max drawdown, and equity curve stats
so you can sanity-check the rules **before** risking capital.

### Going live

Live order placement is gated behind two independent switches so it can
never happen by accident:

1. `config/settings.yaml`: `live_trading: true`
2. Environment: `LIVE_TRADING=true` in `.env`, plus valid `KITE_API_KEY`,
   `KITE_API_SECRET`, and a fresh `KITE_ACCESS_TOKEN` (Kite access tokens
   expire daily — regenerate each morning per Kite Connect's login flow).

When both are set, `scripts/run_agent.py` will additionally require a typed
`yes` confirmation at startup before it will place a single real order.

Before going live: read [Zerodha's Kite Connect algo-trading
requirements](https://kite.trade) and SEBI's algo order-tagging rules — as
of recent circulars, algo orders placed via API need to be tagged and, for
retail algo strategies, may need to be registered with your broker.

## Configuration reference (`config/settings.yaml`)

| Key | Meaning | Default |
|---|---|---|
| `capital` | Total capital allocated to this strategy (₹) | `100000` |
| `risk_pct_per_trade` | Fraction of capital risked per trade | `0.01` (1%) |
| `max_open_positions` | Max concurrent swing positions | `5` |
| `max_daily_loss_pct` | Circuit breaker: stop new entries after this much is lost in a day | `0.03` (3%) |
| `rsi_min` / `rsi_max` | Screener RSI band | `50` / `70` |
| `sma_period` | Trend filter moving average length | `26` |
| `volume_surge_multiple` | Min volume vs. 20-day average to qualify | `1.5` |
| `live_trading` | Master switch for real order placement | `false` |
| `universe_file` | CSV of NSE symbols to scan | `config/watchlist.csv` |

## Limitations & honesty notes

- Abhishek Kar has not published a single canonical, fully-parameterized
  rule set — this implementation is a reasonable codification of what he
  teaches publicly (breakout of prior range, strict stop, 40/50/10 weighting
  of selection/risk/psychology). Treat the exact RSI/SMA/volume thresholds
  as a starting point to backtest and tune, not gospel.
- The Chartink screener's exact clause values weren't extractable
  programmatically (Chartink renders filters client-side); the screener
  logic here approximates its stated inputs (RSI, MACD, PE, breakout,
  volume). If you want an exact match, open the screener in a browser,
  copy its "Create Alert" clause text, and paste it into
  `swing_agent/strategy/screener.py`.
- Fundamental filters (PE, book value, dividend yield) need a data source
  not wired up by default (Kite doesn't provide fundamentals) — hooks are
  left in place in `screener.py` for you to plug one in.
