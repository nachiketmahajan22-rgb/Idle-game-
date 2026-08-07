"""Optional Telegram alerts for signals/fills. No-ops silently if
notify_telegram is False or credentials are missing, so it's safe to leave
enabled without ever risking a crash of the main agent loop over a
notification failure.
"""
from __future__ import annotations

import requests

from swing_agent.config import Config


def send_telegram_message(config: Config, text: str) -> bool:
    if not config.notify_telegram:
        return False
    if not config.telegram_bot_token or not config.telegram_chat_id:
        return False

    url = f"https://api.telegram.org/bot{config.telegram_bot_token}/sendMessage"
    try:
        resp = requests.post(url, json={"chat_id": config.telegram_chat_id, "text": text}, timeout=10)
        return resp.ok
    except requests.RequestException:
        return False
