"""Litigation Command Center sidecar - the portal automation as a child process.

The Rust core spawns this and talks to it over JSON lines:

  stdin  (commands, one JSON object per line)
    {"cmd": "login", "user_id": "...", "password": "..."}
    {"cmd": "otp",   "code": "123456"}
    {"cmd": "sync",  "limit": null}          # limit = stop after N new PDFs
    {"cmd": "speed", "seconds": 0.4}         # pacing between browser actions
    {"cmd": "stop"}

  stdout (events, one JSON object per line)
    {"ev": "ready"}
    {"ev": "log", "msg": "..."}
    {"ev": "progress", "kind": "walk", ...}
    {"ev": "login_phase", "phase": "opening|credentials|done"}
    {"ev": "otp_required"}                    # freeze until an "otp" command
    {"ev": "login_ok"}
    {"ev": "notice", ...row fields..., "pdf_b64": "..."}
    {"ev": "viewport", "img": "<base64 jpeg>"}  # what the browser is looking at
    {"ev": "sync_done", "stats": {...}}
    {"ev": "error", "msg": "..."}

Design in one paragraph: app/portal/* is the SAME tested code as the web
tool, byte for byte. It still writes to its own SQLite through app/db.py, but
that file is now only a STAGING cache. The moment a notice is committed the
scraper calls events.notice_added(ref_id); we read the row, push it (PDF
included) to the Rust core - which is the only place the encrypted archive
lives - and then overwrite the staging blob with a 1-byte marker. The
scraper's cache rule is `pdf_blob IS NOT NULL`, so the marker keeps "already
held, do not fetch again" working while no real PDF sits unencrypted on disk.

Never print anything to stdout except JSON lines. Tracebacks go to stderr.
"""
import asyncio
import base64
import json
import os
import sys
import threading
import traceback
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

# The staging database lives where the Rust core tells us (app data dir),
# not next to the executable - Program Files is read-only.
from app import db  # noqa: E402

if os.environ.get("NOTICE_DB"):
    db.DB_PATH = Path(os.environ["NOTICE_DB"])

from app.portal.scraper import run_sync  # noqa: E402
from app.portal.session import PortalSession, WrongPasswordError  # noqa: E402

PDF_MARKER = b"\x01"      # see module docstring

# The live viewport. Same numbers the web tool pushed over its websocket
# (app/main.py): often enough to read as motion, small enough that a frame
# never competes with a PDF for the pipe.
VIEWPORT_INTERVAL = 1.5          # seconds between frames
VIEWPORT_QUALITY = 45            # jpeg quality


def emit(**payload: object) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Events:
    """What PortalSession / run_sync expect from the 'hub'."""

    def __init__(self) -> None:
        self._otp: asyncio.Future[str] | None = None
        self._pace = 0.4

    # ---- hooks the automation calls -----------------------------------
    async def log(self, msg: str) -> None:
        emit(ev="log", msg=msg)

    async def progress(self, kind: str, **kw: object) -> None:
        emit(ev="progress", kind=kind, **kw)

    async def login_phase(self, phase: str) -> None:
        emit(ev="login_phase", phase=phase)

    def pace_seconds(self) -> float:
        return self._pace

    async def request_otp(self) -> str:
        """Block the login until the desktop UI relays the code."""
        loop = asyncio.get_running_loop()
        self._otp = loop.create_future()
        emit(ev="otp_required")
        code: str = await self._otp
        self._otp = None
        return code

    async def notice_added(self, ref_id: str) -> None:
        """Ship the just-committed row to the encrypted store, then scrub."""
        with db.connect() as con:
            row = con.execute(
                """SELECT n.*, p.tab, p.sub_tab, p.proceeding_name, p.pan,
                          p.assessee_name, p.assessment_year, p.financial_year,
                          p.applicable_act, p.status AS proceeding_status,
                          p.closure_date, p.closure_order
                   FROM notices n LEFT JOIN proceedings p ON p.id = n.proceeding_id
                   WHERE n.ref_id = ?""", (ref_id,)).fetchone()
            if row is None:
                return
            data = dict(row)
            blob = data.pop("pdf_blob", None)
            data.pop("pdf_path", None)
            pdf_b64 = None
            if blob and blob != PDF_MARKER:
                pdf_b64 = base64.standard_b64encode(blob).decode("ascii")
                con.execute("UPDATE notices SET pdf_blob=? WHERE ref_id=?",
                            (PDF_MARKER, ref_id))
                con.commit()
        emit(ev="notice", pdf_b64=pdf_b64, **data)

    # ---- called from the command loop ---------------------------------
    def supply_otp(self, code: str) -> None:
        if self._otp and not self._otp.done():
            self._otp.set_result(code)

    def set_pace(self, seconds: float) -> None:
        self._pace = max(0.0, float(seconds))


async def _viewport_loop(session: PortalSession) -> None:
    """Stream what the browser is looking at, so a sync is watchable.

    Lifted from the web tool's `app/main.py`, unchanged in substance. It skips
    every frame that could carry a credential: `safe_to_capture()` is false for
    the whole of login - which is also the whole of the OTP wait, since
    `in_login` stays set until the dashboard is reached - and for two seconds
    after it. A frame is never the reason a run fails: every error here is
    swallowed and the next tick tries again.
    """
    while True:
        await asyncio.sleep(VIEWPORT_INTERVAL)
        page = session.page
        if page is None or not session.safe_to_capture() or session.page_closed():
            continue
        try:
            frame = await page.screenshot(type="jpeg", quality=VIEWPORT_QUALITY)
        except Exception:
            continue          # a navigation mid-shot is normal, just skip it
        emit(ev="viewport", img=base64.standard_b64encode(frame).decode("ascii"))


class Runner:
    def __init__(self) -> None:
        self.events = Events()
        self.session: PortalSession | None = None
        self.busy: asyncio.Task[None] | None = None
        self.watcher: asyncio.Task[None] | None = None

    async def _drop_session(self) -> None:
        """The only way a session ends. The frame pump holds a reference to the
        page, so it has to go first - otherwise it screenshots a browser that
        is being torn down and the run's last event is a stray traceback."""
        if self.watcher:
            self.watcher.cancel()
            self.watcher = None
        if self.session:
            await self.session.stop()
            self.session = None

    async def login(self, user_id: str, password: str) -> None:
        await self._drop_session()
        self.session = PortalSession(self.events, user_id, password)
        try:
            await self.session.start()
            # From here on there is a page to photograph. The pump withholds
            # every frame until login is done and safe - it is started now, not
            # after, so the first dashboard screen is already on its way when
            # "login_ok" lands.
            self.watcher = asyncio.create_task(_viewport_loop(self.session))
            await self.session.login()
            emit(ev="login_ok")
        except WrongPasswordError as e:
            emit(ev="error", kind="wrong_password", msg=str(e))
            await self._drop_session()
        except Exception as e:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            emit(ev="error", kind="login", msg=repr(e))
            await self._drop_session()

    async def sync(self, limit: int | None) -> None:
        if not self.session:
            emit(ev="error", kind="not_logged_in", msg="log in first")
            return
        try:
            stats = await run_sync(self.session, self.events, limit=limit)
            emit(ev="sync_done", stats=stats)
        except Exception as e:  # noqa: BLE001
            traceback.print_exc(file=sys.stderr)
            emit(ev="error", kind="sync", msg=repr(e))

    async def stop(self) -> None:
        await self._drop_session()

    def spawn(self, coro: Coroutine[Any, Any, None]) -> None:
        """Long jobs run as tasks so stdin stays responsive (OTP arrives
        in the middle of login)."""
        if self.busy and not self.busy.done():
            emit(ev="error", kind="busy", msg="a job is already running")
            coro.close()
            return
        self.busy = asyncio.create_task(coro)


def _stdin_reader(loop: asyncio.AbstractEventLoop, queue: asyncio.Queue[str | None]) -> None:
    for line in sys.stdin:
        loop.call_soon_threadsafe(queue.put_nowait, line)
    loop.call_soon_threadsafe(queue.put_nowait, None)     # EOF = parent gone


async def main() -> None:
    db.init_db()
    runner = Runner()
    queue: asyncio.Queue[str | None] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    threading.Thread(target=_stdin_reader, args=(loop, queue), daemon=True).start()
    emit(ev="ready")

    while True:
        line = await queue.get()
        if line is None:
            break
        line = line.strip()
        if not line:
            continue
        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            emit(ev="error", kind="bad_command", msg=line[:200])
            continue

        kind = cmd.get("cmd")
        if kind == "login":
            runner.spawn(runner.login(cmd["user_id"], cmd["password"]))
        elif kind == "otp":
            runner.events.supply_otp(str(cmd.get("code", "")).strip())
        elif kind == "sync":
            runner.spawn(runner.sync(cmd.get("limit")))
        elif kind == "speed":
            runner.events.set_pace(cmd.get("seconds", 0.4))
        elif kind == "stop":
            break
        else:
            emit(ev="error", kind="bad_command", msg=f"unknown cmd {kind!r}")

    await runner.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
