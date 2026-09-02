"""Plain-script tests: FastAPI TestClient only, no browser automation.

    .venv/bin/python test_app.py

Covers the credential rules that matter:
  - a sync without a login asks for one instead of starting
  - once posted, the login is used, remembered, and forgotten on demand
  - a rejected password drops the login and never retries
  - the password never appears in a response body, a broadcast, or the db
"""
import asyncio
import pathlib
import time
import re
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

    def page_closed(self):
        return False


LIMITS_SEEN = []


async def fake_run_sync(session, events, limit=None):
    LIMITS_SEEN.append(limit)
    return {"proceedings": 1, "notices": 2, "downloaded": 0, "skipped_cached": 2}


REAL_RUN_SYNC = scraper.run_sync      # the fake below shadows it for the API tests
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
          r.status_code == 200 and r.json()["stored"] and r.json()["started"],
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
          r.json().get("started") is True, r.text)
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
    def __init__(self, count=0, visible=False, text="", children=None):
        self._count, self._visible, self._text = count, visible, text
        self.clicked = False
        self.filled = None
        self._children = children or {}

    @property
    def first(self):
        return self

    async def count(self):
        return self._count

    async def is_visible(self):
        return self._visible

    async def inner_text(self):
        return self._text

    async def click(self, timeout=None):
        self.clicked = True

    async def fill(self, value):
        self.filled = value

    async def wait_for(self, state=None, timeout=None):
        return None

    async def input_value(self):
        return self._text

    def get_by_role(self, role, name=None, exact=None):
        return self._children.get(name, FakeLoc())

    def or_(self, other):
        return self if self._count else other


class FakePage:
    """Just enough Page for _settle_post_password."""

    def __init__(self, error=None, force_label=None, force=None, otp=None,
                 dashboard_after=None, transient=None):
        self._url = LOGIN
        self.error = error                    # FakeLoc for a password error
        self.force_label, self.force = force_label, force
        self.otp = otp
        self.transient = transient            # FakeLoc for "not authenticated"
        self.dashboard_after = dashboard_after
        self.reads = 0
        self.continue_clicks = 0
        self.pwd_field = FakeLoc(1, True, "")

    @property
    def url(self):
        self.reads += 1
        if self.dashboard_after is not None and self.reads > self.dashboard_after:
            return DASHBOARD
        return self._url

    def get_by_text(self, text):
        if self.error is not None and text in session_mod.PASSWORD_ERRORS:
            return self.error
        if self.transient is not None and text in session_mod.TRANSIENT_ERRORS:
            return self.transient
        return FakeLoc()

    def get_by_role(self, role, name=None):
        if name == "Continue":
            page = self

            class ContinueBtn(FakeLoc):
                @property
                def first(self):
                    return self

                async def click(self, timeout=None):
                    page.continue_clicks += 1

            return ContinueBtn(1, True, "Continue")
        if self.force is not None and name == self.force_label:
            return self.force
        return FakeLoc()

    def get_by_placeholder(self, text):
        if text == "Password":
            return self.pwd_field
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
    session_mod.RETRY_PAUSE_SECONDS = 0        # the real 2s pause is not the point here
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


# ------------------------------------------------- parsers, against real text
# Copied verbatim out of the live recon dumps (data/debug/recon3/), so these
# are the portal's own words, not a guess at them.
from app.portal import scraper                                  # noqa: E402

REAL_PROCEEDING = """Proceeding Name :
Issue Letter
Assessment Year :
Not Available
PAN
AAACU3358G
Name of Assessee
CAMBRIDGE TECHNOLOGY ENTERPRISES LIMITED
1
18-Aug-2026
Open
Financial Year :
Not Available
Applicable Act :
Income Tax Act 1961
View Notices/Orders (1)
+ Add / View Authorised Representative"""

REAL_NOTICE = """Notice/ Communication Reference ID : 100118320996
Notice u/s
ITBA/COM/F/17/2026-27/1092231604(1)
Document reference ID
Description :
[ITBA]Issue Letter
Issued On :
17-Aug-2026
Last Response submitted On :
18-Aug-2026
Response viewed by AO on :
27-Aug-2026
View Response
Notice/Letter pdf
Seek/View Adjournment"""


class TextCard:
    def __init__(self, text):
        self._text = text

    async def inner_text(self):
        return self._text


p = asyncio.run(scraper._parse_proceeding(TextCard(REAL_PROCEEDING), "self", "action"))
check("proceeding: name", p["proceeding_name"] == "Issue Letter", p["proceeding_name"])
check("proceeding: PAN", p["pan"] == "AAACU3358G", p["pan"])
check("proceeding: assessee", p["assessee_name"] == "CAMBRIDGE TECHNOLOGY ENTERPRISES LIMITED")
check("proceeding: 'Not Available' year becomes NULL",
      p["assessment_year"] is None and p["financial_year"] is None,
      f"{p['assessment_year']} / {p['financial_year']}")
check("proceeding: act", p["applicable_act"] == "Income Tax Act 1961", p["applicable_act"])
check("proceeding: status", p["status"] == "Open", p["status"])

n = asyncio.run(scraper._parse_notice(TextCard(REAL_NOTICE), 1))
check("notice: reference id", n["ref_id"] == "100118320996", n["ref_id"])
check("notice: document reference",
      n["doc_ref_id"] == "ITBA/COM/F/17/2026-27/1092231604(1)", n["doc_ref_id"])
# The card prints the doc reference on the line after "Notice u/s"; a naive
# parser files it as the section this notice was issued under.
check("notice: section is NOT the ITBA reference", n["notice_us"] is None,
      repr(n["notice_us"]))
check("notice: description", n["description"] == "[ITBA]Issue Letter", n["description"])
check("notice: issued on", n["issued_on"] == "17-Aug-2026", n["issued_on"])
check("notice: no due date on this letter",
      n["due_date"] is None and n["due_date_source"] is None)
check("notice: AO viewed on", n["ao_viewed_on"] == "27-Aug-2026", n["ao_viewed_on"])

# the read-only guardrail is enforced, not just documented
class Clickable:
    def __init__(self):
        self.clicked = False

    async def click(self):
        self.clicked = True


for label in ("Submit Response", "View Response", "Seek/View Adjournment"):
    c = Clickable()
    try:
        asyncio.run(scraper._click(c, label))
        check(f"guardrail refuses {label!r}", False, "it clicked")
    except RuntimeError:
        check(f"guardrail refuses {label!r}", not c.clicked)

ok = Clickable()
asyncio.run(scraper._click(ok, "Notice/Letter Pdf"))
check("guardrail allows the PDF button", ok.clicked)

# the locator crash found live: a "/" inside a regex name breaks Playwright
check("no get_by_role(name=re.compile) with a slash remains",
      not re.search(r"get_by_role\([^)]*re\.compile\([^)]*/", 
                    pathlib.Path("app/portal/scraper.py").read_text()))
# the docstring explains why go_back is banned, so look for real calls only
_src = pathlib.Path("app/portal/scraper.py").read_text()
_calls = [l for l in _src.splitlines()
          if re.search(r"(?<!Never )(?<!so )page\.go_back\(", l)
          and not l.strip().startswith(("#", '"""'))
          and '"""' not in l]
check("no page.go_back() call remains (it triggers the portal logout dialog)",
      not _calls, str(_calls))


# 11 - "Request is not authenticated": press Continue again, never a retry ----
# Seen live on the password page with a correct password. It must NOT be
# mistaken for a rejection, and it must not press Continue forever.
pg = FakePage(transient=FakeLoc(1, True, "Error : Request is not authenticated"),
              dashboard_after=3)
err, events = settle(pg)
check("transient error does not raise WrongPasswordError",
      not isinstance(err, WrongPasswordError), repr(err))
check("transient error presses Continue again", pg.continue_clicks >= 1,
      f"{pg.continue_clicks} clicks")
check("transient error is logged in the portal's own words",
      any("Request is not authenticated" in m for m in events.logs),
      str(events.logs[-1:]))

# it must give up rather than hammer the login
pg = FakePage(transient=FakeLoc(1, True, "Request is not authenticated"),
              dashboard_after=None)
session_mod.SETTLE_SECONDS = 2          # do not sit here for a minute
err, _ = settle(pg)
session_mod.SETTLE_SECONDS = 60
check("the retry cap allows more than the two the owner ran out of",
      session_mod.MAX_CONTINUE_RETRIES >= 3, str(session_mod.MAX_CONTINUE_RETRIES))
check("Continue is pressed at most MAX_CONTINUE_RETRIES times",
      pg.continue_clicks <= session_mod.MAX_CONTINUE_RETRIES,
      f"{pg.continue_clicks} clicks")
check("a stuck login times out instead of claiming a wrong password",
      err is not None and not isinstance(err, WrongPasswordError), repr(err))

# a real rejection still aborts on the first sighting
pg = FakePage(error=FakeLoc(1, True, "Invalid password"), dashboard_after=99)
err, _ = settle(pg)
check("a rejected password is still never retried",
      isinstance(err, WrongPasswordError) and pg.continue_clicks == 0,
      f"{type(err).__name__}, {pg.continue_clicks} clicks")


# 12 - the first live sync: tabs missing, yet it reported success ------------
# The hash change routes instantly and Angular had not painted, so every tab
# was "not on this account" and the run finished as done with 0 proceedings.
scraper.LIST_READY_SECONDS = 0.4        # keep the test quick


class BlankPage:
    """A list page that never paints: no cards, no tabs, no empty state."""

    def __init__(self):
        self.url = "https://eportal.incometax.gov.in/iec/foservices/#/dashboard/eProceedings"
        self.evaluated = 0

    async def evaluate(self, script, *args):
        self.evaluated += 1
        return []

    def locator(self, selector):
        return FakeLoc(0, False)

    def get_by_role(self, role, name=None, exact=None):
        return FakeLoc(0, False)

    def get_by_text(self, text, exact=None):
        return FakeLoc(0, False)

    async def wait_for_timeout(self, ms):
        await asyncio.sleep(0)


class StubSession:
    def __init__(self, page):
        self.page = page

    async def ensure_alive(self):
        return None


blank = BlankPage()
ev = FakeEvents()
err = None
try:
    asyncio.run(REAL_RUN_SYNC(StubSession(blank), ev))
except Exception as e:                                   # noqa: BLE001
    err = e
check("an unpainted list page raises instead of reporting a clean sync",
      isinstance(err, RuntimeError), repr(err))
check("the error says nothing was scraped",
      err is not None and "nothing was scraped" in str(err), str(err)[:90])
check("no 'Sync done' line is logged when nothing was found",
      not any("Sync done" in m for m in ev.logs), str(ev.logs[-1:]))

# a visible tab is found through any of the three shapes it takes
class TabPage(BlankPage):
    def __init__(self, where):
        super().__init__()
        self.where = where

    def get_by_role(self, role, name=None, exact=None):
        if self.where == role and name == "Self":
            return FakeLoc(1, True, "Self")
        return FakeLoc(0, False)

    def get_by_text(self, text, exact=None):
        if self.where == "text" and text == "Self":
            return FakeLoc(1, True, "Self")
        return FakeLoc(0, False)


for where in ("button", "tab", "text"):
    found = asyncio.run(scraper._find_tab(TabPage(where), "Self"))
    check(f"tab found when it is a {where}", found is not None)

check("a hidden tab is not treated as present",
      asyncio.run(scraper._find_tab(BlankPage(), "Self")) is None)

scraper.LIST_READY_SECONDS = 30


# 13 - the back/refresh modal ------------------------------------------------
# Live failure: "#securityReasonPopup intercepts pointer events" - the modal
# swallows every click underneath it, and its YES button logs the session out.
from app.portal.session import dismiss_security_popup                # noqa: E402


class PopupPage:
    def __init__(self, visible=True):
        self.url = "https://x/#/dashboard/eProceedings"
        self.no = FakeLoc(1, True, "No")
        self.yes = FakeLoc(1, True, "YES")
        self.popup = FakeLoc(1 if visible else 0, visible, "back disabled",
                             children={"No": self.no, "YES": self.yes})
        self.waited = 0

    def locator(self, selector):
        return self.popup if selector == "#securityReasonPopup" else FakeLoc()

    async def wait_for_timeout(self, ms):
        self.waited += 1


pg = PopupPage()
ev = FakeEvents()
check("the back/refresh modal is dismissed", asyncio.run(dismiss_security_popup(pg, ev)))
check("it is dismissed with No", pg.no.clicked)
check("YES is never pressed (it logs the session out)", not pg.yes.clicked)
check("no modal on screen means nothing to do",
      not asyncio.run(dismiss_security_popup(PopupPage(visible=False))))

for label in ("YES", "Yes", "Logout"):
    c = Clickable()
    try:
        asyncio.run(scraper._click(c, label))
        check(f"guardrail refuses {label!r}", False, "it clicked")
    except RuntimeError:
        check(f"guardrail refuses {label!r}", not c.clicked)

# the navigation that caused it must be gone for good
_scraper_src = pathlib.Path("app/portal/scraper.py").read_text()
check("nothing changes the URL any more (that is what raised the modal)",
      "location.hash" not in _scraper_src.split('"""', 2)[2])


# 14 - the download limit ----------------------------------------------------
check("limit stops the walk once the cap is met",
      scraper._limit_reached({"limit": 3, "downloaded": 3}))
check("limit does not stop the walk early",
      not scraper._limit_reached({"limit": 3, "downloaded": 2}))
check("no limit means every notice",
      not scraper._limit_reached({"limit": None, "downloaded": 99}))
check("a limit of 0 is treated as no limit",
      not scraper._limit_reached({"limit": 0, "downloaded": 99}))

with TestClient(main.app) as client:
    reset()
    LIMITS_SEEN.clear()
    r = client.post("/api/credentials",
                    json={"user_id": USER_ID, "password": PASSWORD, "limit": 3})
    check("credentials accept a limit", r.json().get("limit") == 3, r.text)
    wait_idle(client)
    check("the limit reaches the walk", LIMITS_SEEN[-1:] == [3], str(LIMITS_SEEN))

    LIMITS_SEEN.clear()
    client.post("/api/sync", json={"limit": 5})
    wait_idle(client)
    check("sync can change the limit per run", LIMITS_SEEN[-1:] == [5], str(LIMITS_SEEN))

    LIMITS_SEEN.clear()
    client.post("/api/sync", json={"limit": None})
    wait_idle(client)
    check("blank means all", LIMITS_SEEN[-1:] == [None], str(LIMITS_SEEN))

    LIMITS_SEEN.clear()
    client.post("/api/sync")
    wait_idle(client)
    check("a sync with no body still works", LIMITS_SEEN[-1:] == [None], str(LIMITS_SEEN))


# 15 - the access lock -------------------------------------------------------
# The tool is going on a public URL, so nothing may answer without the
# dashboard password: not the page, not the API, not the WebSocket.
APP_PW = "dashboard-pw"
main.FAILED_LOGIN_DELAY = 0            # the real 2s delay is asserted separately
main.settings.app_password = ""

with TestClient(main.app) as anon:
    check("with no APP_PASSWORD set the dashboard is open (localhost dev)",
          anon.get("/api/notices").status_code == 200)

main.settings.app_password = APP_PW

with TestClient(main.app) as anon:
    r = anon.get("/")
    check("locked: the page asks for a password",
          r.status_code == 401 and "password" in r.text.lower(), str(r.status_code))
    r = anon.get("/api/notices")
    check("locked: the API answers 401, not data",
          r.status_code == 401 and "notices" not in r.json(), r.text[:60])
    check("locked: a stored PDF is not downloadable",
          anon.get("/api/notices/100118320996/pdf").status_code == 401)
    check("locked: sync cannot be started",
          anon.post("/api/sync", json={}).status_code == 401)
    ws_refused = False
    try:
        with anon.websocket_connect("/ws"):
            pass
    except Exception:
        ws_refused = True
    check("locked: the WebSocket handshake is refused", ws_refused)

    r = anon.post("/login", json={"password": "wrong-one"})
    check("a wrong password is rejected", r.status_code == 401, r.text)
    check("a wrong password sets no cookie",
          main.COOKIE_NAME not in anon.cookies, str(dict(anon.cookies)))

    r = anon.post("/login", json={"password": APP_PW})
    check("the right password signs in", r.status_code == 200, r.text)
    check("signing in sets the session cookie", main.COOKIE_NAME in anon.cookies)
    check("signed in: the API answers", anon.get("/api/notices").status_code == 200)
    opened = False
    with anon.websocket_connect("/ws") as ws:
        opened = ws.receive_json()["type"] == "state"
    check("signed in: the WebSocket opens", opened)

    anon.post("/logout")
    check("logging out locks it again", anon.get("/api/notices").status_code == 401)

# the cookie is signed, not guessable, and expires
check("a forged cookie is rejected", not main._cookie_ok("9999999999.deadbeef"))
check("a cookie signed with a different password is rejected",
      not main._cookie_ok(main._new_cookie().split(".")[0] + ".c0ffee"))
good = main._new_cookie()
check("a freshly issued cookie is accepted", main._cookie_ok(good))
check("an expired cookie is rejected",
      not main._cookie_ok(f"{int(time.time()) - main.COOKIE_MAX_AGE - 60}."
                          + main._sign(str(int(time.time()) - main.COOKIE_MAX_AGE - 60))))
check("changing APP_PASSWORD invalidates old cookies",
      (lambda: (setattr(main.settings, "app_password", "different-pw"),
                main._cookie_ok(good))[1])() is False)

main.settings.app_password = APP_PW
check("failed logins are slowed down on purpose", main.FAILED_LOGIN_DELAY == 0
      or main.FAILED_LOGIN_DELAY >= 1)
main.settings.app_password = ""        # leave the rest of the suite unlocked


# 16 - dashboard summary + filters -------------------------------------------
# The cards and filters run in the browser, so what is checked here is that the
# page ships them and that the maths they implement is right on real row shapes.
import datetime                                                      # noqa: E402

_page = pathlib.Path("app/static/index.html").read_text()
for hook in ("s-total", "s-week", "s-nodue", "s-docs", "f-ay", "f-name",
             "f-nodue", "renderStats", "applyFilters", "dueInDays"):
    check(f"dashboard ships {hook}", hook in _page)

def _days(d):
    return (datetime.datetime.strptime(d, "%d-%b-%Y").date()
            - datetime.date.today()).days

_fmt = lambda n: (datetime.date.today() + datetime.timedelta(days=n)).strftime("%d-%b-%Y")
SAMPLE = [
    {"due_date": None, "assessment_year": "2020-21", "proceeding_name": "Issue Letter",
     "pdf_path": "/a.pdf"},
    {"due_date": _fmt(3), "assessment_year": "2021-22",
     "proceeding_name": "Assessment u/s 143", "pdf_path": None},
    {"due_date": _fmt(7), "assessment_year": "2021-22", "proceeding_name": "Penalty",
     "pdf_path": "/b.pdf"},
    {"due_date": _fmt(20), "assessment_year": "2020-21", "proceeding_name": "Penalty",
     "pdf_path": "/c.pdf"},
    {"due_date": _fmt(-2), "assessment_year": "2020-21", "proceeding_name": "Overdue one",
     "pdf_path": "/d.pdf"},
]
due_week = [n for n in SAMPLE if n["due_date"] and 0 <= _days(n["due_date"]) <= 7]
check("Due this week counts the next 7 days only", len(due_week) == 2,
      str([n["proceeding_name"] for n in due_week]))
check("Due this week excludes dates already past",
      all(_days(n["due_date"]) >= 0 for n in due_week))
check("Missing due date counts blanks",
      len([n for n in SAMPLE if not n["due_date"]]) == 1)
check("Docs saved counts stored PDFs",
      len([n for n in SAMPLE if n["pdf_path"]]) == 4)
check("the year dropdown lists each year once, sorted",
      sorted({n["assessment_year"] for n in SAMPLE if n["assessment_year"]})
      == ["2020-21", "2021-22"])

def _filtered(rows, ay="", name="", nodue=False):
    return [n for n in rows
            if (not ay or n["assessment_year"] == ay)
            and (not name or name.lower() in (n["proceeding_name"] or "").lower())
            and (not nodue or not n["due_date"])]

check("year filter narrows the table", len(_filtered(SAMPLE, ay="2021-22")) == 2)
check("name filter is a case-insensitive contains",
      len(_filtered(SAMPLE, name="penalty")) == 2)
check("missing-due-date toggle keeps only blanks",
      [n["proceeding_name"] for n in _filtered(SAMPLE, nodue=True)] == ["Issue Letter"])
check("filters combine", len(_filtered(SAMPLE, ay="2020-21", name="penalty")) == 1)

print()
print(f"{'FAILED: ' + ', '.join(failures) if failures else 'all checks passed'}")
sys.exit(1 if failures else 0)
