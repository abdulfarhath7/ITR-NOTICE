"""Portal session manager.

Owns the Playwright browser and implements, in order:
  1. auto-login  (User ID page -> Continue -> secure-access checkbox -> password -> Continue)
  2. force-login (if the portal says "already logged in elsewhere", confirm it)
  3. OTP pause   (if an OTP field appears, freeze and wait for the dashboard relay)
  4. re-login    (session lasts ~15 min; we re-login proactively at the 13-min mark
                  and reactively whenever a navigation bounces us to the login page)
  5. hard rule   (a wrong-password error aborts the run - we NEVER retry the
                  password, because the portal locks accounts after a few failures)

Credentials are handed in by the caller (the dashboard keeps them in memory);
this module never reads them from .env and never logs them.

Selectors are text/placeholder based (matches the screenshots), which survives
minor portal facelifts far better than CSS classes.
"""
import asyncio
import time
from pathlib import Path

from playwright.async_api import Page, TimeoutError as PWTimeout, async_playwright

from ..config import settings

LOGIN_URL = "https://eportal.incometax.gov.in/iec/foservices/#/login"
DASHBOARD_MARKER = "/dashboard"
SESSION_SECONDS = 15 * 60
RELOGIN_MARGIN = 2 * 60          # re-login when < 2 min remain

# How long the post-password loop watches for a result, how often it looks,
# and how long it refuses to believe an error message. The grace period exists
# because the password page keeps its Angular validation nodes in the DOM from
# load: they are invisible, but they are there, and sampling them while the
# password page is still on screen reads an error that never happened.
SETTLE_SECONDS = 60
POLL_SECONDS = 1.0
ERROR_GRACE_SECONDS = 3.0

PASSWORD_ERRORS = ("Invalid password", "incorrect password",
                   "Please enter valid password")

# Seen live on the password page: the portal sometimes answers a perfectly
# good password with "Request is not authenticated" and simply wants the
# Continue button pressed again. This is NOT a rejected password - it never
# raises WrongPasswordError - but each press is still a login attempt, so it
# is capped and it only ever fires on this exact wording.
TRANSIENT_ERRORS = ("Request is not authenticated",)
MAX_CONTINUE_RETRIES = 2
FORCE_LOGIN_LABELS = ("Login Here", "Force Login", "Continue Login", "Yes")


SECURITY_POPUP = "#securityReasonPopup"


async def dismiss_security_popup(page, events=None) -> bool:
    """The portal answers Back / Forward / Refresh - and any URL or hash change
    - with a modal: "For security reasons, we have disabled Back, Forward and
    Refresh actions of the browser. Are you sure you want to Logout?" with
    YES / No. While it is up it swallows every click on the page underneath.

    YES logs the session out, so it is never pressed. We answer No.
    """
    popup = page.locator(SECURITY_POPUP)
    try:
        if not await popup.count() or not await popup.first.is_visible():
            return False
    except Exception:
        return False
    for label in ("No", "NO", "Cancel"):
        btn = popup.first.get_by_role("button", name=label, exact=True).first
        try:
            if await btn.count() and await btn.is_visible():
                await btn.click(timeout=5000)
                if events:
                    await events.log(
                        f"Dismissed the portal's back/refresh warning ('{label}')")
                await page.wait_for_timeout(600)
                return True
        except Exception:
            continue
    if events:
        await events.log("Back/refresh warning is up and would not dismiss")
    return False


async def first_visible(locator):
    """Return the first match only if a human could actually see it.

    `.count()` on its own is not evidence: the portal ships hidden templates
    for errors, popups and the OTP box, and get_by_text matches substrings.
    Every check in the settle loop goes through here.
    """
    try:
        first = locator.first
        if await first.count() and await first.is_visible():
            return first
    except PWTimeout:
        return None
    return None


class WrongPasswordError(RuntimeError):
    """Raised once, never retried. Fix .env, then run again."""


class PortalSession:
    def __init__(self, events, user_id: str, password: str):
        """events: the hub the FastAPI layer passes in. Needs:
             .log(msg)                    - push a log line to the dashboard
             .request_otp() -> str        - block until the user types the OTP

        user_id / password: typed into the dashboard, held in memory by the
        hub, passed in here. Never persisted, never logged.
        """
        self.events = events
        self._user_id = user_id
        self._password = password
        self._pw = None
        self.browser = None
        self.page: Page | None = None
        self._login_time = 0.0

    # ------------------------------------------------------------- lifecycle
    async def start(self) -> None:
        self._pw = await async_playwright().start()
        self.browser = await self._pw.chromium.launch(
            headless=settings.headless,
            # Only worth slowing down when there is a window to watch.
            slow_mo=0 if settings.headless else settings.slow_mo_ms,
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx = await self.browser.new_context(
            viewport={"width": 1440, "height": 900},
            accept_downloads=True,
        )
        self.page = await ctx.new_page()

    async def stop(self) -> None:
        try:
            if self.page and DASHBOARD_MARKER in self.page.url:
                await self._click_if_visible("text=Logout", timeout=3000)
        finally:
            if self.browser:
                await self.browser.close()
            if self._pw:
                await self._pw.stop()

    # ----------------------------------------------------------------- login
    async def login(self) -> None:
        page = self.page
        await self.events.log("Opening portal login page")
        await page.goto(LOGIN_URL, wait_until="domcontentloaded")

        # --- page 1: User ID ------------------------------------------------
        uid = page.get_by_placeholder("PAN/ AADHAAR/ OTHER USER ID")
        await uid.wait_for(state="visible", timeout=30000)
        await uid.fill(self._user_id)
        await page.get_by_role("button", name="Continue").click()
        await self.events.log("User ID submitted")

        # --- page 2: secure access + password -------------------------------
        confirm = page.get_by_text("Please confirm your secure access message")
        await confirm.wait_for(state="visible", timeout=30000)
        checkbox = page.locator("input[type=checkbox]").first
        if not await checkbox.is_checked():
            await checkbox.check()
        await page.get_by_placeholder("Password").or_(
            page.locator("input[type=password]")
        ).first.fill(self._password)
        await page.get_by_role("button", name="Continue").click()
        await self.events.log("Password submitted")

        # --- what happens next: dashboard | force-login | OTP | error -------
        await self._settle_post_password()
        self._login_time = time.monotonic()
        await self.events.log("Logged in")

    async def _resubmit_password(self) -> None:
        """Press Continue again after a transient portal error. Re-types the
        password only if the portal blanked the field."""
        page = self.page
        field = page.get_by_placeholder("Password").or_(
            page.locator("input[type=password]")).first
        try:
            if await field.count() and not (await field.input_value()):
                await field.fill(self._password)
        except Exception:
            pass
        await page.get_by_role("button", name="Continue").first.click()

    async def _settle_post_password(self) -> None:
        page = self.page
        started = time.monotonic()
        deadline = started + SETTLE_SECONDS
        otp_relayed = False       # one relay per prompt, not one per poll
        retries = 0
        while time.monotonic() < deadline:
            if DASHBOARD_MARKER in page.url:
                return

            # transient portal hiccup: same password, press Continue again
            if retries < MAX_CONTINUE_RETRIES:
                hiccup = None
                for err in TRANSIENT_ERRORS:
                    hiccup = await first_visible(page.get_by_text(err))
                    if hiccup:
                        break
                if hiccup:
                    retries += 1
                    words = (await hiccup.inner_text()).strip()
                    await self.events.log(
                        f"Portal said {words!r} - pressing Continue again "
                        f"({retries}/{MAX_CONTINUE_RETRIES})")
                    await self._resubmit_password()
                    started = time.monotonic()   # the grace period starts over
                    await asyncio.sleep(POLL_SECONDS)
                    continue

            # hard rule: wrong password -> abort, never retry.
            # Held off for the first few seconds: see ERROR_GRACE_SECONDS.
            if time.monotonic() - started >= ERROR_GRACE_SECONDS:
                for err in PASSWORD_ERRORS:
                    shown = await first_visible(page.get_by_text(err))
                    if shown:
                        words = (await shown.inner_text()).strip()
                        raise WrongPasswordError(
                            "Portal rejected the password. NOT retrying (the "
                            "portal locks accounts). Check the password and "
                            "enter it again in the dashboard. The portal says: "
                            f"{words!r}"
                        )

            # force-login: another device holds the session.
            # Generic for now (screenshot pending): any dialog whose button
            # matches these labels gets clicked - if it is on screen.
            for label in FORCE_LOGIN_LABELS:
                btn = await first_visible(page.get_by_role("button", name=label))
                if btn:
                    await self.events.log(
                        f"Another session detected - clicking '{label}'")
                    await btn.click()
                    break

            # OTP: freeze and relay through the dashboard
            otp_box = await first_visible(
                page.get_by_placeholder("OTP").or_(page.get_by_text("Enter OTP")))
            if not otp_box:
                otp_relayed = False        # prompt gone; a later one is new
            elif not otp_relayed:
                await self.events.log("Portal is asking for an OTP")
                code = await self.events.request_otp()
                field = page.locator(
                    "input[type=tel], input[type=number], "
                    "input[placeholder*='OTP' i]").first
                await field.fill(code)
                await self._click_if_visible("button:has-text('Continue')")
                await self._click_if_visible("button:has-text('Submit')")
                otp_relayed = True
                await self.events.log("OTP relayed to the portal")

            await asyncio.sleep(POLL_SECONDS)

        raise TimeoutError(
            f"Login did not reach the dashboard within {SETTLE_SECONDS}s")

    # --------------------------------------------------------------- debug
    async def save_debug_screenshot(self, tag: str = "fail") -> str | None:
        """Full-page shot of whatever the browser is showing. Called on the
        failure path so a crashed run leaves something to look at."""
        if not self.page:
            return None
        try:
            dest = (Path(settings.debug_dir)
                    / f"{tag}-{time.strftime('%Y%m%d-%H%M%S')}.png")
            dest.parent.mkdir(parents=True, exist_ok=True)
            await self.page.screenshot(path=str(dest), full_page=True)
            return str(dest)
        except Exception:
            return None      # a screenshot failing must never mask the real error

    # ------------------------------------------------------------- keepalive
    def seconds_left(self) -> float:
        return max(0.0, SESSION_SECONDS - (time.monotonic() - self._login_time))

    async def ensure_alive(self) -> None:
        """Call before every scraping action. Re-logins proactively near the
        15-min mark, and reactively if the portal bounced us to /login."""
        url = self.page.url or ""
        # Seen live: an expired session lands on #/sessionExpire, not /login.
        bounced = "/login" in url or "sessionExpire" in url
        if bounced or self.seconds_left() < RELOGIN_MARGIN:
            reason = "session expired" if bounced else "session about to expire"
            await self.events.log(f"Re-login ({reason})")
            await self.login()

    # --------------------------------------------------------------- helpers
    async def _click_if_visible(self, selector: str, timeout: int = 2000) -> bool:
        try:
            loc = self.page.locator(selector).first
            await loc.wait_for(state="visible", timeout=timeout)
            await loc.click()
            return True
        except PWTimeout:
            return False
