# Swing Trading Agent (NSE)

An algorithmic swing-trading agent for Indian equities (NSE). Two top-level
strategies, switchable via `strategy_style` in `config/settings.yaml`:

- **`strategy_style: breakout`** (default) — Donchian-channel breakout +
  ATR risk (or the Kar-style variant, both selectable within this strategy —
  see below). Trend-following: needs sustained directional moves to pay off.
- **`strategy_style: mean_reversion`** — buys pullbacks to `MA5 −
  N×ATR5` in stocks still above their long-term trend, exits on the first
  up-day or a max hold. Built specifically because breakout backtested weak
  in the choppy Nifty market since late 2024 (see
  [Strategy comparison](#strategy-comparison) below) — but its edge is much
  smaller once realistic transaction costs are applied, since it trades far
  more often than breakout. Read that section before picking one.

Within `strategy_style: breakout`, two further sub-modes:

- **`screener_mode: simple` / `stop_method: atr`** (the default, recommended):
  N-day high/low breakout filtered by a long-term trend SMA and a liquidity
  floor, with an **ATR-scaled stop** and no fixed take-profit — the mechanic
  behind the classic Turtle Trading system. Fewer, more robust conditions
  than a stacked indicator screener, and immune to a real bug the original
  version had (see below).
- **`screener_mode: full` / `stop_method: candle`**: modeled on the
  publicly-taught approach of trader/educator **Abhishek Kar** — price-action
  breakouts filtered through an RSI/MACD/volume technical shortlist, with the
  stop at the breakout candle's low/high and a fixed range-projected target.
  Kept for comparison/backtesting.

All strategies/modes share the same risk management, broker layer,
backtester, transaction-cost model, and paper/live safety gates below.

> **Disclaimer**: The "full" mode is an independent, educational
> implementation inferred from Abhishek Kar's public YouTube content and his
> public [Chartink screener](https://chartink.com/screener/abhishek-kar-swing-2).
> It is **not affiliated with, endorsed by, or reviewed by Abhishek Kar**.
> Swing trading and algorithmic trading carry real financial risk — you can
> lose money, including more than you invest if you misconfigure risk
> settings. Nothing here is investment advice. Test extensively in **paper
> mode** before ever enabling live orders, and comply with your broker's and
> SEBI's algo-trading rules (see [Going Live](#going-live) below).

## Why the "simple" mode is the default

The original implementation stacked five conditions on the same bar — RSI
band, SMA, MACD histogram, volume surge, near-range proximity — plus a stop
at the breakout candle's exact low/high. Two problems surfaced in testing:

1. **A tight, single-candle stop can be tiny.** One breakout bar with a
   skinny wick gave a ₹0.42 stop distance, which a 1%-risk position sizer
   turned into a 2,400-share order worth ~2.5x the entire account — a real
   bug, not a hypothetical one. `stop_method: atr` fixes this at the root:
   the stop is `entry ± atr_stop_multiple × ATR`, so it scales with the
   stock's actual volatility and can never be accidentally razor-thin.
2. **Five correlated conditions checked on the same bar overfit easily**, and
   in practice reject most real breakouts (momentum naturally pushes RSI up
   *as the breakout happens*, so gating the screener's RSI band on the same
   bar as the trigger throws out the very moves you want). `screener_mode:
   simple` uses two robust, independent conditions instead — long-term trend
   and liquidity — and the breakout channel itself, not RSI, decides timing.

Removing the fixed take-profit (`use_fixed_target: false`) follows the same
logic: trend-following systems let the trailing stop harvest a trade rather
than capping the upside on the wins that are supposed to pay for the losses.

## Strategy summary

Kar describes stock selection as ~40% of the edge and risk
management/psychology/position-sizing as ~50%. This agent encodes both
halves, in either mode:

1. **Shortlist (screener)** — `swing_agent/strategy/screener.py`
   - `simple` (default): price above its `trend_sma_period`-day SMA (200 by
     default) and average volume above `min_avg_volume` — trade with the
     trend, only in liquid names.
   - `full`: approximates the public "Abhishek Kar Swing" Chartink scan —
     RSI in a bullish-but-not-overbought band, price above its 26-period SMA,
     positive MACD histogram, and a volume surge versus the recent average.
     Optional fundamental filters (PE, dividend yield) can be layered in if
     you provide a fundamentals data source.

2. **Entry trigger (price action)** — `swing_agent/strategy/breakout.py`
   Same in both modes: a daily close **above the prior `lookback_range_days`
   high** (long) or **below the prior low** (short) — a Donchian-channel
   breakout, no indicators required at this stage. This is also exactly the
   price-action trigger Kar teaches (breakout of previous day/month's range).

3. **Risk management** — `swing_agent/risk/position_sizing.py`
   - Stop-loss (`stop_method: atr`, default): `entry ± atr_stop_multiple ×
     ATR`, scaled to the stock's actual volatility.
     (`stop_method: candle`, Kar-style): the breakout candle's opposite
     extreme (low for longs, high for shorts).
   - Either way, the stop is **never widened**, only trailed once the
     trade is in profit.
   - Position size = `(account_risk_pct × capital) / (entry − stop)`, so
     every trade risks a fixed, small percentage of capital regardless of
     the stock's price or volatility — then capped so the order can never
     cost more than available margin, even if that means risking less than
     the target % on an unusually tight stop.
   - Hard caps on concurrent open positions and (optional) daily loss limit
     act as circuit breakers.

4. **Execution** — `swing_agent/broker/`
   A broker-agnostic interface (`BrokerInterface`) with two implementations:
   - `PaperBroker` — simulates fills against live/historical prices, the
     **default** and safe for testing. Deducts realistic transaction costs
     (see below) on every fill so simulated cash matches what you'd keep.
   - `KiteBroker` — places real CNC (delivery) orders via Zerodha's Kite
     Connect API. Only used when `LIVE_TRADING=true` and you've supplied API
     credentials. **Live trading is currently only supported for
     `strategy_style: breakout`** — mean-reversion's live path needs real
     limit-order placement and fill-status polling that isn't built yet;
     `run_daily_cycle` refuses to run it live and tells you so.

5. **Transaction costs** — `swing_agent/costs.py`
   STT, exchange transaction charges, stamp duty, GST, and DP charges
   (current 2026 rates for a ₹0-brokerage discount broker like Zerodha),
   applied to every trade in the backtester and in `PaperBroker`. This
   matters more for mean-reversion than breakout — it trades far more often,
   so flat per-trade fees (the DP charge especially) eat a larger share of
   its smaller, more frequent gains.

## Mean-reversion strategy — `swing_agent/strategy/mean_reversion.py`

Rules (adapted from a publicly-described NSE approach — [Cracking
Markets](https://crackingmarkets.substack.com/p/swing-mean-reversion-strategies-in)):

1. **Shortlist**: price above its long-term trend SMA, liquid
   (`min_avg_volume`), volatile enough to be worth trading (`mr_min_atr_pct`
   floor on ATR5/close).
2. **Signal**: today's close pulls below `MA5 - mr_entry_atr_multiple ×
   ATR5` — a short-term oversold dip within a longer uptrend.
3. **Entry**: a limit order for the *next* trading day at `signal_close -
   mr_limit_atr_multiple × ATR5`, valid for that one day only — if the low
   never reaches it, the signal expires unfilled, no chasing.
4. **Exit**: whichever comes first — a hard stop at `entry -
   mr_stop_atr_multiple × ATR5` (added on top of the original rule set,
   which relied only on the time exit below), the first day price closes
   higher than the previous day's close, or `mr_max_hold_days` elapsed.

This produces a **signal-today, fill-tomorrow** limit order that must
persist across daily runs — tracked as `PendingOrder`s in
`swing_agent/state.py`, resolved (filled or expired) within one trading day
each.

## Project layout

```
swing_agent/
  config.py            # loads config/settings.yaml + .env secrets
  agent.py              # orchestrates both strategies' daily cycles
  backtest.py           # replay either strategy over historical OHLCV data
  costs.py               # NSE delivery transaction cost model
  state.py                # positions + pending limit orders, persisted to JSON
  broker/
    base.py             # BrokerInterface (abstract)
    paper_broker.py      # simulated broker (default, safe), applies costs
    kite_broker.py        # Zerodha Kite Connect (real orders)
  data/
    market_data.py        # historical/live OHLCV fetch (yfinance for backtest, Kite for live)
  strategy/
    screener.py            # breakout strategy: stock shortlist filters
    breakout.py             # breakout strategy: price-action entry/exit rules
    mean_reversion.py        # mean-reversion strategy: screen + signal + exit rules
    indicators.py             # shared RSI/SMA/MACD/ATR helpers
  risk/
    position_sizing.py         # position sizing + exposure limits (shared)
  notify/
    telegram.py                 # optional trade alerts via Telegram
config/
  settings.yaml               # capital, risk %, universe, strategy, cost, live/paper toggles
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
| `strategy_style` | `breakout` (default) or `mean_reversion` | `breakout` |
| `capital` | Total capital allocated to this strategy (₹) | `50000` |
| `risk_pct_per_trade` | Fraction of capital risked per trade | `0.01` (1%) |
| `max_open_positions` | Max concurrent swing positions | `5` |
| `max_daily_loss_pct` | Circuit breaker: stop new entries after this much is lost in a day | `0.03` (3%) |
| `screener_mode` | breakout only: `simple` (recommended) or `full` (Kar-style) | `simple` |
| `trend_sma_period` | `simple` screener / mean-reversion: trend filter SMA length | `200` |
| `min_avg_volume` | liquidity floor, avg shares/day (both strategies) | `200000` |
| `lookback_range_days` | breakout: Donchian lookback window | `20` |
| `rsi_min` / `rsi_max` | `full` screener: RSI band | `50` / `70` |
| `sma_period` | `full` screener: shorter trend filter SMA length | `26` |
| `volume_surge_multiple` | `full` screener: min volume vs. 20-day average to qualify | `1.5` |
| `stop_method` | breakout: `atr` (recommended) or `candle` (Kar-style) | `atr` |
| `atr_stop_multiple` | `atr` stop mode: stop distance in ATR multiples | `2.5` |
| `use_fixed_target` | breakout: `false` (recommended, let stop trail) or `true` (Kar-style fixed target) | `false` |
| `mr_ma_period` / `mr_atr_period` | mean-reversion: short MA/ATR periods for the pullback band | `5` / `5` |
| `mr_entry_atr_multiple` | mean-reversion: signal threshold, `MA5 - N×ATR5` | `1.0` |
| `mr_limit_atr_multiple` | mean-reversion: next-day limit price offset | `0.75` |
| `mr_stop_atr_multiple` | mean-reversion: hard stop offset | `2.0` |
| `mr_max_hold_days` | mean-reversion: force-exit after this many days | `5` |
| `mr_min_atr_pct` | mean-reversion: skip stocks quieter than this (ATR5/close) | `0.005` |
| `stt_pct` / `dp_charge_flat` / etc. | transaction cost model — see `swing_agent/costs.py` | current Zerodha rates |
| `live_trading` | Master switch for real order placement (breakout only — see above) | `false` |
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
