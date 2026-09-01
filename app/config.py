"""Knobs come from .env. Portal credentials do NOT live here any more -
they are typed into the dashboard and kept in memory only (see app/main.py).
"""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


class Settings:
    anthropic_api_key: str = os.getenv("ANTHROPIC_API_KEY", "")
    headless: bool = os.getenv("HEADLESS", "true").lower() == "true"
    notices_dir: str = os.getenv(
        "NOTICES_DIR",
        str(Path(__file__).resolve().parent.parent / "data" / "notices"))


settings = Settings()
