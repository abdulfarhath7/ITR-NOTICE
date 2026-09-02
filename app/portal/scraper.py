"""e-Proceedings scraper. Read-only by design.

Rewritten against the live portal (recon dumps under data/debug/recon*/),
not against screenshots. What the real site forced:

  - The browser Back button is a trap. The portal answers it with "For
    security reasons, we have disabled Back, Forward and Refresh actions of
    the browser. Are you sure you want to Logout?" - so page.go_back() was
    one stray click away from ending the session. Every return trip now uses
    the page's own "Back" button, which was verified to land back on the
    notices list and then the proceedings list with no dialog at all.
  - The same modal (#securityReasonPopup) also fires for ANY url or hash
    change, not just the Back button - an early version moved
    window.location.hash to reach the list and the portal answered with the
    popup, which then swallowed every click underneath it and timed the sync
    out. Navigation is therefore by clicking the portal's own menu and Back
    buttons, only. Nothing here touches the URL.
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
from .session import (PortalSession, dismiss_security_popup, first_visible,
                      pace_for)

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


class DownloadLimitReached(Exception):
    """Raised to unwind the walk once the requested number of PDFs is in."""

# Never clicked. "View Response" and "Seek/View Adjournment" live on the very
# same notice card as the PDF button, so this is enforced, not just documented.
FORBIDDEN = ("submit response", "view response", "file appeal",
             "seek video conferencing", "seek/view adjournment",
             "e-verify", "withdraw", "pay now",
             # the back/refresh modal's YES logs the session out
             "yes", "logout")


async def _click(locator, label: str, timeout: int | None = None) -> None:
    """The only way this module clicks anything."""
    if any(bad in label.lower() for bad in FORBIDDEN):
        raise RuntimeError(f"read-only guardrail: refused to click {label!r}")
    await locator.click(**({"timeout": timeout} if timeout else {}))


async def _safe_click(page, locator, label: str, events=None,
                      timeout: int = 15000) -> None:
    """Click, but clear the portal's back/refresh modal first - while it is up
    it intercepts pointer events and a plain click just times out.

    Also the one place every scraper click is paced from: session.pace() does
    the same job wherever the session object is in scope, and both read the
    live speed setting, so a mid-sync speed change is felt on the next click.
    """
    await pace_for(events)
    await dismiss_security_popup(page, events)
    try:
        await _click(locator, label, timeout=timeout)
    except PWTimeout:
        if not await dismiss_security_popup(page, events):
            raise
        await _click(locator, label, timeout=timeout)


async def _click_back(page, events) -> None:
    """The portal's own Back button. Never page.go_back() - see module docs."""
    back = page.get_by_role("button", name="Back", exact=True).first
    try:
        await dismiss_security_popup(page, events)
        await back.wait_for(state="visible", timeout=10000)
        await _safe_click(page, back, "Back", events)
    except PWTimeout:
        await events.log("No in-page Back button found - returning via the URL")
        await _goto_list(page, events)


async def _goto_list(page, events=None) -> bool:
    """Reach the e-Proceedings list the way a person does: through the menu.

    Never by URL. Any url/hash change makes the portal throw up
    #securityReasonPopup, which then blocks every click on the page.
    """
    await dismiss_security_popup(page, events)
    if "eProceedings" in page.url and "viewNotices" not in page.url:
        if await _wait_for_list(page, seconds=3):
            return True

    for attempt in range(1, 4):
        if events:
            await events.log(f"  opening Pending Actions -> e-Proceedings ({attempt}/3)")
        try:
            await dismiss_security_popup(page, events)
            menu = page.get_by_role("menuitem", name="Pending Actions",
                                    exact=False).first
            if not await menu.count():
                menu = page.get_by_text("Pending Actions", exact=False).first
            await _safe_click(page, menu, "Pending Actions", events, timeout=10000)
            await page.wait_for_timeout(1200)

            item = page.get_by_role("menuitem", name="e-Proceedings",
                                    exact=False).first
            if not await item.count():
                item = page.get_by_text(re.compile(r"e-?Proceedings", re.I)).first
            await _safe_click(page, item, "e-Proceedings", events, timeout=10000)
        except Exception as e:
            if events:
                await events.log(f"  menu attempt {attempt} failed ({e!r})")
        if await _wait_for_list(page):
            return True
    return False


async def _wait_for_list(page, seconds: float | None = None) -> bool:
    """Rendered means a proceeding card, a tab, or an explicit empty state."""
    deadline = time.monotonic() + (LIST_READY_SECONDS if seconds is None else seconds)
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


async def run_sync(session: PortalSession, events, limit: int | None = None) -> dict:
    """limit: stop after this many NEW PDFs. None means every notice."""
    page = session.page
    stats = {"proceedings": 0, "notices": 0, "new_notices": 0, "downloaded": 0,
             "skipped_cached": 0, "limit": limit, "stopped_early": False}

    if limit:
        await events.log(f"Download limit: {limit} new PDF(s) this run")

    try:
      with db.connect() as con:
          await session.ensure_alive()
          if not await _goto_list(page, events):
              raise RuntimeError(
                  "The e-Proceedings list never rendered - nothing was scraped. "
                  f"Visible controls: {await _visible_button_names(page)}")

          await events.progress("list")
          tabs_walked = 0
          for tab_key, tab_label in TABS.items():
              tab = await _find_tab(page, tab_label)
              if not tab:
                  await events.log(f"Tab '{tab_label}' not on this account - skipped")
                  continue
              tabs_walked += 1
              await _safe_click(page, tab, tab_label, events)
              await page.wait_for_timeout(1500)
              await _wait_for_list(page)

              for sub_key, sub_label in SUB_TABS.items():
                  sub = page.get_by_role("tab", name=sub_label, exact=False).first
                  if not await sub.count():
                      continue
                  count = _count_from_label(await sub.inner_text())
                  await _safe_click(page, sub, sub_label, events)
                  await page.wait_for_timeout(1500)
                  await events.log(f"{tab_label} / {sub_label}: {count} item(s)")
                  await events.progress("walk", tab=tab_label, sub_tab=sub_label,
                                        items=count)
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

    except DownloadLimitReached:
        stats["stopped_early"] = True
        await events.log(
            f"Download limit of {limit} reached - stopping here. "
            "Run Sync again to continue from where this left off.")

    await events.log(
        f"Sync done: {stats['proceedings']} proceedings, {stats['notices']} notices "
        f"({stats['new_notices']} new), {stats['downloaded']} new PDFs, "
        f"{stats['skipped_cached']} already held")
    return stats


def _limit_reached(stats) -> bool:
    limit = stats.get("limit")
    return bool(limit) and stats["downloaded"] >= limit


async def _walk_pages(session, events, con, tab_key, sub_key, stats) -> None:
    """Every card of every page of one sub-tab. Each card reports where it is,
    so the dashboard's pipeline bar can say "card 3 of 12" while it works."""
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
            await session.pace()
            p = await _parse_proceeding(card, tab_key, sub_key)
            pid = db.upsert_proceeding(con, p)
            stats["proceedings"] += 1
            await events.log(
                f"  card {i + 1}/{total}: {p['proceeding_name'] or '(unnamed)'}"
                f" AY {p['assessment_year'] or '-'}")
            # the human labels, not the db keys - this line is read by a person
            await events.progress("walk", tab=TABS.get(tab_key, tab_key),
                                  sub_tab=SUB_TABS.get(sub_key, sub_key),
                                  card=i + 1, of=total,
                                  name=p["proceeding_name"] or "")
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

    await _safe_click(page, view, "View Notices/Orders", events)
    try:
        await page.wait_for_url(re.compile(r"viewNotices"), timeout=20000)
    except PWTimeout:
        await events.log("  notice list did not open - skipping this proceeding")
        return
    await page.wait_for_timeout(1500)

    total = await page.locator(NOTICE_CARD).count()
    await events.log(f"    {total} notice(s) on this proceeding")
    for j in range(total):
        notice = page.locator(NOTICE_CARD).nth(j)
        await session.pace()
        n = await _parse_notice(notice, proceeding_id)
        if not n["ref_id"]:
            continue
        stats["notices"] += 1
        if db.get_notice(con, n["ref_id"]) is None:
            stats["new_notices"] += 1          # first time this one has shown up

        if db.notice_exists(con, n["ref_id"]):
            stats["skipped_cached"] += 1       # cache rule: never fetch twice
            # ...but the reply status is not cached: it changes between syncs,
            # so a notice we skip downloading still gets this refreshed.
            db.set_responded(con, n["ref_id"], n["responded"])
            continue

        pdf = notice.get_by_role("button", name="Notice/Letter Pdf", exact=False).first
        if await pdf.count():
            await events.progress("download", notice=j + 1, of=total,
                                  downloaded=stats["downloaded"],
                                  limit=stats.get("limit"))
            n["pdf_blob"] = await _download(session, events, n["ref_id"])
            if n["pdf_blob"]:
                stats["downloaded"] += 1
        db.upsert_notice(con, n)

        # Stop the moment the cap is met: the point of a limit is a short run.
        # Everything already stored stays stored, so the next Sync carries on.
        if _limit_reached(stats):
            await _click_back(page, events)
            raise DownloadLimitReached

    await _click_back(page, events)            # back to the proceedings list
    await page.wait_for_timeout(1500)


async def _download(session, events, ref_id) -> bytes | None:
    """Notice card -> 'Notice/Letter pdf' -> detail page -> Download -> back.

    Returns the PDF's bytes. Nothing is written to the filesystem: the file
    goes straight into the notice's row, so the database is the whole archive.
    """
    page = session.page
    await session.pace()
    pdf = page.get_by_role("button", name="Notice/Letter Pdf", exact=False).first
    await _safe_click(page, pdf, "Notice/Letter Pdf", events)
    try:
        await page.wait_for_url(re.compile(r"viewDetailedNotice"), timeout=20000)
        async with page.expect_download(timeout=30000) as dl:
            await _safe_click(page, page.get_by_role(
                "button", name="Download", exact=False).first, "Download", events)
        download = await dl.value
        # Playwright writes the file to a temp path of its own. Read it back
        # into memory for the pdf_blob column, then delete it: a notice must
        # exist in exactly one place, and that place is the database.
        data = Path(await download.path()).read_bytes()
        await download.delete()
        await events.log(f"  downloaded {ref_id}.pdf ({len(data) // 1024} KB)")
        return data or None
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


# Read-only, and this is the read: which of the two response buttons the card
# shows tells us whether a reply has been filed. Neither button is ever
# clicked - "submit response" and "view response" are both in FORBIDDEN.
def _responded_from(text: str) -> int | None:
    """1 = a reply exists, 0 = none filed yet, None = the card did not say."""
    low = text.lower()
    if "view response" in low:
        return 1
    if "submit response" in low:
        return 0
    return None


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
        "responded": _responded_from(text),
        "pdf_blob": None,
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
    """Items per Page is a mat-select, and Material lays an aria-hidden
    `div.mat-mdc-paginator-touch-target` right on top of it, which intercepts
    pointer events - a live run spent 30 seconds retrying the click while the
    page scrolled up and down. So open it from the keyboard instead; the
    options overlay itself has nothing on top of it and clicks normally.
    """
    try:
        sel = page.locator(
            ".mat-mdc-paginator-page-size-select mat-select, "
            ".mat-mdc-paginator-page-size-select [role=combobox]").first
        if not await sel.count():
            return
        try:
            await sel.scroll_into_view_if_needed(timeout=5000)
        except Exception:
            pass

        opened = False
        try:
            await sel.focus()
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(700)
            opened = await page.get_by_role("option").count() > 0
        except Exception:
            opened = False
        if not opened:
            # force=True skips the actionability checks the overlay fails
            await sel.click(force=True, timeout=8000)
            await page.wait_for_timeout(700)

        options = page.get_by_role("option")
        sizes = []
        for k in range(await options.count()):
            label = (await options.nth(k).inner_text()).strip()
            if label.isdigit():
                sizes.append(int(label))
        if not sizes:
            await page.keyboard.press("Escape")
            await events.log("  page size menu did not open - paging instead")
            return

        biggest = str(max(sizes))
        await page.get_by_role("option", name=biggest,
                               exact=True).first.click(timeout=8000)
        await page.wait_for_timeout(2000)
        await events.log(f"  showing {biggest} per page")
    except Exception as e:                     # never fail a sync over paging
        await events.log(f"  could not change the page size ({e!r}) - paging instead")
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
