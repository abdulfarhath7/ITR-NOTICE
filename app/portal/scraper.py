"""e-Proceedings scraper. Read-only by design.

Rewritten against the live portal (recon dumps under data/debug/recon*/),
not against screenshots. What the real site forced:

  - The browser Back button is a trap. The portal answers it with "For
    security reasons, we have disabled Back, Forward and Refresh actions of
    the browser. Are you sure you want to Logout?" - so page.go_back() was
    one stray click away from ending the session. Every return trip now uses
    the page's own "Back" button, which was verified to land back on the
    notices list and then the proceedings list with no dialog at all.
  - For the same reason we never goto()/reload the list. Moving the URL hash
    is a same-document navigation, exactly what an in-app link does.
  - Cards: proceedings are div.card-container.matCardRow, notices are
    div.card-container.matCard - note the different class. The old
    locator("div", has_text=...) matched 663 elements on the real page.
  - get_by_role(name=re.compile(...)) raises InvalidSelectorError when the
    pattern contains "/" in Playwright 1.62, which every notice-level
    locator here used to do. Plain substring names, matched case-insensitively
    against the accessible name, work: the button reads "Notice/Letter pdf"
    with a lowercase p, so exact=False matters twice over.
  - Items per Page is an Angular mat-select, not a <select>. This account had
    40 items shown 10 at a time, so without it three quarters were missed.

HARD GUARDRAIL: this module never clicks Submit Response, View Response,
File Appeal, Seek Video Conferencing, Seek/View Adjournment or any control
that writes to the portal. Those buttons sit on the same notice card as the
PDF button, so every click goes through _click(), which refuses them.
"""
import re
import time
from pathlib import Path

from playwright.async_api import TimeoutError as PWTimeout

from .. import db
from ..config import settings
from .session import PortalSession, first_visible

LIST_HASH = "#/dashboard/eProceedings"
PROCEEDING_CARD = "div.card-container.matCardRow"
NOTICE_CARD = "div.card-container.matCard"

TABS = {
    "self": "Self",
    "other_pan": "Of Other PAN/TAN",
    "auth_rep": "As Authorized Representative",
}
SUB_TABS = {"action": "For your Action", "information": "For your Information"}

# Moving the hash routes instantly, but Angular still has to paint. Waiting
# for the URL alone found an empty page and "skipped" every tab in under a
# second, then called that a successful sync.
LIST_READY_SECONDS = 30

# Never clicked. "View Response" and "Seek/View Adjournment" live on the very
# same notice card as the PDF button, so this is enforced, not just documented.
FORBIDDEN = ("submit response", "view response", "file appeal",
             "seek video conferencing", "seek/view adjournment",
             "e-verify", "withdraw", "pay now")


async def _click(locator, label: str) -> None:
    """The only way this module clicks anything."""
    if any(bad in label.lower() for bad in FORBIDDEN):
        raise RuntimeError(f"read-only guardrail: refused to click {label!r}")
    await locator.click()


async def _click_back(page, events) -> None:
    """The portal's own Back button. Never page.go_back() - see module docs."""
    back = page.get_by_role("button", name="Back", exact=True).first
    try:
        await back.wait_for(state="visible", timeout=10000)
        await _click(back, "Back")
    except PWTimeout:
        await events.log("No in-page Back button found - returning via the URL")
        await _goto_list(page, events)


async def _goto_list(page, events=None) -> bool:
    """Same-document hash change: what an in-app link does, so the portal's
    refresh guard never fires. Returns True once the list has actually
    rendered - the URL changing is not enough."""
    await page.evaluate("hash => { window.location.hash = hash; }", LIST_HASH)
    if await _wait_for_list(page):
        return True

    # The hash route did not paint. Fall back to clicking the menu.
    if events:
        await events.log("  list did not render - trying the Pending Actions menu")
    try:
        await page.get_by_text("Pending Actions", exact=False).first.click()
        await page.wait_for_timeout(1200)
        await page.get_by_text(re.compile(r"e-?Proceedings", re.I)).first.click()
    except Exception:
        pass
    return await _wait_for_list(page)


async def _wait_for_list(page) -> bool:
    """Rendered means a proceeding card, a tab, or an explicit empty state."""
    deadline = time.monotonic() + LIST_READY_SECONDS
    while time.monotonic() < deadline:
        if "eProceedings" in page.url and "viewNotices" not in page.url:
            if await page.locator(PROCEEDING_CARD).count():
                return True
            for label in TABS.values():
                if await _find_tab(page, label):
                    return True
            for empty in ("No records", "no records found", "No Data"):
                if await first_visible(page.get_by_text(empty)):
                    return True
        await page.wait_for_timeout(500)
    return False


async def _find_tab(page, label):
    """The tabs are buttons on the list page but Material tabs elsewhere, and
    only a visible one counts."""
    for candidate in (page.get_by_role("button", name=label, exact=True),
                      page.get_by_role("tab", name=label, exact=False),
                      page.get_by_text(label, exact=True)):
        hit = await first_visible(candidate)
        if hit:
            return hit
    return None


async def _visible_button_names(page) -> list[str]:
    """Only used to explain a failure."""
    try:
        return await page.evaluate(r"""
        () => [...document.querySelectorAll('button, [role=tab]')]
            .filter(e => { const r = e.getBoundingClientRect();
                           return r.width > 0 && r.height > 0; })
            .map(e => (e.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40))
            .filter(Boolean).slice(0, 25)""")
    except Exception:
        return []


async def run_sync(session: PortalSession, events) -> dict:
    page = session.page
    stats = {"proceedings": 0, "notices": 0, "downloaded": 0, "skipped_cached": 0}

    with db.connect() as con:
        await session.ensure_alive()
        if not await _goto_list(page, events):
            raise RuntimeError(
                "The e-Proceedings list never rendered - nothing was scraped. "
                f"Visible controls: {await _visible_button_names(page)}")

        tabs_walked = 0
        for tab_key, tab_label in TABS.items():
            tab = await _find_tab(page, tab_label)
            if not tab:
                await events.log(f"Tab '{tab_label}' not on this account - skipped")
                continue
            tabs_walked += 1
            await _click(tab, tab_label)
            await page.wait_for_timeout(1500)
            await _wait_for_list(page)

            for sub_key, sub_label in SUB_TABS.items():
                sub = page.get_by_role("tab", name=sub_label, exact=False).first
                if not await sub.count():
                    continue
                count = _count_from_label(await sub.inner_text())
                await _click(sub, sub_label)
                await page.wait_for_timeout(1500)
                await events.log(f"{tab_label} / {sub_label}: {count} item(s)")
                if count == 0:
                    continue

                await _set_page_size_max(page, events)
                await _walk_pages(session, events, con, tab_key, sub_key, stats)

        # Reporting "0 proceedings" as a clean run is how the first live sync
        # hid this exact failure. If no tab matched, the run failed.
        if tabs_walked == 0:
            raise RuntimeError(
                "No e-Proceedings tab was found, so nothing could be scraped. "
                f"Visible controls: {await _visible_button_names(page)}")

    await events.log(
        f"Sync done: {stats['proceedings']} proceedings, {stats['notices']} notices, "
        f"{stats['downloaded']} new PDFs, {stats['skipped_cached']} already held")
    return stats


async def _walk_pages(session, events, con, tab_key, sub_key, stats) -> None:
    page = session.page
    seen_pages = 0
    while seen_pages < 50:                     # a sane ceiling, not a real limit
        cards = page.locator(PROCEEDING_CARD)
        total = await cards.count()
        await events.log(f"  page {seen_pages + 1}: {total} proceeding card(s)")

        for i in range(total):
            await session.ensure_alive()
            # Re-locate every time: opening a notice list re-renders the page.
            card = page.locator(PROCEEDING_CARD).nth(i)
            if not await card.count():
                break
            p = await _parse_proceeding(card, tab_key, sub_key)
            pid = db.upsert_proceeding(con, p)
            stats["proceedings"] += 1
            await _collect_notices(session, events, con, i, pid, stats)

        if not await _next_page(page):
            return
        seen_pages += 1
        await page.wait_for_timeout(1500)


# -------------------------------------------------------------- notice level
async def _collect_notices(session, events, con, card_index, proceeding_id, stats):
    page = session.page
    card = page.locator(PROCEEDING_CARD).nth(card_index)
    view = card.get_by_role("button", name="View Notices/Orders", exact=False).first
    if not await view.count():
        return

    await _click(view, "View Notices/Orders")
    try:
        await page.wait_for_url(re.compile(r"viewNotices"), timeout=20000)
    except PWTimeout:
        await events.log("  notice list did not open - skipping this proceeding")
        return
    await page.wait_for_timeout(1500)

    total = await page.locator(NOTICE_CARD).count()
    for j in range(total):
        notice = page.locator(NOTICE_CARD).nth(j)
        n = await _parse_notice(notice, proceeding_id)
        if not n["ref_id"]:
            continue
        stats["notices"] += 1

        if db.notice_exists(con, n["ref_id"]):
            stats["skipped_cached"] += 1       # cache rule: never fetch twice
            continue

        pdf = notice.get_by_role("button", name="Notice/Letter Pdf", exact=False).first
        if await pdf.count():
            n["pdf_path"] = await _download(session, events, n["ref_id"])
            if n["pdf_path"]:
                stats["downloaded"] += 1
        db.upsert_notice(con, n)

    await _click_back(page, events)            # back to the proceedings list
    await page.wait_for_timeout(1500)


async def _download(session, events, ref_id) -> str | None:
    """Notice card -> 'Notice/Letter pdf' -> detail page -> Download -> back."""
    page = session.page
    pdf = page.get_by_role("button", name="Notice/Letter Pdf", exact=False).first
    await _click(pdf, "Notice/Letter Pdf")
    try:
        await page.wait_for_url(re.compile(r"viewDetailedNotice"), timeout=20000)
        async with page.expect_download(timeout=30000) as dl:
            await _click(page.get_by_role("button", name="Download",
                                          exact=False).first, "Download")
        download = await dl.value
        dest = Path(settings.notices_dir) / f"{ref_id}.pdf"
        dest.parent.mkdir(parents=True, exist_ok=True)
        await download.save_as(dest)
        await events.log(f"  downloaded {ref_id}.pdf")
        return str(dest)
    except PWTimeout:
        await events.log(f"  could not download {ref_id} - stored without a file")
        return None
    finally:
        await _click_back(page, events)        # back to the notice list
        await page.wait_for_timeout(1000)


# ------------------------------------------------------------------- parsing
async def _parse_proceeding(card, tab_key, sub_key) -> dict:
    text = await card.inner_text()
    return {
        "tab": tab_key, "sub_tab": sub_key,
        "proceeding_name": _after(text, "Proceeding Name"),
        "pan": _match(text, r"\b([A-Z]{5}\d{4}[A-Z])\b"),
        "assessee_name": _after(text, "Name of Assessee"),
        "assessment_year": _after(text, "Assessment Year"),
        "financial_year": _after(text, "Financial Year"),
        "applicable_act": _after(text, "Applicable Act"),
        "status": _match(text, r"\b(Open|Closed|Submitted)\b"),
        "closure_date": _after(text, "Proceeding Closure Date"),
        "closure_order": _after(text, "Proceeding Closure Order"),
    }


async def _parse_notice(card, proceeding_id) -> dict:
    text = await card.inner_text()
    due = _after(text, "Response Due Date")
    doc_ref = _match(text, r"(ITBA/[\w/().-]+)")

    # The card prints "Notice u/s" and then, on the next line, the document
    # reference - the "Document reference ID" label sits *below* its value.
    # A notice with no section (an Issue Letter) would otherwise record the
    # ITBA reference as its section.
    notice_us = _after(text, "Notice u/s")
    if notice_us and notice_us.startswith("ITBA/"):
        notice_us = None

    return {
        "proceeding_id": proceeding_id,
        "ref_id": _match(text, r"Reference ID\s*:?\s*(\d+)"),
        "notice_us": notice_us,
        "doc_ref_id": doc_ref,
        "description": _after(text, "Description"),
        "issued_on": _after(text, "Issued On"),
        "served_on": _after(text, "Served On"),
        "due_date": due or None,                       # empty stays NULL
        "due_date_source": "portal" if due else None,
        "ao_viewed_on": _after(text, "Response viewed by AO on"),
        "pdf_path": None,
    }


# ------------------------------------------------------------------- helpers
def _after(text: str, label: str) -> str | None:
    m = re.search(rf"{re.escape(label)}\s*:?\s*\n?\s*([^\n]+)", text)
    if not m:
        return None
    val = m.group(1).strip()
    return None if val in {"-", "Not Available", ""} else val


def _match(text: str, pattern: str) -> str | None:
    m = re.search(pattern, text)
    return m.group(1).strip() if m else None


def _count_from_label(label: str) -> int:
    m = re.search(r"\((\d+)\)", label)
    return int(m.group(1)) if m else 0


async def _set_page_size_max(page, events) -> None:
    """Items per Page is a mat-select. Choosing the largest value puts every
    proceeding on one page, which is far less fragile than paging."""
    try:
        trigger = page.locator(
            ".mat-mdc-paginator-page-size-select [role=combobox], "
            ".mat-mdc-paginator-page-size-select mat-select").first
        if not await trigger.count():
            return
        await trigger.click()
        await page.wait_for_timeout(700)
        options = page.get_by_role("option")
        sizes = []
        for k in range(await options.count()):
            label = (await options.nth(k).inner_text()).strip()
            if label.isdigit():
                sizes.append((int(label), label))
        if not sizes:
            await page.keyboard.press("Escape")
            return
        biggest = max(sizes)[1]
        await page.get_by_role("option", name=biggest, exact=True).first.click()
        await page.wait_for_timeout(2000)
        await events.log(f"  showing {biggest} per page")
    except Exception as e:                     # never fail a sync over paging
        await events.log(f"  could not change the page size ({e!r})")
        try:
            await page.keyboard.press("Escape")
        except Exception:
            pass


async def _next_page(page) -> bool:
    """The paginator arrows carry no accessible name, so class it is."""
    try:
        nxt = page.locator("button.mat-mdc-paginator-navigation-next").first
        if await nxt.count() and await nxt.is_enabled():
            await nxt.click()
            return True
    except Exception:
        pass
    return False
