"""Login for the ingestion sidecar: the frozen `PortalSession` flow plus a
captcha pause. Password, captcha and OTP are relayed through the Rust core
and the run waits as long as it takes (docs/05 "never fail on a human")."""
import asyncio
import base64
import time

from app.portal.session import (  # the frozen, verified login mechanics
    DASHBOARD_MARKER,
    LOGIN_URL,
    PortalSession,
    WrongPasswordError,
    announce_phase,
    first_visible,
)

from .protocol import emit, log

# Captcha selectors are unverified against the live portal: no capture shows
# one. They are deliberately broad and every match is logged, so the first
# run that meets a captcha tells us what the portal actually renders.
# TODO(blocked): confirm captcha markup from a live capture, see NOTES.md.
CAPTCHA_IMAGE = "img[src*='captcha' i], img[alt*='captcha' i], [class*='captcha' i] img, canvas[id*='captcha' i]"
CAPTCHA_INPUT = "input[placeholder*='captcha' i], input[formcontrolname*='captcha' i], input[id*='captcha' i], input[name*='captcha' i]"


class Relay:
    """What the session needs from the outside world: log lines, pacing, and
    a way to wait for a human. The command loop resolves the futures."""

    def __init__(self) -> None:
        self._challenge: asyncio.Future[str] | None = None
        self._verdict: asyncio.Future[str] | None = None
        self._pace = 0.4

    async def log(self, msg: str) -> None:
        log(msg)

    async def login_phase(self, phase: str) -> None:
        emit("login_phase", phase=phase)

    def pace_seconds(self) -> float:
        return self._pace

    def set_pace(self, seconds: float) -> None:
        self._pace = max(0.0, float(seconds))

    async def request_otp(self) -> str:
        return await self.request_challenge("otp", None)

    async def request_challenge(self, kind: str, image_b64: str | None) -> str:
        loop = asyncio.get_running_loop()
        self._challenge = loop.create_future()
        emit("challenge", kind=kind, image_b64=image_b64)
        value: str = await self._challenge          # no timeout, by design
        self._challenge = None
        return value

    def supply_challenge(self, value: str) -> None:
        if self._challenge and not self._challenge.done():
            self._challenge.set_result(value)

    async def request_verdict(self) -> str:
        loop = asyncio.get_running_loop()
        self._verdict = loop.create_future()
        action: str = await self._verdict
        self._verdict = None
        return action

    def supply_verdict(self, action: str) -> None:
        if self._verdict and not self._verdict.done():
            self._verdict.set_result(action)

    def cancel_waits(self) -> None:
        for fut in (self._challenge, self._verdict):
            if fut and not fut.done():
                fut.cancel()


class IngestSession(PortalSession):
    """The frozen login flow with a captcha check before each Continue."""

    def __init__(self, relay: Relay, login_ref: str, password: str) -> None:
        super().__init__(relay, login_ref, password)
        self.relay = relay

    async def _clear_captcha_if_shown(self) -> None:
        page = self.page
        if page is None:
            return
        img = await first_visible(page.locator(CAPTCHA_IMAGE))
        box = await first_visible(page.locator(CAPTCHA_INPUT))
        if not box:
            return
        image_b64: str | None = None
        if img:
            try:
                image_b64 = base64.standard_b64encode(await img.screenshot(type="png")).decode("ascii")
            except Exception:  # noqa: BLE001 - a failed crop still leaves the whole-page view
                image_b64 = None
        await announce_phase(self.relay, "captcha")
        log("Portal is asking for a captcha")
        value = await self.relay.request_challenge("captcha", image_b64)
        await self.pace()
        await box.fill(value)
        log("Captcha relayed to the portal")

    async def login(self) -> None:
        page = self.page
        if page is None:
            raise RuntimeError("browser not started")
        self.in_login = True
        await announce_phase(self.relay, "opening")
        log("Opening portal login page")
        await page.goto(LOGIN_URL, wait_until="domcontentloaded")

        uid = page.get_by_placeholder("PAN/ AADHAAR/ OTHER USER ID")
        await uid.wait_for(state="visible", timeout=30000)
        await announce_phase(self.relay, "credentials")
        await self.pace()
        await uid.fill(self._user_id)
        await self._clear_captcha_if_shown()
        await self.pace()
        await page.get_by_role("button", name="Continue").click()
        log("User ID submitted")

        confirm = page.get_by_text("Please confirm your secure access message")
        await confirm.wait_for(state="visible", timeout=30000)
        checkbox = page.locator("input[type=checkbox]").first
        if not await checkbox.is_checked():
            await self.pace()
            await checkbox.check()
        await self.pace()
        await page.get_by_placeholder("Password").or_(page.locator("input[type=password]")).first.fill(self._password)
        await self._clear_captcha_if_shown()
        await self.pace()
        await page.get_by_role("button", name="Continue").click()
        log("Password submitted")

        try:
            await self._settle_post_password()
        finally:
            self.sensitive_until = time.monotonic() + 2
            self.in_login = False
        self._login_time = time.monotonic()
        await announce_phase(self.relay, "done")
        log("Logged in")

    def on_dashboard(self) -> bool:
        return bool(self.page and DASHBOARD_MARKER in self.page.url)


__all__ = ["IngestSession", "Relay", "WrongPasswordError"]
