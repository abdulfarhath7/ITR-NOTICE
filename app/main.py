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
import hashlib
import hmac
import json
import time
from pathlib import Path

from fastapi import Body, FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import claude_client, db
from .config import settings
from .portal.session import PortalSession, WrongPasswordError

app = FastAPI(title="ITR notice tool")


# ----------------------------------------------------------------- access lock
# The tool is meant to sit on a public URL, so everything behind it - the
# dashboard, every API route and the WebSocket - is gated on one password from
# APP_PASSWORD. The cookie is a timestamp signed with that password: no
# database, no extra dependency, and changing the password invalidates every
# cookie already handed out.
#
# WARNING: over plain http the password and this cookie cross the wire in the
# clear and can be replayed by anyone on the path. Put TLS in front before
# trusting it (see the secure= TODO below).
COOKIE_NAME = "itr_session"
COOKIE_MAX_AGE = 12 * 3600          # seconds; re-enter the password once a day
FAILED_LOGIN_DELAY = 2.0            # seconds, per wrong attempt

LOGIN_PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ITR notice tool</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f8fa;
      font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1c2733}
 form{background:#fff;border:1px solid #e3e7ec;border-radius:12px;padding:28px;
      width:320px;display:grid;gap:12px}
 h1{font-size:16px;margin:0 0 4px}
 input,button{font:inherit;padding:9px 12px;border-radius:8px;border:1px solid #e3e7ec}
 button{background:#1a56db;border-color:#1a56db;color:#fff;cursor:pointer}
 .err{color:#b91c1c;font-size:13px;min-height:18px;margin:0}
 .mut{color:#6b7683;font-size:12.5px;margin:0}
</style></head><body>
<form id="f">
  <h1>ITR notice tool</h1>
  <p class="mut">Enter the dashboard password.</p>
  <input id="p" type="password" autocomplete="current-password" autofocus
         aria-label="Dashboard password">
  <button type="submit">Sign in</button>
  <p class="err" id="e"></p>
</form>
<script>
document.getElementById('f').onsubmit = async ev => {
  ev.preventDefault();
  const e = document.getElementById('e');
  e.textContent = 'Checking...';
  const r = await fetch('/login', {method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({password: document.getElementById('p').value})});
  if (r.ok) { location.href = '/'; return; }
  e.textContent = 'Wrong password.';
  document.getElementById('p').value = '';
};
</script></body></html>"""


def _auth_on() -> bool:
    """Read through settings every time so a test can flip it."""
    return bool(settings.app_password)


def _sign(issued: str) -> str:
    return hmac.new(settings.app_password.encode(), issued.encode(),
                    hashlib.sha256).hexdigest()


def _new_cookie() -> str:
    issued = str(int(time.time()))
    return f"{issued}.{_sign(issued)}"


def _cookie_ok(value: str | None) -> bool:
    if not value or "." not in value:
        return False
    issued, sig = value.rsplit(".", 1)
    if not hmac.compare_digest(sig, _sign(issued)):
        return False
    try:
        age = time.time() - int(issued)
    except ValueError:
        return False
    return 0 <= age <= COOKIE_MAX_AGE


@app.middleware("http")
async def require_password(request: Request, call_next):
    if not _auth_on() or request.url.path in ("/login", "/logout"):
        return await call_next(request)
    if _cookie_ok(request.cookies.get(COOKIE_NAME)):
        return await call_next(request)
    if request.url.path.startswith("/api/"):
        return JSONResponse({"error": "not signed in"}, status_code=401)
    return HTMLResponse(LOGIN_PAGE, status_code=401)


class LoginIn(BaseModel):
    password: str


@app.post("/login")
async def login(body: LoginIn):
    if not _auth_on():
        return {"ok": True, "auth": "disabled"}
    if not hmac.compare_digest(body.password, settings.app_password):
        await asyncio.sleep(FAILED_LOGIN_DELAY)      # slow down guessing
        return JSONResponse({"error": "wrong password"}, status_code=401)
    resp = JSONResponse({"ok": True})
    resp.set_cookie(
        COOKIE_NAME, _new_cookie(), max_age=COOKIE_MAX_AGE,
        httponly=True, samesite="lax",
        # TODO: secure=True once this is served over https - on plain http the
        # cookie is readable and replayable by anyone on the network path.
        secure=False,
    )
    return resp


@app.post("/logout")
async def logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME)
    return resp


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
        # How many NEW PDFs a run may fetch. None = every notice.
        self.download_limit: int | None = None

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
        stats = await scraper.run_sync(session, hub, limit=hub.download_limit)
        message = str(stats)
    except WrongPasswordError as e:
        # Hard rule: never retry. Drop the bad login and ask again.
        status, message = "failed", str(e)
        await hub.log(f"STOPPED: {e}")
        await _after_failure(session)
        await hub.clear_credentials(str(e))
    except Exception as e:
        status, message = "failed", repr(e)
        if "closed" in str(e).lower() and session.page_closed():
            await hub.log("Sync stopped: the browser window was closed")
        else:
            await hub.log(f"Sync failed: {e!r}")
        await _after_failure(session)
    finally:
        await session.stop()
        if hub.state != "credentials_required":   # set by the wrong-password path
            hub.state = "idle" if status == "done" else "failed"
        with db.connect() as con:
            con.execute(
                "UPDATE runs SET finished=datetime('now'), status=?, message=? "
                "WHERE id=?", (status, message, run_id))
        await hub._broadcast({"type": "sync_finished", "status": status})


async def _after_failure(session) -> None:
    """A failed run must not vanish. Leave a screenshot behind, and optionally
    the browser window itself, so the actual portal screen can be read."""
    if session.page_closed():
        await hub.log("The browser window is gone - no screenshot to take")
        return
    shot = await session.save_debug_screenshot()
    if shot:
        await hub.log(f"Screenshot of the failure: {shot}")
    if settings.hold_on_error > 0:
        await hub.log(
            f"Holding the browser open for {settings.hold_on_error}s - look at it now")
        await asyncio.sleep(settings.hold_on_error)


class SyncIn(BaseModel):
    limit: int | None = None      # None (or 0) means every notice


def _start_sync_task() -> None:
    async def guarded():
        async with _sync_lock:
            await _run_sync()

    asyncio.create_task(guarded())


@app.post("/api/sync")
async def start_sync(body: SyncIn | None = Body(default=None)):
    if _sync_lock.locked():
        return JSONResponse({"error": "a sync is already running"}, status_code=409)
    if not hub.has_credentials():
        hub.state = "credentials_required"
        await hub._broadcast({"type": "credentials_required", "error": None})
        return {"state": "credentials_required"}

    hub.download_limit = (body.limit or None) if body else None
    _start_sync_task()
    return {"started": True, "limit": hub.download_limit}


# --------------------------------------------------------------- credentials
class CredentialsIn(BaseModel):
    user_id: str
    password: str
    limit: int | None = None


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
    hub.download_limit = body.limit or None
    _start_sync_task()
    return {"stored": True, "started": True, "limit": hub.download_limit}


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
async def notice_pdf(ref_id: str, inline: int = 0):
    """inline=1 renders in the browser's PDF viewer; the default downloads."""
    with db.connect() as con:
        row = con.execute(
            "SELECT pdf_path FROM notices WHERE ref_id=?", (ref_id,)).fetchone()
    if not row or not row["pdf_path"] or not Path(row["pdf_path"]).exists():
        return JSONResponse({"error": "no PDF stored for this notice"}, 404)
    if inline:
        return FileResponse(
            row["pdf_path"], media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{ref_id}.pdf"'})
    return FileResponse(row["pdf_path"], filename=f"{ref_id}.pdf")


# ------------------------------------------------------------- Ask Claude
def _stored_pdf(row) -> str | None:
    path = row["pdf_path"] if row is not None else None
    return path if path and Path(path).exists() else None


@app.post("/api/notices/{ref_id}/ask-claude")
async def ask_claude(ref_id: str):
    """Read the stored PDF and ask Claude for the response due date.

    Cache rule: once a date is stored with due_date_source='claude' it is
    returned as-is forever. Claude is never asked twice about a notice.
    """
    with db.connect() as con:
        row = db.get_notice(con, ref_id)
        if row is None:
            return JSONResponse({"error": "no such notice"}, status_code=404)
        if row["due_date"] and row["due_date_source"] == "claude":
            return {"ref_id": ref_id, "due_date": row["due_date"],
                    "basis": row["due_date_basis"], "source": "claude",
                    "cached": True}
        if row["due_date"]:
            # A portal date is the truth; Claude never gets to overwrite it.
            return {"ref_id": ref_id, "due_date": row["due_date"],
                    "basis": None, "source": row["due_date_source"], "cached": True}
        pdf = _stored_pdf(row)
        issued_on, served_on = row["issued_on"], row["served_on"]

    if not pdf:
        return JSONResponse(
            {"error": "no PDF stored for this notice yet - run a sync first"},
            status_code=404)
    if not claude_client.have_key():
        return JSONResponse({"error": "add API key in .env"}, status_code=503)

    try:
        answer = await claude_client.due_date_from_pdf(
            pdf, ref_id=ref_id, issued_on=issued_on, served_on=served_on)
    except claude_client.ClaudeUnavailable as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"Claude call failed: {e!r}"},
                            status_code=502)

    due_date = (answer.get("due_date") or "").strip() or None
    basis = (answer.get("basis") or "").strip() or None
    if due_date:
        with db.connect() as con:
            db.set_claude_due_date(con, ref_id, due_date, basis)
    return {"ref_id": ref_id, "due_date": due_date, "basis": basis,
            "source": "claude" if due_date else None, "cached": False}


# ------------------------------------------------------- draft a response
# READ-ONLY GUARDRAIL: this produces text for the owner to read, edit and file
# himself. There is no portal-submission code here and there must never be.
@app.post("/api/notices/{ref_id}/draft")
async def draft_response(ref_id: str, regenerate: int = 0):
    """Summary + document checklist + a draft reply, from the stored PDF.

    Cached like the due date: one generation per notice, unless the owner
    explicitly asks to regenerate.
    """
    with db.connect() as con:
        row = db.get_notice(con, ref_id)
        if row is None:
            return JSONResponse({"error": "no such notice"}, status_code=404)
        existing = db.get_draft(con, ref_id)
        if existing is not None and not regenerate:
            return {"ref_id": ref_id, "summary": existing["summary"],
                    "checklist": json.loads(existing["checklist_json"] or "[]"),
                    "draft_text": existing["draft_text"],
                    "generated_at": existing["generated_at"], "cached": True}
        pdf = _stored_pdf(row)
        notice_us = row["notice_us"]
        proceeding = con.execute(
            "SELECT assessee_name, assessment_year FROM proceedings WHERE id=?",
            (row["proceeding_id"],)).fetchone() if row["proceeding_id"] else None

    if not pdf:
        return JSONResponse(
            {"error": "no PDF stored for this notice yet - run a sync first"},
            status_code=404)
    if not claude_client.have_key():
        return JSONResponse({"error": "add API key in .env"}, status_code=503)

    try:
        answer = await claude_client.draft_from_pdf(
            pdf, ref_id=ref_id, notice_us=notice_us,
            assessee=proceeding["assessee_name"] if proceeding else None,
            assessment_year=proceeding["assessment_year"] if proceeding else None)
    except claude_client.ClaudeUnavailable as e:
        return JSONResponse({"error": str(e)}, status_code=503)
    except Exception as e:
        return JSONResponse({"error": f"Claude call failed: {e!r}"},
                            status_code=502)

    checklist = answer.get("checklist") or []
    with db.connect() as con:
        db.save_draft(con, ref_id, answer.get("summary") or "",
                      json.dumps(checklist), answer.get("draft_reply") or "")
        saved = db.get_draft(con, ref_id)
    return {"ref_id": ref_id, "summary": saved["summary"], "checklist": checklist,
            "draft_text": saved["draft_text"], "generated_at": saved["generated_at"],
            "cached": False}


# ---------------------------------------------------------------- ws + static
@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    # Middleware does not run for websockets, so the gate is repeated here.
    if _auth_on() and not _cookie_ok(ws.cookies.get(COOKIE_NAME)):
        await ws.close(code=1008)        # policy violation
        return
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
    if not _auth_on():
        line = "!" * 72
        print(f"\n{line}\n"
              "  APP_PASSWORD is not set: this dashboard is OPEN to anyone who\n"
              "  can reach this port. Fine on localhost, NOT fine on a public\n"
              "  URL - your notices and your portal session are behind it.\n"
              "  Set APP_PASSWORD in .env before exposing this.\n"
              f"{line}\n", flush=True)


app.mount("/", StaticFiles(directory=Path(__file__).parent / "static",
                           html=True), name="static")
