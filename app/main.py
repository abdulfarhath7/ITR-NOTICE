"""FastAPI backend. One process owns everything:
  - serves the dashboard (app/static/index.html)
  - REST: take portal credentials, start a sync, list notices, download a
    stored PDF, receive an OTP
  - WebSocket: pushes live log lines, the 'otp_required' freeze and the
    'credentials_required' prompt to the UI

Credentials in one sentence: the dashboard posts them to /api/credentials,
EventHub holds them in memory for the life of this process, and nothing else
ever sees them - not SQLite, not a file, not a log line, not a response body.
Restarting the server forgets them, which is the point.

The OTP relay in one sentence: login pauses on an asyncio.Event, the UI gets an
'otp_required' push, the user types the code, POST /api/otp sets the Event,
login resumes on the very same open browser page.
"""
import asyncio
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import db
from .config import settings
from .portal.session import PortalSession, WrongPasswordError

app = FastAPI(title="ITR notice tool")


# ------------------------------------------------------------------ event hub
class EventHub:
    """Bridges the scraper (async world) and the dashboard (WebSocket), and
    holds the portal credentials in memory."""

    def __init__(self):
        self.sockets: list[WebSocket] = []
        self._otp_event = asyncio.Event()
        self._otp_value: str | None = None
        # The only place the portal login lives. Never serialized anywhere.
        self._credentials: dict[str, str] | None = None
        # credentials_required | idle | running | otp_required | failed
        self.state = "credentials_required"

    # ------------------------------------------------------- credentials
    def set_credentials(self, user_id: str, password: str) -> None:
        self._credentials = {"user_id": user_id, "password": password}
        self.state = "idle"

    def credentials(self) -> dict[str, str] | None:
        return self._credentials

    def has_credentials(self) -> bool:
        return self._credentials is not None

    async def clear_credentials(self, error: str | None = None) -> None:
        """Forget the login and make the dashboard ask again. `error` is shown
        above the form (used after a rejected password)."""
        self._credentials = None
        self.state = "credentials_required"
        await self._broadcast({"type": "credentials_required", "error": error})

    # -------------------------------------------------------------- events
    async def log(self, msg: str) -> None:
        await self._broadcast({"type": "log", "msg": msg})

    async def request_otp(self) -> str:
        self.state = "otp_required"
        self._otp_event.clear()
        await self._broadcast({"type": "otp_required"})
        await self._otp_event.wait()          # <- login is frozen right here
        self.state = "running"
        return self._otp_value or ""

    def submit_otp(self, code: str) -> None:
        self._otp_value = code.strip()
        self._otp_event.set()

    async def _broadcast(self, payload: dict) -> None:
        dead = []
        for ws in self.sockets:
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.sockets.remove(ws)


hub = EventHub()
_sync_lock = asyncio.Lock()


# ---------------------------------------------------------------------- sync
async def _run_sync() -> None:
    from .portal import scraper   # late import keeps startup fast

    creds = hub.credentials()
    if not creds:                            # nothing to log in with
        await hub.clear_credentials()
        return

    hub.state = "running"
    with db.connect() as con:
        run_id = con.execute("INSERT INTO runs DEFAULT VALUES").lastrowid

    session = PortalSession(hub, creds["user_id"], creds["password"])
    status, message = "done", ""
    try:
        await session.start()
        await session.login()
        stats = await scraper.run_sync(session, hub)
        message = str(stats)
    except WrongPasswordError as e:
        # Hard rule: never retry. Drop the bad login and ask again.
        status, message = "failed", str(e)
        await hub.log(f"STOPPED: {e}")
        await hub.clear_credentials(str(e))
    except Exception as e:
        status, message = "failed", repr(e)
        await hub.log(f"Sync failed: {e!r}")
    finally:
        await session.stop()
        if hub.state != "credentials_required":   # set by the wrong-password path
            hub.state = "idle" if status == "done" else "failed"
        with db.connect() as con:
            con.execute(
                "UPDATE runs SET finished=datetime('now'), status=?, message=? "
                "WHERE id=?", (status, message, run_id))
        await hub._broadcast({"type": "sync_finished", "status": status})


def _start_sync_task() -> None:
    async def guarded():
        async with _sync_lock:
            await _run_sync()

    asyncio.create_task(guarded())


@app.post("/api/sync")
async def start_sync():
    if _sync_lock.locked():
        return JSONResponse({"error": "a sync is already running"}, status_code=409)
    if not hub.has_credentials():
        hub.state = "credentials_required"
        await hub._broadcast({"type": "credentials_required", "error": None})
        return {"state": "credentials_required"}

    _start_sync_task()
    return {"started": True}


# --------------------------------------------------------------- credentials
class CredentialsIn(BaseModel):
    user_id: str
    password: str


@app.post("/api/credentials")
async def store_credentials(body: CredentialsIn):
    """Takes the login from the dashboard and starts the sync straight away.
    The response deliberately echoes nothing back."""
    if _sync_lock.locked():
        return JSONResponse({"error": "a sync is already running"}, status_code=409)
    if not body.user_id.strip() or not body.password:
        return JSONResponse(
            {"error": "user id and password are both required"}, status_code=400)

    hub.set_credentials(body.user_id.strip(), body.password)
    _start_sync_task()
    return {"stored": True, "started": True}


@app.delete("/api/credentials")
async def forget_credentials():
    """The 'Change login' link. Wipes memory, dashboard re-shows the form."""
    await hub.clear_credentials()
    return {"cleared": True}


class OtpIn(BaseModel):
    code: str


@app.post("/api/otp")
async def submit_otp(body: OtpIn):
    hub.submit_otp(body.code)
    return {"ok": True}


# ------------------------------------------------------------------- notices
@app.get("/api/notices")
async def notices():
    with db.connect() as con:
        rows = [dict(r) for r in db.list_notices(con)]
    return {"state": hub.state, "notices": rows}


@app.get("/api/notices/{ref_id}/pdf")
async def notice_pdf(ref_id: str):
    with db.connect() as con:
        row = con.execute(
            "SELECT pdf_path FROM notices WHERE ref_id=?", (ref_id,)).fetchone()
    if not row or not row["pdf_path"] or not Path(row["pdf_path"]).exists():
        return JSONResponse({"error": "no PDF stored for this notice"}, 404)
    return FileResponse(row["pdf_path"], filename=f"{ref_id}.pdf")


# --------------------------------------------------------- future: Ask Claude
@app.post("/api/notices/{ref_id}/ask-claude")
async def ask_claude(ref_id: str):
    """Build step 5. Will read the stored PDF, send it to the Claude API,
    extract or infer the due date, then db.set_claude_due_date(...).
    Cached forever after the first answer."""
    return JSONResponse(
        {"error": "not built yet - this is build step 5"}, status_code=501)


# ---------------------------------------------------------------- ws + static
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    hub.sockets.append(ws)
    await ws.send_json({"type": "state", "state": hub.state})
    try:
        while True:
            await ws.receive_text()      # we only push; ignore inbound chatter
    except WebSocketDisconnect:
        if ws in hub.sockets:
            hub.sockets.remove(ws)


@app.on_event("startup")
async def startup():
    db.init_db()


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static",
                           html=True), name="static")
