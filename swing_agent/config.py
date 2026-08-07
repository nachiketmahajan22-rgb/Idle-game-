"""Loads config/settings.yaml (strategy/risk parameters) and .env (secrets),
merges them into a single immutable Config object used across the agent.

Secrets never live in settings.yaml — only in the environment/.env — so the
YAML file is safe to commit.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent


def _env_bool(name: str, default: bool = False) -> bool:
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Config:
    # Risk
    capital: float
    risk_pct_per_trade: float
    max_open_positions: int
    max_daily_loss_pct: float
    reward_risk_min: float

    # Screener
    rsi_period: int
    rsi_min: float
    rsi_max: float
    sma_period: int
    volume_surge_multiple: float
    lookback_range_days: int

    # Breakout / trailing
    breakout_confirmation: str
    trail_after_r_multiple: float
    trail_method: str
    atr_period: int
    atr_trail_multiple: float

    # Universe
    universe_file: str

    # Execution
    broker: str
    live_trading: bool          # from settings.yaml
    live_trading_env: bool       # from .env — BOTH must be true to place real orders
    order_product: str
    order_type: str
    allow_shorts: bool

    # Notifications
    notify_telegram: bool

    # Logging
    log_dir: str

    # Secrets (from .env, may be empty in paper mode)
    kite_api_key: str = ""
    kite_api_secret: str = ""
    kite_access_token: str = ""
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    @property
    def is_live(self) -> bool:
        """Real orders only fire when the config file AND the environment both
        say so — a single flipped switch is never enough."""
        return self.live_trading and self.live_trading_env and self.broker == "kite"

    @property
    def universe_path(self) -> Path:
        p = Path(self.universe_file)
        return p if p.is_absolute() else REPO_ROOT / p

    @property
    def log_path(self) -> Path:
        p = Path(self.log_dir)
        return p if p.is_absolute() else REPO_ROOT / p


def load_config(settings_path: str | Path = REPO_ROOT / "config" / "settings.yaml") -> Config:
    load_dotenv(REPO_ROOT / ".env")

    with open(settings_path, "r") as f:
        raw = yaml.safe_load(f) or {}

    return Config(
        capital=float(raw.get("capital", 100000)),
        risk_pct_per_trade=float(raw.get("risk_pct_per_trade", 0.01)),
        max_open_positions=int(raw.get("max_open_positions", 5)),
        max_daily_loss_pct=float(raw.get("max_daily_loss_pct", 0.03)),
        reward_risk_min=float(raw.get("reward_risk_min", 1.5)),
        rsi_period=int(raw.get("rsi_period", 14)),
        rsi_min=float(raw.get("rsi_min", 50)),
        rsi_max=float(raw.get("rsi_max", 70)),
        sma_period=int(raw.get("sma_period", 26)),
        volume_surge_multiple=float(raw.get("volume_surge_multiple", 1.5)),
        lookback_range_days=int(raw.get("lookback_range_days", 20)),
        breakout_confirmation=str(raw.get("breakout_confirmation", "close")),
        trail_after_r_multiple=float(raw.get("trail_after_r_multiple", 1.0)),
        trail_method=str(raw.get("trail_method", "breakeven")),
        atr_period=int(raw.get("atr_period", 14)),
        atr_trail_multiple=float(raw.get("atr_trail_multiple", 2.0)),
        universe_file=str(raw.get("universe_file", "config/watchlist.csv")),
        broker=str(raw.get("broker", "paper")),
        live_trading=bool(raw.get("live_trading", False)),
        live_trading_env=_env_bool("LIVE_TRADING", False),
        order_product=str(raw.get("order_product", "CNC")),
        order_type=str(raw.get("order_type", "MARKET")),
        allow_shorts=bool(raw.get("allow_shorts", False)),
        notify_telegram=bool(raw.get("notify_telegram", False)),
        log_dir=str(raw.get("log_dir", "logs")),
        kite_api_key=os.environ.get("KITE_API_KEY", ""),
        kite_api_secret=os.environ.get("KITE_API_SECRET", ""),
        kite_access_token=os.environ.get("KITE_ACCESS_TOKEN", ""),
        telegram_bot_token=os.environ.get("TELEGRAM_BOT_TOKEN", ""),
        telegram_chat_id=os.environ.get("TELEGRAM_CHAT_ID", ""),
    )
