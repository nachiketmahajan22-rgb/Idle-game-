# Positional Trading Agent (NSE)

An algorithmic **positional** trading agent for Indian equities (NSE) —
holds weeks to months per trade, not days. Two top-level strategies,
switchable via `strategy_style` in `config/settings.yaml`:

- **`strategy_style: breakout`** (default, the active focus) —
  Donchian-channel breakout + ATR risk, tuned for a positional (~130-160
  day average) hold: a 55-day breakout lookback, a wide 4×ATR stop, and a
  loose trailing stop that doesn't arm until 2R profit — see
  [Why these are positional, not swing, settings](#why-these-are-positional-not-swing-settings)
  below for the reasoning and the numbers behind each choice. Filtered by
  a market-regime + relative-strength gate — see
  [Regime & relative-strength filters](#regime--relative-strength-filters).
- **`strategy_style: mean_reversion`** — buys pullbacks to `MA5 −
  N×ATR5`, exits on the first up-day or a max hold of days. Structurally a
  **1-5 day** hold — cannot serve a positional goal no matter how it's
  tuned. Built and tested earlier as an alternative to swing breakout (see
  [Strategy comparison](#strategy-comparison)), and the code stays in the
  repo, working and tested — but it's **parked, not actively developed**,
  since the actual goal here is positional trading, which this can't be.

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

## Why these are positional, not swing, settings

The breakout parameters below were originally tuned for swing trading
(~30-40 day average hold): `lookback_range_days: 20`, `atr_stop_multiple:
2.5`, `trail_after_r_multiple: 1.0`, `atr_trail_multiple: 2.0`. Backtested
against real NSE data, that swing configuration lost money in 5 of 6
strategy×universe×window combinations tested. Widening every one of those
four parameters for a genuinely positional hold changed that:

| Parameter | Swing value | Positional value (current default) | Why |
|---|---|---|---|
| `lookback_range_days` | 20 | **55** | Breaks out of a long-term range, not a short-term one |
| `atr_stop_multiple` | 2.5 | **4.0** | A multi-month hold needs room to breathe without getting stopped on normal noise |
| `trail_after_r_multiple` | 1.0 | **2.0** | Don't start protecting profit until the trade has proven itself further |
| `atr_trail_multiple` | 2.0 | **3.5** | Trail looser once armed, so a real trend isn't cut short |

Backtest comparison (₹50,000 capital, Nifty 50, full 4-year window,
transaction costs applied):

| Config | Trades | Win% | Avg R | Net P&L | Max DD | Avg hold |
|---|---|---|---|---|---|---|
| Swing | 170 | 45.9% | -0.05 | -₹4,542 | -19.8% | 39 days |
| **Positional** | 42 | 38.1% | **0.84** | **+₹17,645** | -13.7% | **162 days** |

Trade count drops ~4x (fewer, more selective entries) and avg R-multiple
goes from slightly negative to genuinely strong. See
[Strategy comparison](#strategy-comparison) below for the full
multi-window picture, including the recent-window weakness that motivated
the regime/relative-strength filters in the next section — the positional
config alone still isn't reliably profitable in the last 1-2 years by
itself; it needed those filters too.

## Regime & relative-strength filters

Neither swing nor positional breakout was consistently profitable in the
last 1-2 years on either universe — the underlying issue turned out to be
regime, not holding period: Nifty has been genuinely choppy/range-bound
since late 2024 (tariff-led correction in early 2025, an oil/geopolitics
selloff in 2026, sustained FPI selling), which punishes trend-following
breakouts regardless of parameters.

Research into established, long-track-record screening systems (Mark
Minervini's Trend Template, William O'Neil's CANSLIM/IBD) found the one
ingredient every credible system checks that this screener didn't:
**relative strength vs. the market**, paired with a **market-regime
filter** (only trade with the prevailing trend). Both are implemented in
`swing_agent/strategy/regime.py`:

- **`use_regime_filter`**: only take new trades when the benchmark index
  itself (`regime_index_symbol` — `^NSEI` for Nifty 50, `^CNX200` for
  Nifty 200) is above its own `regime_sma_period`-day SMA. Skips all new
  entries on days the broader market is unhealthy, regardless of how good
  an individual stock's breakout looks.
- **`use_relative_strength_filter`**: only trade stocks whose IBD-style
  relative strength (a 40/20/20/20-weighted rate-of-change over
  `rs_lookback_days`, `swing_agent/strategy/regime.py::relative_strength`)
  beats the benchmark index's by at least `rs_min_relative_return` — only
  trade actual leaders, not stocks merely drifting up with the market.

A/B backtested against the positional baseline, both on (₹50,000 capital, transaction costs applied):

| Variant | Universe | Window | Trades | Win% | Avg R | Net P&L | Max DD |
|---|---|---|---|---|---|---|---|
| Baseline | Nifty 50 | Last 1yr | 17 | 23.5% | -0.41 | -₹3,448 | -12.1% |
| +regime | Nifty 50 | Last 1yr | 12 | 33.3% | -0.17 | -₹1,000 | -7.8% |
| **+regime+RS** | Nifty 50 | Last 1yr | **9** | **66.7%** | **+0.47** | **+₹2,132** | **-4.6%** |
| Baseline | Nifty 200 | Last 1yr | 23 | 30.4% | -0.24 | -₹2,742 | -14.4% |
| +regime | Nifty 200 | Last 1yr | 17 | 29.4% | -0.25 | -₹2,126 | -11.1% |
| **+regime+RS** | Nifty 200 | Last 1yr | **12** | **41.7%** | **+0.24** | **+₹1,439** | **-5.3%** |

**Both on by default** — the combined filter turned avg R-multiple from
clearly negative to clearly positive in the most recent year, **on both
universes independently**, roughly doubled-to-tripled win rate, and cut
max drawdown by more than half. Regime alone wasn't consistently better;
relative strength is doing most of the work.

**Two honest caveats, read before trusting this**:
1. **Small sample** — only 9 and 12 trades in the winning last-1yr rows.
   Directionally consistent across two independent universes (a real
   signal, not noise from one lucky universe), but a handful of trades
   either way could still flip the sign. Re-validate over time before
   trusting this as settled.
2. **It costs some historical upside** — Nifty 50's full-4-year P&L drops
   from +₹17,645 (baseline) to +₹15,179 (+regime+RS): the filter trades
   away some of the easy 2022-2024 bull-market profit specifically to gain
   robustness in the choppy recent period. That's the intended trade-off,
   not a bug — but it means the filter isn't a pure improvement in every
   period, only in the one that matters most (recent).
3. The cached backtest history (2021-2026) spans exactly one bull leg and
   one choppy leg — the regime filter's *direction* is well-supported by
   established practice (Minervini, CANSLIM aren't new ideas), but its
   *measured magnitude* here is sample-limited to one market cycle, not
   many. Don't treat the numbers above as proven across cycles.

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

## Strategy comparison

Both strategies backtested on real NSE data (Aug 2022 - Aug 2026, ₹50,000
capital, transaction costs applied), across the full period and two more
recent sub-windows:

| Strategy | Universe | Window | Trades | Win% | Net P&L | Costs | Max DD |
|---|---|---|---|---|---|---|---|
| Breakout | Nifty 50 | Full 4yr | 170 | 45.9% | -₹4,542 | ₹5,731 | -19.8% |
| Breakout | Nifty 50 | Last 2yr | 81 | 40.7% | -₹8,174 | ₹2,693 | -20.0% |
| Breakout | Nifty 50 | Last 1yr | 41 | 41.5% | -₹2,528 | ₹1,405 | -11.7% |
| Breakout | Nifty 200 | Full 4yr | 210 | 48.6% | +₹1,153 | ₹6,405 | -21.7% |
| Breakout | Nifty 200 | Last 2yr | 105 | 39.0% | -₹12,792 | ₹3,147 | -28.8% |
| Breakout | Nifty 200 | Last 1yr | 51 | 45.1% | +₹781 | ₹1,614 | -9.0% |
| Mean-reversion | Nifty 50 | Full 4yr | 224 | 52.2% | -₹2,009 | ₹8,297 | -11.3% |
| Mean-reversion | Nifty 50 | Last 2yr | 101 | 46.5% | -₹1,534 | ₹3,739 | -7.2% |
| Mean-reversion | Nifty 50 | Last 1yr | 47 | 48.9% | -₹78 | ₹1,804 | -3.7% |
| Mean-reversion | Nifty 200 | Full 4yr | 551 | 55.5% | +₹4,606 | ₹18,488 | -9.8% |
| Mean-reversion | Nifty 200 | Last 2yr | 265 | 49.4% | -₹936 | ₹8,824 | -11.0% |
| Mean-reversion | Nifty 200 | Last 1yr | 129 | 46.5% | -₹314 | ₹4,494 | -6.4% |

**Honest read: neither strategy has a robust edge net of real transaction
costs.** The best single result (mean-reversion, Nifty 200, full 4 years,
+₹4,606) is roughly +9% total on ₹50k over 4 years — about 2%/year — and it
paid ₹18,488 in costs to get there, 4x what breakout paid on the same
universe/window, because it trades far more often. Both strategies are
flat-to-negative in the most recent 1-2 years on both universes, which
matters more than the full-period number if you're asking "would this work
starting today."

What **does** hold up as a real, structural difference: mean-reversion's
drawdowns are consistently 2-3x smaller than breakout's, because it holds
positions for days rather than months — that's a property of the mechanic
itself, not an artifact of one lucky window.

**Before risking real capital on either**: this comparison is a starting
point for further research (e.g. regime-switching between the two,
concentrating into fewer/larger positions to dilute the flat DP-charge
drag on mean-reversion, or testing on a longer/different history), not a
green light. Run `scripts/run_backtest.py` yourself on the exact universe,
window, and parameters you're considering before trusting any number here.

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
    screener.py            # breakout strategy: stock shortlist filters + regime/RS gates
    breakout.py             # breakout strategy: price-action entry/exit rules
    regime.py                 # market-regime + relative-strength filters (breakout only)
    mean_reversion.py          # mean-reversion strategy: screen + signal + exit rules (parked)
    indicators.py                # shared RSI/SMA/MACD/ATR helpers
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
| `lookback_range_days` | breakout: Donchian lookback window (positional: 55, swing was 20) | `55` |
| `rsi_min` / `rsi_max` | `full` screener: RSI band | `50` / `70` |
| `sma_period` | `full` screener: shorter trend filter SMA length | `26` |
| `volume_surge_multiple` | `full` screener: min volume vs. 20-day average to qualify | `1.5` |
| `stop_method` | breakout: `atr` (recommended) or `candle` (Kar-style) | `atr` |
| `atr_stop_multiple` | `atr` stop mode: stop distance in ATR multiples (positional: 4.0, swing was 2.5) | `4.0` |
| `use_fixed_target` | breakout: `false` (recommended, let stop trail) or `true` (Kar-style fixed target) | `false` |
| `trail_after_r_multiple` | start trailing once profit reaches this many R (positional: 2.0, swing was 1.0) | `2.0` |
| `atr_trail_multiple` | trail distance in ATR multiples once armed (positional: 3.5, swing was 2.0) | `3.5` |
| `use_regime_filter` | only trade when the benchmark index is above its own SMA — see [Regime & relative-strength filters](#regime--relative-strength-filters) | `true` |
| `regime_index_symbol` | benchmark index, match to your `universe_file` (`^NSEI` Nifty 50 / `^CNX200` Nifty 200) | `^NSEI` |
| `regime_sma_period` | SMA length for the regime check | `200` |
| `use_relative_strength_filter` | only trade stocks outperforming the benchmark index (IBD-style RS) | `true` |
| `rs_lookback_days` | lookback for the relative-strength calculation | `252` |
| `rs_min_relative_return` | minimum RS margin over the index to pass | `0.0` |
| `mr_ma_period` / `mr_atr_period` | mean-reversion (parked, see top of README): short MA/ATR periods for the pullback band | `5` / `5` |
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
