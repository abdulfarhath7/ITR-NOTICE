"""e-Proceedings scraper. Read-only by design.

Walk order (from the recon screenshots):
  Pending Actions -> E-Proceedings
    for tab in [Self, Of Other PAN/TAN, As Authorized Representative*]:
      for sub_tab in [For your Action, For your Information]:
        for each proceeding card:  store metadata
          click "View Notices/Orders" -> for each notice card: store fields
            if notice not cached: click "Notice/Letter Pdf" -> detail page
                                  -> click Download -> save PDF -> back
  (* tab may be absent on some accounts - we skip what isn't there)

HARD GUARDRAIL: this module never clicks Submit Response, View Response,
File Appeal, Seek Video Conferencing, Seek/View Adjournment or any control
that writes to the portal. Only navigation, reads and PDF downloads.
"""
import re
from pathlib import Path

from playwright.async_api import TimeoutError as PWTimeout

from .. import db
from ..config import settings
from .session import PortalSession

EPROCEEDINGS_URL = (
    "https://eportal.incometax.gov.in/iec/foservices/#/dashboard/eProceedings"
)
TABS = {
    "self": "Self",
    "other_pan": "Of Other PAN/TAN",
    "auth_rep": "As Authorized Representative",
}
SUB_TABS = {"action": "For your Action", "information": "For your Information"}

FORBIDDEN = ("Submit Response", "File Appeal", "Seek Video Conferencing",
             "Seek/View Adjournment", "View Response")  # never clicked - see guardrail


async def run_sync(session: PortalSession, events) -> dict:
    page = session.page
    stats = {"proceedings": 0, "notices": 0, "downloaded": 0, "skipped_cached": 0}

    with db.connect() as con:
        for tab_key, tab_label in TABS.items():
            await session.ensure_alive()
            await page.goto(EPROCEEDINGS_URL, wait_until="domcontentloaded")
            tab = page.get_by_role("button", name=tab_label).or_(
                page.get_by_text(tab_label, exact=True))
            if not await tab.count():
                await events.log(f"Tab '{tab_label}' not on this account - skipped")
                continue
            await tab.first.click()

            for sub_key, sub_label in SUB_TABS.items():
                sub = page.get_by_text(re.compile(rf"{re.escape(sub_label)} \(\d+\)"))
                if not await sub.count():
                    continue
                count = _count_from_label(await sub.first.inner_text())
                await sub.first.click()
                await events.log(f"{tab_label} / {sub_label}: {count} item(s)")
                if count == 0:
                    continue

                await _set_items_per_page_max(page)
                cards = await _proceeding_cards(page)
                for card in cards:
                    p = await _parse_proceeding(card, tab_key, sub_key)
                    pid = db.upsert_proceeding(con, p)
                    stats["proceedings"] += 1
                    await _collect_notices(session, events, con, card, pid, stats)

    await events.log(
        f"Sync done: {stats['proceedings']} proceedings, "
        f"{stats['downloaded']} new PDFs, {stats['skipped_cached']} cached")
    return stats


# -------------------------------------------------------------- notice level
async def _collect_notices(session, events, con, card, proceeding_id, stats):
    page = session.page
    view = card.get_by_role("button", name=re.compile(r"View Notices/Orders"))
    if not await view.count():
        return
    await session.ensure_alive()
    await view.first.click()
    await page.wait_for_url(re.compile(r"viewNotices"), timeout=20000)

    for notice_card in await _notice_cards(page):
        n = await _parse_notice(notice_card, proceeding_id)
        stats["notices"] += 1

        if db.notice_exists(con, n["ref_id"]):
            stats["skipped_cached"] += 1          # cache rule: never re-scrape
            continue

        pdf_btn = notice_card.get_by_role(
            "button", name=re.compile(r"Notice/Letter Pdf", re.I))
        if await pdf_btn.count():
            n["pdf_path"] = await _download_from_detail(session, events,
                                                        pdf_btn.first, n["ref_id"])
            if n["pdf_path"]:
                stats["downloaded"] += 1
        db.upsert_notice(con, n)

    await page.go_back(wait_until="domcontentloaded")


async def _download_from_detail(session, events, pdf_btn, ref_id) -> str | None:
    """Notice card -> 'Notice/Letter Pdf' -> detail page -> Download -> save."""
    page = session.page
    await pdf_btn.click()
    try:
        await page.wait_for_url(re.compile(r"viewDetailedNotice"), timeout=20000)
        async with page.expect_download(timeout=30000) as dl:
            await page.get_by_role(
                "button", name=re.compile(r"Download", re.I)).first.click()
        download = await dl.value
        dest = Path(settings.notices_dir) / f"{ref_id}.pdf"
        dest.parent.mkdir(parents=True, exist_ok=True)
        await download.save_as(dest)
        await events.log(f"Downloaded {ref_id}.pdf")
        return str(dest)
    except PWTimeout:
        await events.log(f"Could not download PDF for {ref_id} - stored without file")
        return None
    finally:
        await page.go_back(wait_until="domcontentloaded")


# ------------------------------------------------------------------- parsing
# NOTE: the two parsers below are the only part still calibrated against
# screenshots instead of the live DOM. First real run happens with
# HEADLESS=false so we can watch and tighten them. Field labels come
# verbatim from the recon images.

async def _proceeding_cards(page):
    return await page.locator(
        "div", has_text=re.compile(r"Proceeding Name")).all()


async def _notice_cards(page):
    return await page.locator(
        "div", has_text=re.compile(r"Notice/ Communication Reference ID")).all()


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
    return {
        "proceeding_id": proceeding_id,
        "ref_id": _match(text, r"Reference ID\s*:?\s*(\d+)"),
        "notice_us": _after(text, "Notice u/s"),
        "doc_ref_id": _match(text, r"(ITBA/[\w/().-]+)"),
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


async def _set_items_per_page_max(page) -> None:
    try:
        sel = page.locator("select").last
        if await sel.count():
            await sel.select_option(index=-1)   # largest page size
    except Exception:
        pass
