"""Plain-script tests: FastAPI TestClient only, no browser automation.

    .venv/bin/python test_app.py

Covers the credential rules that matter:
  - a sync without a login asks for one instead of starting
  - once posted, the login is used, remembered, and forgotten on demand
  - a rejected password drops the login and never retries
  - the password never appears in a response body, a broadcast, or the db
"""
import asyncio
import sys
import tempfile
import time
from pathlib import Path

from app import db

TMP = Path(tempfile.mkdtemp(prefix="itr-test-")) / "itr.db"
db.DB_PATH = TMP                      # keep the real data/itr.db untouched

from app import main                  # noqa: E402  (after DB_PATH is redirected)
from app.portal import scraper        # noqa: E402
from app.portal.session import WrongPasswordError  # noqa: E402
from fastapi.testclient import TestClient          # noqa: E402

USER_ID = "AAACU3358G"
PASSWORD = "sup3r-s3cret-pw"

failures = []


def check(name, ok, detail=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{detail}]" if detail else ""))
    if not ok:
        failures.append(name)


# ----------------------------------------------------------------- fake browser
class FakeSession:
    """Stands in for PortalSession. Records what login() was handed."""
    instances = []
    login_error = None

    def __init__(self, events, user_id, password):
        self.events, self.user_id, self.password = events, user_id, password
        self.started = self.logged_in = self.stopped = False
        FakeSession.instances.append(self)

    async def start(self):
        self.started = True

    async def login(self):
        if FakeSession.login_error:
            raise FakeSession.login_error
        self.logged_in = True

    async def stop(self):
        self.stopped = True

    async def save_debug_screenshot(self, tag="fail"):
        return f"data/debug/{tag}-test.png"


async def fake_run_sync(session, events):
    return {"proceedings": 1, "notices": 2, "downloaded": 0, "skipped_cached": 2}


main.PortalSession = FakeSession
scraper.run_sync = fake_run_sync
main.settings.hold_on_error = 0     # no 15-second pause inside the tests


class Recorder:
    """Duck-types a WebSocket so we can read everything the hub pushes."""

    def __init__(self):
        self.sent = []

    async def send_json(self, payload):
        self.sent.append(payload)


def reset():
    FakeSession.instances.clear()
    FakeSession.login_error = None
    main.hub._credentials = None
    main.hub.state = "credentials_required"


def wait_idle(client, tries=200):
    """Background sync task runs on the app loop; let it finish."""
    for _ in range(tries):
        s = client.get("/api/notices").json()["state"]
        if s not in ("running",):
            return s
        time.sleep(0.02)
    return "timeout"


bodies = []          # every response body we see, for the leak check


def post(client, url, **kw):
    r = client.post(url, **kw)
    bodies.append(r.text)
    return r


with TestClient(main.app) as client:
    rec = Recorder()
    main.hub.sockets.append(rec)

    # 1 - sync with no credentials held ---------------------------------------
    reset()
    r = post(client, "/api/sync")
    check("sync without credentials returns credentials_required",
          r.status_code == 200 and r.json() == {"state": "credentials_required"},
          r.text)
    check("sync without credentials starts no browser", not FakeSession.instances)

    # 2 - posting credentials starts the sync and hands them to login ----------
    reset()
    r = post(client, "/api/credentials",
             json={"user_id": USER_ID, "password": PASSWORD})
    check("POST /api/credentials accepted",
          r.status_code == 200 and r.json() == {"stored": True, "started": True},
          r.text)
    state = wait_idle(client)
    s = FakeSession.instances[0] if FakeSession.instances else None
    check("sync proceeded to a logged-in session",
          s is not None and s.started and s.logged_in and s.stopped)
    check("login got exactly the posted credentials",
          s is not None and s.user_id == USER_ID and s.password == PASSWORD)
    check("state back to idle after a clean run", state == "idle", state)

    # 3 - credentials are remembered for the next sync -------------------------
    FakeSession.instances.clear()
    r = post(client, "/api/sync")
    check("second sync starts without re-asking",
          r.json() == {"started": True}, r.text)
    wait_idle(client)
    check("second sync reused the remembered login",
          bool(FakeSession.instances)
          and FakeSession.instances[0].password == PASSWORD)

    # 4 - "Change login" forgets them -----------------------------------------
    r = client.delete("/api/credentials")
    bodies.append(r.text)
    check("DELETE /api/credentials clears the login",
          r.status_code == 200 and not main.hub.has_credentials())
    r = post(client, "/api/sync")
    check("sync asks again after Change login",
          r.json() == {"state": "credentials_required"}, r.text)

    # 5 - wrong password: forget, announce, never retry ------------------------
    reset()
    rec.sent.clear()
    FakeSession.login_error = WrongPasswordError("Portal rejected the password.")
    post(client, "/api/credentials",
         json={"user_id": USER_ID, "password": PASSWORD})
    wait_idle(client)
    check("wrong password clears the stored login", not main.hub.has_credentials())
    check("wrong password leaves state credentials_required",
          main.hub.state == "credentials_required", main.hub.state)
    prompts = [m for m in rec.sent if m.get("type") == "credentials_required"]
    check("wrong password pushes credentials_required over the socket",
          bool(prompts) and "rejected" in (prompts[-1].get("error") or ""),
          str(prompts[-1]) if prompts else "no push")
    check("wrong password is never retried", len(FakeSession.instances) == 1,
          f"{len(FakeSession.instances)} login attempts")
    shots = [m.get("msg", "") for m in rec.sent if m.get("type") == "log"]
    check("failure path logs a screenshot path",
          any("Screenshot of the failure" in m for m in shots),
          str(shots[-2:]))

    # 6 - nothing leaks the password ------------------------------------------
    reset()
    post(client, "/api/credentials", json={"user_id": USER_ID, "password": PASSWORD})
    wait_idle(client)
    for url in ("/api/notices", "/api/notices/999/pdf", "/"):
        bodies.append(client.get(url).text)
    bodies.append(post(client, "/api/notices/999/ask-claude").text)
    with client.websocket_connect("/ws") as ws:
        bodies.append(str(ws.receive_json()))
    bodies.append(str(rec.sent))

    check("no response body or broadcast contains the password",
          not any(PASSWORD in b for b in bodies),
          next((b[:120] for b in bodies if PASSWORD in b), ""))
    check("password never reaches the sqlite file",
          PASSWORD.encode() not in TMP.read_bytes())
    check("no file on disk holds the password",
          not any(PASSWORD in p.read_text(errors="ignore")
                  for p in Path(".").rglob("*")
                  if p.is_file() and p.suffix in {".py", ".html", ".md", ".env",
                                                  ".example", ".txt", ".yml"}
                  and ".venv" not in str(p) and p.name != "test_app.py"))

    main.hub.sockets.remove(rec)


# ---------------------------------------------------- the post-password loop
# The bug this guards: Angular ships hidden validation nodes ("Please enter
# valid password") in the DOM from page load, and get_by_text matches
# substrings, so a .count()-only check aborted every login as a wrong password.
from app.portal import session as session_mod                # noqa: E402
from app.portal.session import PortalSession                 # noqa: E402

DASHBOARD = "https://eportal.incometax.gov.in/iec/foservices/#/dashboard"
LOGIN = "https://eportal.incometax.gov.in/iec/foservices/#/login"


class FakeLoc:
    def __init__(self, count=0, visible=False, text=""):
        self._count, self._visible, self._text = count, visible, text
        self.clicked = False
        self.filled = None

    @property
    def first(self):
        return self

    async def count(self):
        return self._count

    async def is_visible(self):
        return self._visible

    async def inner_text(self):
        return self._text

    async def click(self):
        self.clicked = True

    async def fill(self, value):
        self.filled = value

    async def wait_for(self, state=None, timeout=None):
        return None

    def or_(self, other):
        return self if self._count else other


class FakePage:
    """Just enough Page for _settle_post_password."""

    def __init__(self, error=None, force_label=None, force=None, otp=None,
                 dashboard_after=None):
        self._url = LOGIN
        self.error = error                    # FakeLoc for a password error
        self.force_label, self.force = force_label, force
        self.otp = otp
        self.dashboard_after = dashboard_after
        self.reads = 0

    @property
    def url(self):
        self.reads += 1
        if self.dashboard_after is not None and self.reads > self.dashboard_after:
            return DASHBOARD
        return self._url

    def get_by_text(self, text):
        if self.error is not None and text in session_mod.PASSWORD_ERRORS:
            return self.error
        return FakeLoc()

    def get_by_role(self, role, name=None):
        if self.force is not None and name == self.force_label:
            return self.force
        return FakeLoc()

    def get_by_placeholder(self, text):
        return self.otp if self.otp is not None else FakeLoc()

    def locator(self, selector):
        return FakeLoc(1, True)


class FakeEvents:
    def __init__(self):
        self.logs, self.otp_asked = [], 0

    async def log(self, msg):
        self.logs.append(msg)

    async def request_otp(self):
        self.otp_asked += 1
        return "123456"


def settle(page, grace=0.0):
    """Run the loop against a fake page, fast."""
    session_mod.POLL_SECONDS = 0.01
    session_mod.ERROR_GRACE_SECONDS = grace
    events = FakeEvents()
    s = PortalSession(events, USER_ID, PASSWORD)
    s.page = page
    err = None
    try:
        asyncio.run(s._settle_post_password())
    except Exception as e:                      # noqa: BLE001 - the test wants it
        err = e
    return err, events


# 7 - a hidden error node is not an error -----------------------------------
err, _ = settle(FakePage(error=FakeLoc(1, False, "Please enter valid password"),
                         dashboard_after=2))
check("hidden error node does NOT raise (the login bug)", err is None,
      repr(err))

# 8 - a visible one is ------------------------------------------------------
err, _ = settle(FakePage(
    error=FakeLoc(1, True, "Please enter valid password. 2 attempts left"),
    dashboard_after=99))
check("visible error node DOES raise",
      isinstance(err, WrongPasswordError), repr(err))
check("the raise quotes what the portal actually said",
      err is not None and "2 attempts left" in str(err), str(err))
check("the raise never contains the password",
      err is not None and PASSWORD not in str(err))

# 9 - the grace period covers the navigation gap ----------------------------
err, _ = settle(FakePage(error=FakeLoc(1, True, "Please enter valid password"),
                         dashboard_after=3), grace=5.0)
check("no error is believed during the grace period", err is None, repr(err))

# 10 - force-login and OTP share the visible-only rule ----------------------
hidden_btn = FakeLoc(1, False, "Yes")
err, _ = settle(FakePage(force_label="Yes", force=hidden_btn, dashboard_after=2))
check("hidden force-login button is NOT clicked",
      err is None and not hidden_btn.clicked)

shown_btn = FakeLoc(1, True, "Login Here")
err, _ = settle(FakePage(force_label="Login Here", force=shown_btn,
                         dashboard_after=2))
check("visible force-login button IS clicked",
      err is None and shown_btn.clicked)

hidden_otp = FakeLoc(1, False)
err, events = settle(FakePage(otp=hidden_otp, dashboard_after=2))
check("hidden OTP template does NOT freeze the login",
      err is None and events.otp_asked == 0)

shown_otp = FakeLoc(1, True)
err, events = settle(FakePage(otp=shown_otp, dashboard_after=2))
check("visible OTP box DOES ask the dashboard for a code",
      err is None and events.otp_asked == 1, f"asked {events.otp_asked}x")

print()
print(f"{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
sys.exit(1 if failures else 0)
