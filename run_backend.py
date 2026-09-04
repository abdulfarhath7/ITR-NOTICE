"""Sidecar entry point for the desktop app.

The Tauri shell spawns this (as the frozen `notice-desk-backend` binary) with
HOST, PORT and APP_TOKEN in its environment, then polls GET /health before it
shows the window. Everything this file does is *around* the backend - nothing
in app/ is changed by it:

  * points the SQLite file and the Playwright browser cache at a writable
    app-data directory, because a PyInstaller one-file bundle unpacks itself
    into a temp dir that disappears on exit;
  * installs Chromium on first run (docs/02: the installer never ships one);
  * starts uvicorn on the loopback host and port it was given.

Run it directly during development too:

    APP_TOKEN=dev PORT=8000 python run_backend.py
"""
import logging
import os
import re
import subprocess
import sys
import threading
from pathlib import Path

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8000
APP_DIR_NAME = "NoticeDesk"


def frozen() -> bool:
    return getattr(sys, "frozen", False)


def app_data_dir() -> Path:
    """Where the database and the browser live between runs.

    The shell passes NOTICE_DESK_DATA_DIR (its own app-data path). Falling back
    to the platform default keeps `python run_backend.py` working on its own.
    """
    given = os.getenv("NOTICE_DESK_DATA_DIR", "").strip()
    if given:
        return Path(given)
    if os.name == "nt":
        base = Path(os.getenv("LOCALAPPDATA") or Path.home() / "AppData" / "Local")
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.getenv("XDG_DATA_HOME") or Path.home() / ".local" / "share")
    return base / APP_DIR_NAME


def repo_root() -> Path:
    return Path(__file__).resolve().parent


def choose_data_dir() -> Path:
    """Development keeps using ./data so an existing database is not orphaned;
    a packaged build always writes to app-data."""
    if not frozen() and not os.getenv("NOTICE_DESK_DATA_DIR"):
        return repo_root() / "data"
    directory = app_data_dir()
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def chromium_ready(browsers_dir: Path) -> bool:
    """Playwright drops INSTALLATION_COMPLETE in the browser folder only once
    the download has finished. A folder that merely exists means an install was
    interrupted, and must be retried rather than trusted."""
    return any((child / "INSTALLATION_COMPLETE").exists()
               for child in browsers_dir.glob("chromium*"))


def ensure_chromium(browsers_dir: Path) -> None:
    """First run only, and off the startup path - see main()."""
    browsers_dir.mkdir(parents=True, exist_ok=True)
    if chromium_ready(browsers_dir):
        return

    print("[sidecar] installing Chromium (first run only)...", flush=True)
    env = dict(os.environ)
    if frozen():
        # The frozen binary has no interpreter to re-enter, so it re-runs
        # itself with a marker that hands control to playwright's own CLI
        # (see playwright_cli below) instead of to uvicorn.
        command = [sys.executable, "install", "chromium"]
        env["NOTICE_DESK_PLAYWRIGHT_CLI"] = "1"
    else:
        command = [sys.executable, "-m", "playwright", "install", "chromium"]

    try:
        subprocess.run(command, check=True, env=env)
        print("[sidecar] Chromium ready", flush=True)
    except Exception as exc:                      # pragma: no cover - first run
        # A missing browser is worth saying out loud, but it must not stop the
        # server: every screen except a sync still works without it.
        print(f"[sidecar] Chromium install failed: {exc!r}", flush=True)


class _RedactToken(logging.Filter):
    """The websocket cannot carry a header, so its token rides in the query
    string - and uvicorn prints the request line. Blank it before it lands
    anywhere: docs/06 says the token is never logged."""

    PATTERN = re.compile(r"token=[^&\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            record.msg = self.PATTERN.sub("token=<redacted>", str(record.msg))
            if record.args:
                record.args = tuple(
                    self.PATTERN.sub("token=<redacted>", a) if isinstance(a, str) else a
                    for a in record.args)
        except Exception:
            pass
        return True


def install_log_redaction() -> None:
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access", "websockets.server"):
        logging.getLogger(name).addFilter(_RedactToken())


def playwright_cli() -> int:
    """The frozen binary re-entered as `playwright ...`."""
    from playwright.__main__ import main as playwright_main

    sys.argv = ["playwright", *sys.argv[1:]]
    playwright_main()
    return 0


def main() -> int:
    if os.getenv("NOTICE_DESK_PLAYWRIGHT_CLI") == "1":
        return playwright_cli()

    data_dir = choose_data_dir()
    browsers_dir = Path(
        os.getenv("PLAYWRIGHT_BROWSERS_PATH") or (data_dir / "browsers")
    )
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)
    # A failure screenshot is the only trace a broken run leaves. Written into
    # a one-file bundle's temp dir it would vanish with the process, so it is
    # repointed here - before app.config reads it at import time.
    os.environ.setdefault("DEBUG_DIR", str(data_dir / "debug"))

    # app/db.py resolves its path from __file__, which in a one-file bundle is
    # a temp directory. Repointing the module attribute (rather than editing
    # app/db.py, which is off-limits) is what keeps the archive between runs.
    from app import db

    db.DB_PATH = data_dir / "itr.db"
    db.DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    # TODO(sqlcipher): the archive - notices, their PDFs and every draft - is
    # still a plain SQLite file. Encrypting it means swapping sqlite3 for
    # sqlcipher3 under app/db.py and issuing PRAGMA key on every connection,
    # with the key coming from the OS keychain the shell already holds. That is
    # a change to app/db.py's connection path, which this port is not allowed
    # to make, and pysqlcipher3 has no Windows wheel. See NOTES.md.

    # The first-run Chromium download is ~150 MB and takes minutes. It must NOT
    # sit in front of the bind: the shell waits on GET /health before it shows
    # the window, and would give up long before the download finished. So the
    # server comes up first and the browser arrives behind it; a sync started
    # in that window fails with a clear playwright error, which is the honest
    # answer.
    if not chromium_ready(browsers_dir):
        threading.Thread(target=ensure_chromium, args=(browsers_dir,),
                         daemon=True).start()

    host = os.getenv("HOST", DEFAULT_HOST)
    port = int(os.getenv("PORT", str(DEFAULT_PORT)))
    if host not in ("127.0.0.1", "localhost", "::1"):
        # Prime directive 4: loopback only.
        print(f"[sidecar] refusing to bind {host}; using {DEFAULT_HOST}", flush=True)
        host = DEFAULT_HOST

    import uvicorn

    from app.main import app

    install_log_redaction()

    print(f"[sidecar] listening on http://{host}:{port} (db: {db.DB_PATH})", flush=True)
    uvicorn.run(app, host=host, port=port, log_level="info", access_log=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
