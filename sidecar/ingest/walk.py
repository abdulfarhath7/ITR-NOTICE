"""The six-panel walk with the header/verdict handshake.

For every notice card the sidecar emits a `header` and waits for the core's
verdict: skip, fetch, or stop the panel. The core owns the early-stop streak
and every write; this module owns the clicks. Nothing here writes to the
portal: every click goes through the frozen `_click`, which refuses Submit,
Respond, Appeal and their kin.
"""
import re
from pathlib import Path
from typing import Any

from app.portal.scraper import (  # the verified selectors, reused verbatim
    NOTICE_CARD,
    PROCEEDING_CARD,
    SUB_TABS,
    TABS,
    _click_back,
    _count_from_label,
    _discard,
    _find_tab,
    _goto_list,
    _next_page,
    _safe_click,
    _set_page_size_max,
    _visible_button_names,
    _wait_for_list,
)
from playwright.async_api import Page
from playwright.async_api import TimeoutError as PWTimeout

from .parse import CARD_JS, parse_notice, parse_proceeding
from .protocol import emit, log
from .session import IngestSession, Relay

PANELS = [f"{tab}:{sub}" for tab in TABS for sub in SUB_TABS]


def split_panel(panel: str) -> tuple[str, str]:
    tab, sub = panel.split(":", 1)
    if tab not in TABS or sub not in SUB_TABS:
        raise ValueError(f"unknown panel {panel!r}")
    return tab, sub


class PanelStats:
    def __init__(self, panel: str) -> None:
        self.panel = panel
        self.cards = 0
        self.notices = 0
        self.fetched = 0
        self.skipped = 0
        self.stopped_early = False
        self.note: str | None = None

    def done(self) -> None:
        emit("panel_done", panel=self.panel, cards=self.cards, notices=self.notices,
             fetched=self.fetched, skipped=self.skipped, stopped_early=self.stopped_early,
             note=self.note)


async def _raw(locator: Any) -> dict[str, Any]:
    data: dict[str, Any] = await locator.evaluate(CARD_JS)
    return data


async def list_panel(session: IngestSession, relay: Relay, panel: str) -> None:
    """Walk one panel. Emits headers, honours verdicts, ends with panel_done."""
    page = session.page
    if page is None:
        raise RuntimeError("browser not started")
    tab_key, sub_key = split_panel(panel)
    stats = PanelStats(panel)

    await session.ensure_alive()
    if not await _goto_list(page, relay):
        stats.note = "the e-Proceedings list never rendered"
        emit("panel_missing", panel=panel, msg=stats.note)
        log(f"{stats.note}; visible controls: {await _visible_button_names(page)}", "warn")
        stats.done()
        return

    tab = await _find_tab(page, TABS[tab_key])
    if not tab:
        # Zero is a finding: the panel is recorded as absent, never skipped.
        stats.note = f"tab '{TABS[tab_key]}' is not on this account"
        emit("panel_missing", panel=panel, msg=stats.note)
        stats.done()
        return
    await _safe_click(page, tab, TABS[tab_key], relay)
    await page.wait_for_timeout(1500)
    await _wait_for_list(page)

    sub = page.get_by_role("tab", name=SUB_TABS[sub_key], exact=False).first
    if not await sub.count():
        stats.note = f"sub-tab '{SUB_TABS[sub_key]}' is not shown"
        emit("panel_missing", panel=panel, msg=stats.note)
        stats.done()
        return
    count = _count_from_label(await sub.inner_text())
    await _safe_click(page, sub, SUB_TABS[sub_key], relay)
    await page.wait_for_timeout(1500)
    log(f"{TABS[tab_key]} / {SUB_TABS[sub_key]}: {count} item(s)")
    if count == 0:
        stats.done()
        return

    await _set_page_size_max(page, relay)
    stop = await _walk_pages(session, relay, tab_key, sub_key, stats)
    stats.stopped_early = stop
    stats.done()


async def _walk_pages(session: IngestSession, relay: Relay, tab_key: str, sub_key: str,
                      stats: PanelStats) -> bool:
    page = session.page
    assert page is not None
    seen_pages = 0
    while seen_pages < 50:
        cards = page.locator(PROCEEDING_CARD)
        total = await cards.count()
        log(f"  page {seen_pages + 1}: {total} proceeding card(s)")
        for i in range(total):
            await session.ensure_alive()
            card = page.locator(PROCEEDING_CARD).nth(i)
            if not await card.count():
                break
            await session.pace()
            proceeding, conf = parse_proceeding(await _raw(card), tab_key, sub_key)
            stats.cards += 1
            emit("progress", kind="walk", panel=stats.panel, card=i + 1, of=total,
                 name=proceeding.get("proceeding_name") or "")
            if not proceeding.get("notice_count"):
                # A proceeding shell with no notices is still a record.
                emit("header", panel=stats.panel, proceeding=proceeding, notice=None,
                     confidence={"proceeding": conf, "notice": {}})
                action = await relay.request_verdict()
                if action == "stop":
                    return True
                continue
            if await _collect_notices(session, relay, i, proceeding, conf, stats):
                return True
        if not await _next_page(page):
            return False
        seen_pages += 1
        await page.wait_for_timeout(1500)
    return False


async def _collect_notices(session: IngestSession, relay: Relay, card_index: int,
                           proceeding: dict[str, Any], pconf: dict[str, str],
                           stats: PanelStats) -> bool:
    """Open the proceeding's notices, handshake each one. Returns True when
    the core said stop."""
    page = session.page
    assert page is not None
    card = page.locator(PROCEEDING_CARD).nth(card_index)
    view = card.get_by_role("button", name="View Notices/Orders", exact=False).first
    if not await view.count():
        return False
    await _safe_click(page, view, "View Notices/Orders", relay)
    try:
        await page.wait_for_url(re.compile(r"viewNotices"), timeout=20000)
    except PWTimeout:
        log("  notice list did not open - skipping this proceeding", "warn")
        return False
    await page.wait_for_timeout(1500)

    total = await page.locator(NOTICE_CARD).count()
    log(f"    {total} notice(s) on this proceeding")
    stop = False
    for j in range(total):
        notice_loc = page.locator(NOTICE_CARD).nth(j)
        await session.pace()
        notice, nconf = parse_notice(await _raw(notice_loc))
        if not notice.get("reference_id"):
            log("    a notice card without a reference id was skipped", "warn")
            continue
        stats.notices += 1
        emit("header", panel=stats.panel, proceeding=proceeding, notice=notice,
             confidence={"proceeding": pconf, "notice": nconf})
        action = await relay.request_verdict()
        if action == "stop":
            stop = True
            break
        if action != "fetch":
            stats.skipped += 1
            continue
        emit("progress", kind="download", panel=stats.panel, notice=j + 1, of=total)
        pdf = await _download_from_card(session, relay, notice_loc, str(notice["reference_id"]))
        if pdf:
            stats.fetched += 1
        emit("item", reference_id=notice["reference_id"], pdf_b64=pdf, filename=f"{notice['reference_id']}.pdf",
             note=None if pdf else "the portal did not hand over a file")

    await _click_back(page, relay)
    await page.wait_for_timeout(1500)
    return stop


async def _download_from_card(session: IngestSession, relay: Relay, card: Any, reference_id: str) -> str | None:
    """The card's own PDF button, then Download on the detail page, then the
    portal's Back. Scoped to the card: the page-level first button would be
    the wrong notice whenever a proceeding has more than one."""
    import base64
    page: Page | None = session.page
    assert page is not None
    await session.pace()
    pdf_btn = card.get_by_role("button", name="Notice/Letter Pdf", exact=False).first
    if not await pdf_btn.count():
        return None
    await _safe_click(page, pdf_btn, "Notice/Letter Pdf", relay)
    try:
        await page.wait_for_url(re.compile(r"viewDetailedNotice"), timeout=20000)
        async with page.expect_download(timeout=30000) as dl:
            await _safe_click(page, page.get_by_role("button", name="Download", exact=False).first, "Download", relay)
        download = await dl.value
        try:
            data = Path(await download.path()).read_bytes()
        finally:
            await _discard(download)
        log(f"  downloaded {reference_id}.pdf ({len(data) // 1024} KB)")
        return base64.standard_b64encode(data).decode("ascii") if data else None
    except PWTimeout:
        log(f"  could not download {reference_id} - recorded without a file", "warn")
        return None
    finally:
        await _click_back(page, relay)
        await page.wait_for_timeout(1000)
