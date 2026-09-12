"""Modules 2, 3 and 4: outstanding demands, filed returns, filed forms.

No DOM capture of these pages exists in the repository yet, and docs/05
forbids writing a parser from a screenshot. What is here is the navigation
(by menu text, the same way the e-Proceedings walk reaches its list) and a
label-anchored extraction that maps whichever labels the portal renders
onto the card fields. A label that is not found is a gap; nothing is
guessed. Every header from these walks is marked confidence "low" until a
scrubbed capture lands under sidecar/tests/fixtures/ and the mapping is
pinned by a test.

TODO(blocked): capture outerHTML + HAR of the three list pages from a live
session, scrub, commit, and tighten the label tables below. See NOTES.md.
"""
import base64
import re
from pathlib import Path
from typing import Any

from app.portal.scraper import (
    _discard,
    _next_page,
    _safe_click,
    _set_page_size_max,
    _visible_button_names,
)
from app.portal.session import dismiss_security_popup, first_visible
from playwright.async_api import TimeoutError as PWTimeout

from .parse import CARD_JS, _clean
from .protocol import emit, log
from .session import IngestSession, Relay

# Menu traversal, top level then sub-item, matched case-insensitively.
MENU: dict[str, list[list[str]]] = {
    "demands": [["Pending Actions"], ["Response to Outstanding Demand", "Outstanding Demand"]],
    "returns": [["e-File"], ["Income Tax Returns"], ["View Filed Returns"]],
    "forms": [["e-File"], ["Income Tax Forms"], ["View Filed Forms"]],
}

# Portal label -> card field. Several spellings per field; first match wins.
LABELS: dict[str, dict[str, list[str]]] = {
    "demands": {
        "demand_reference_number": ["Demand Reference No", "Demand Reference Number", "DIN", "Demand Identification Number"],
        "assessment_year": ["Assessment Year", "A.Y."],
        "section_or_demand_type": ["Section Code", "Section", "Demand Type", "Type of Demand"],
        "raised_on": ["Date on which demand is raised", "Date of Demand", "Demand raised on", "Raised On"],
        "demand_amount": ["Demand Amount", "Original Demand Amount", "Amount of Demand"],
        "current_outstanding": ["Outstanding Demand Amount", "Outstanding Amount", "Current Outstanding"],
        "uploaded_by": ["Uploaded By", "Demand raised by"],
        "rectification_rights": ["Rectification Rights", "Rectification Rights with"],
        "status": ["Status", "Response Status", "Demand Status"],
        "pan": ["PAN"],
    },
    "returns": {
        "acknowledgement_number": ["Acknowledgement Number", "Acknowledgment Number", "Ack No", "Acknowledgement No"],
        "assessment_year": ["Assessment Year", "A.Y."],
        "return_type": ["ITR Form", "Form", "Return Type", "ITR Type"],
        "filing_type": ["Filing Type", "Type of Filing", "Filing Section"],
        "filed_on": ["Date of Filing", "Filed On", "Filing Date", "Date of filing"],
        "verification_status": ["e-Verification Status", "Verification Status", "Verified"],
        "processing_status": ["Current Status", "Processing Status", "Status"],
        "pan": ["PAN"],
    },
    "forms": {
        "form_label": ["Form Name", "Form", "Form No", "Form Type"],
        "acknowledgement_number": ["Acknowledgement Number", "Acknowledgment Number", "Ack No", "Acknowledgement No"],
        "assessment_year": ["Assessment Year", "A.Y.", "Financial Year"],
        "filed_on": ["Date of Filing", "Filed On", "Filing Date", "Date of filing"],
        "filing_type": ["Filing Type", "Type of Filing"],
        "status": ["Status", "Form Status"],
        "filed_by": ["Filed By", "Submitted By", "Filed by"],
        "pan": ["PAN"],
    },
}

CARD_SELECTORS = "div.card-container, mat-card, .card"


def map_fields(module: str, raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    """Anchored label lookup, case-insensitive, colon-insensitive."""
    fields: dict[str, str] = {}
    for k, v in raw.get("fields", {}).items():
        fields[k.strip().rstrip(":").strip().lower()] = v
    for k, v in raw.get("above", {}).items():
        fields.setdefault(k.strip().rstrip(":").strip().lower(), v)
    out: dict[str, Any] = {}
    conf: dict[str, str] = {}
    for field, labels in LABELS[module].items():
        val = None
        for label in labels:
            hit = fields.get(label.lower())
            if hit is not None:
                val = _clean(hit)
                break
        out[field] = val
        # Unverified pages: even an anchored hit is reported as low until a
        # fixture pins the label table (docs/05 confidence flag).
        conf[field] = "low" if val is not None else "missing"
    buttons = [b.lower() for b in raw.get("buttons", [])]
    out["has_pdf_button"] = any("download" in b or "pdf" in b or "receipt" in b for b in buttons)
    out["_buttons"] = raw.get("buttons", [])
    return out, conf


async def _open_module(session: IngestSession, relay: Relay, module: str) -> bool:
    page = session.page
    assert page is not None
    for attempt in range(1, 4):
        log(f"  opening {' -> '.join(step[0] for step in MENU[module])} ({attempt}/3)")
        try:
            await dismiss_security_popup(page, relay)
            for step in MENU[module]:
                item = None
                for label in step:
                    cand = page.get_by_role("menuitem", name=label, exact=False).first
                    if await cand.count():
                        item = cand
                        break
                    cand = page.get_by_text(re.compile(re.escape(label), re.I)).first
                    if await first_visible(cand):
                        item = cand
                        break
                if item is None:
                    raise RuntimeError(f"menu item {step[0]!r} not found")
                await _safe_click(page, item, step[0], relay, timeout=10000)
                await page.wait_for_timeout(1200)
            await page.wait_for_timeout(2000)
            if await page.locator(CARD_SELECTORS).count() or await first_visible(page.get_by_text(re.compile(r"no records|no data", re.I))):
                return True
        except Exception as e:  # noqa: BLE001 - logged, then retried
            log(f"  menu attempt {attempt} failed ({e!r})", "warn")
    log(f"  could not reach the {module} list; visible controls: {await _visible_button_names(page)}", "error")
    return False


async def _download_within(session: IngestSession, relay: Relay, card: Any, label_re: str) -> str | None:
    """Click a download control inside the card and return the bytes as
    base64, or None. The control's own label decides the file's meaning."""
    page = session.page
    assert page is not None
    btn = card.get_by_role("button", name=re.compile(label_re, re.I)).first
    if not await btn.count():
        link = card.get_by_role("link", name=re.compile(label_re, re.I)).first
        if not await link.count():
            return None
        btn = link
    try:
        async with page.expect_download(timeout=30000) as dl:
            await _safe_click(page, btn, "Download", relay)
        download = await dl.value
        try:
            data = Path(await download.path()).read_bytes()
        finally:
            await _discard(download)
        return base64.standard_b64encode(data).decode("ascii") if data else None
    except PWTimeout:
        log("  the portal did not hand over a file", "warn")
        return None


async def list_module(session: IngestSession, relay: Relay, module: str) -> None:
    page = session.page
    if page is None:
        raise RuntimeError("browser not started")
    stats = {"cards": 0, "notices": 0, "fetched": 0, "skipped": 0}
    stopped = False
    note: str | None = None

    await session.ensure_alive()
    if not await _open_module(session, relay, module):
        note = f"the {module} list never rendered"
        emit("panel_missing", panel=module, msg=note)
        emit("panel_done", panel=module, cards=0, notices=0, fetched=0, skipped=0, stopped_early=False, note=note)
        return

    await _set_page_size_max(page, relay)
    seen_pages = 0
    while seen_pages < 50 and not stopped:
        cards = page.locator(CARD_SELECTORS)
        total = await cards.count()
        log(f"  {module}: page {seen_pages + 1}: {total} card(s)")
        if total == 0:
            break
        for i in range(total):
            await session.ensure_alive()
            card = page.locator(CARD_SELECTORS).nth(i)
            if not await card.count():
                break
            await session.pace()
            raw: dict[str, Any] = await card.evaluate(CARD_JS)
            fields, conf = map_fields(module, raw)
            buttons = fields.pop("_buttons", [])
            key = fields.get("acknowledgement_number") or fields.get("demand_reference_number")
            if not key:
                # A card without its identifier is not a record we can keep.
                continue
            stats["cards"] += 1
            emit("progress", kind="walk", panel=module, card=i + 1, of=total, name=str(key))
            emit("header", panel=module, proceeding=fields, notice=None,
                 confidence={"proceeding": conf, "notice": {}})
            action = await relay.request_verdict()
            if action == "stop":
                stopped = True
                break
            if action != "fetch":
                stats["skipped"] += 1
                continue
            pdf = await _download_within(session, relay, card, r"download.*(form|return|itr)|^download$|pdf")
            receipt = await _download_within(session, relay, card, r"receipt|acknowledg")
            if pdf or receipt:
                stats["fetched"] += 1
            emit("item", reference_id=str(key), pdf_b64=pdf, receipt_b64=receipt,
                 filename=f"{key}.pdf", note=None if (pdf or receipt) else f"no file offered; controls: {buttons}")
        if stopped or not await _next_page(page):
            break
        seen_pages += 1
        await page.wait_for_timeout(1500)

    emit("panel_done", panel=module, cards=stats["cards"], notices=0, fetched=stats["fetched"],
         skipped=stats["skipped"], stopped_early=stopped, note=note)
