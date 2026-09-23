"""Run the portal cartographer.

    cd sidecar
    ITR_RECON_USER=... ITR_RECON_PASSWORD=... ../.venv/bin/python -m recon --portal itd
    ../.venv/bin/python -m recon --portal itd --ask        # prompt for credentials
    ../.venv/bin/python -m recon --portal gst              # log in by hand, then it crawls

Credentials are read from the environment or typed at the prompt, held in
memory only, and never written anywhere. If the portal asks for an OTP, the
run writes OTP_NEEDED into the run folder and waits (up to --otp-wait
minutes) for a file named OTP containing the code; the file is deleted as
soon as it is read.

Output: data/portal-map/<portal>-<timestamp>/ (gitignored, contains client
data). Start with INDEX.md and api-catalog.json.
"""
import argparse
import asyncio
import getpass
import os
import sys
import time
from pathlib import Path

from app.config import settings
from app.portal.session import PortalSession, WrongPasswordError
from playwright.async_api import Page, async_playwright

from .capture import NetRecorder
from .crawler import Crawler

ROOT = Path(__file__).resolve().parents[2] / "data" / "portal-map"

GST_LOGIN = "https://services.gst.gov.in/services/login"


class Events:
    """The hub PortalSession expects: log lines, pacing, and an OTP relay."""

    def __init__(self, run_dir: Path, otp_wait_min: int, logfile: Path) -> None:
        self.run_dir = run_dir
        self.otp_wait = otp_wait_min * 60
        self.logfile = logfile

    def line(self, msg: str) -> None:
        stamp = time.strftime("%H:%M:%S")
        text = f"{stamp} {msg}"
        print(text, flush=True)
        with self.logfile.open("a") as f:
            f.write(text + "\n")

    async def log(self, msg: str) -> None:
        self.line(msg)

    def pace_seconds(self) -> float:
        return 0.6

    async def request_otp(self) -> str:
        flag = self.run_dir / "OTP_NEEDED"
        box = self.run_dir / "OTP"
        flag.write_text("Write the OTP into a file named OTP in this folder.\n")
        self.line(f"OTP requested. Put the code in {box} (waiting {self.otp_wait // 60} min)")
        deadline = time.monotonic() + self.otp_wait
        while time.monotonic() < deadline:
            if box.exists():
                code = box.read_text().strip()
                box.unlink(missing_ok=True)
                flag.unlink(missing_ok=True)
                if code:
                    return code
            await asyncio.sleep(3)
        raise TimeoutError("No OTP supplied in time; stopping without touching the account further")


def credentials(ask: bool) -> tuple[str, str]:
    user = os.environ.get("ITR_RECON_USER", "")
    pw = os.environ.get("ITR_RECON_PASSWORD", "")
    if ask or not (user and pw):
        if not sys.stdin.isatty():
            raise SystemExit("Set ITR_RECON_USER and ITR_RECON_PASSWORD, or run with --ask in a terminal.")
        user = user or input("Portal user ID (PAN): ").strip()
        pw = pw or getpass.getpass("Portal password: ")
    return user, pw


async def run_itd(args: argparse.Namespace, run_dir: Path, ev: Events) -> None:
    user, pw = credentials(args.ask)
    settings.headless = not args.headful
    session = PortalSession(ev, user, pw)
    await session.start()
    assert session.page is not None
    net = NetRecorder(run_dir / "network")
    net.attach(session.page)
    session.page.context.on("page", lambda p: asyncio.ensure_future(_close_popup(p, ev)))
    try:
        await session.login()
        net.current_screen = "home"
        crawler = Crawler(session.page, run_dir, net, ev.line, session.ensure_alive,
                          home_labels=("Dashboard", "Home"), pace=args.pace,
                          max_screens=args.max_screens)
        if args.path:
            await crawler.capture_paths([[x.strip() for x in p.split(">")] for p in args.path])
        else:
            await crawler.crawl()
        ev.line(f"done: {len(crawler.screens)} screens, {len(crawler.errors)} errors")
    except WrongPasswordError as e:
        ev.line(f"STOPPED: {e}")
    finally:
        net.flush(run_dir / "api-catalog.json")
        await session.stop()


async def run_gst(args: argparse.Namespace, run_dir: Path, ev: Events) -> None:
    """The GST portal always shows a captcha, so a human logs in; the crawl
    starts once the dashboard is up. Never unattended."""
    pw_ = await async_playwright().start()
    browser = await pw_.chromium.launch(headless=False)
    ctx = await browser.new_context(viewport={"width": 1440, "height": 900})
    page = await ctx.new_page()
    net = NetRecorder(run_dir / "network")
    net.attach(page)
    try:
        await page.goto(GST_LOGIN)
        ev.line(f"Log in by hand in the opened window; waiting up to {args.otp_wait} min")
        deadline = time.monotonic() + args.otp_wait * 60
        while time.monotonic() < deadline and "dashboard" not in page.url.lower():
            await asyncio.sleep(3)
        if "dashboard" not in page.url.lower():
            ev.line("No login seen; stopping")
            return
        net.current_screen = "home"

        async def alive() -> None:
            return None

        crawler = Crawler(page, run_dir, net, ev.line, alive,
                          home_labels=("Dashboard", "Home"), pace=args.pace,
                          max_screens=args.max_screens)
        await crawler.crawl()
        ev.line(f"done: {len(crawler.screens)} screens, {len(crawler.errors)} errors")
    finally:
        net.flush(run_dir / "api-catalog.json")
        await browser.close()
        await pw_.stop()


async def _close_popup(page: Page, ev: Events) -> None:
    """New tabs (help pages, external sites) are noted and closed, not crawled."""
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10000)
        ev.line(f"closed new tab: {page.url[:120]}")
        await page.close()
    except Exception:  # noqa: BLE001
        pass


def main() -> None:
    ap = argparse.ArgumentParser(prog="recon")
    ap.add_argument("--portal", choices=("itd", "gst"), default="itd")
    ap.add_argument("--ask", action="store_true", help="prompt for credentials")
    ap.add_argument("--headful", action="store_true", help="show the browser")
    ap.add_argument("--pace", type=float, default=1.5, help="seconds between clicks")
    ap.add_argument("--max-screens", type=int, default=400)
    ap.add_argument("--otp-wait", type=int, default=30, help="minutes to wait for OTP / manual login")
    ap.add_argument("--label", default="", help="suffix for the run folder, e.g. a client tag")
    ap.add_argument("--path", action="append", default=[],
                    help='capture one click path instead of crawling, e.g. "e-File > Income Tax Forms > View Filed Forms > View All"; repeatable')
    args = ap.parse_args()

    stamp = time.strftime("%Y%m%d-%H%M%S")
    run_dir = ROOT / f"{args.portal}-{stamp}{('-' + args.label) if args.label else ''}"
    run_dir.mkdir(parents=True, exist_ok=True)
    ev = Events(run_dir, args.otp_wait, run_dir / "run.log")
    ev.line(f"output: {run_dir}")
    runner = run_itd if args.portal == "itd" else run_gst
    asyncio.run(runner(args, run_dir, ev))


if __name__ == "__main__":
    main()
