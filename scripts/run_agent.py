#!/usr/bin/env python3
"""Daily entrypoint. Run after market close (or during Kar's suggested
first/last hour window if you want same-day fills):

    python scripts/run_agent.py

Schedule via cron, e.g. weekdays at 4:00 PM IST:

    0 16 * * 1-5 cd /path/to/repo && .venv/bin/python scripts/run_agent.py >> logs/cron.log 2>&1
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swing_agent.agent import run_daily_cycle
from swing_agent.config import load_config

if __name__ == "__main__":
    config = load_config()
    run_daily_cycle(config)
