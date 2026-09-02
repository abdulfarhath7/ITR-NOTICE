"""Knobs come from .env. Portal credentials do NOT live here any more -
they are typed into the dashboard and kept in memory only (see app/main.py).
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


_DATA = Path(__file__).resolve().parent.parent / "data"


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    # Gate for the whole dashboard. Empty = wide open (localhost dev only).
    app_password: str = os.getenv("APP_PASSWORD", "")
    headless: bool = os.getenv("HEADLESS", "true").lower() == "true"
    # Watching a headed run at full speed shows nothing useful, so slow the
    # browser down. Ignored when headless - nobody is looking.
    slow_mo_ms: int = int(os.getenv("SLOW_MO_MS", "600"))
    # Seconds to keep the browser window open after a failure so a human can
    # read the actual screen. 0 closes it immediately.
    hold_on_error: int = int(os.getenv("HOLD_ON_ERROR", "15"))
    notices_dir: str = os.getenv("NOTICES_DIR", str(_DATA / "notices"))
    debug_dir: str = os.getenv("DEBUG_DIR", str(_DATA / "debug"))


settings = Settings()
