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

from playwright.async_api import Page, TimeoutError as PWTimeout, async_playwright

from ..config import settings

LOGIN_URL = "https://eportal.incometax.gov.in/iec/foservices/#/login"
DASHBOARD_MARKER = "/dashboard"
SESSION_SECONDS = 15 * 60
RELOGIN_MARGIN = 2 * 60          # re-login when < 2 min remain


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

    async def _settle_post_password(self) -> None:
        page = self.page
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if DASHBOARD_MARKER in page.url:
                return

            # hard rule: wrong password -> abort, never retry
            for err in ("Invalid password", "incorrect password",
                        "Please enter valid password"):
                if await page.get_by_text(err).count():
                    raise WrongPasswordError(
                        "Portal rejected the password. NOT retrying (the portal "
                        "locks accounts). Check the password and enter it again "
                        "in the dashboard."
                    )

            # force-login: another device holds the session.
            # Generic for now (screenshot pending): any dialog whose button
            # matches these labels gets clicked.
            for label in ("Login Here", "Force Login", "Continue Login", "Yes"):
                btn = page.get_by_role("button", name=label)
                if await btn.count() and await btn.first.is_visible():
                    await self.events.log(
                        f"Another session detected - clicking '{label}'")
                    await btn.first.click()
                    break

            # OTP: freeze and relay through the dashboard
            otp_box = page.get_by_placeholder("OTP").or_(
                page.get_by_text("Enter OTP"))
            if await otp_box.count() and await otp_box.first.is_visible():
                await self.events.log("Portal is asking for an OTP")
                code = await self.events.request_otp()
                field = page.locator(
                    "input[type=tel], input[type=number], "
                    "input[placeholder*='OTP' i]").first
                await field.fill(code)
                await self._click_if_visible("button:has-text('Continue')")
                await self._click_if_visible("button:has-text('Submit')")
                await self.events.log("OTP relayed to the portal")

            await asyncio.sleep(1)

        raise TimeoutError("Login did not reach the dashboard within 60s")

    # ------------------------------------------------------------- keepalive
    def seconds_left(self) -> float:
        return max(0.0, SESSION_SECONDS - (time.monotonic() - self._login_time))

    async def ensure_alive(self) -> None:
        """Call before every scraping action. Re-logins proactively near the
        15-min mark, and reactively if the portal bounced us to /login."""
        bounced = "/login" in (self.page.url or "")
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
