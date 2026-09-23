"""Modules 2, 3 and 4: outstanding demands, filed returns, filed forms.

Returns and forms are read against live captures taken 2026-09-23 with
sidecar/recon (data/portal-map/, gitignored): see MODULE_CARD_JS and the
forms walk below. Headers stay confidence "low" until a scrubbed fixture
pins the label tables with a test (docs/05).

Demands are still unverified: the account captured had no outstanding
demand, so the demand list's card markup has never been seen. The label
table below is the old guess.

TODO(blocked): capture Response to Outstanding Demand on a client that has
a demand (recon --path "Pending Actions > Response to Outstanding Demand").
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

from .parse import _clean
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
        "return_type": ["ITR", "ITR Form", "Form", "Return Type", "ITR Type"],
        "filing_type": ["Filing Type", "Type of Filing"],
        "filing_section": ["Filing Section", "Filed u/s", "Section"],
        "filed_by": ["Filed By"],
        "filed_on": ["Filing Date", "Date of Filing", "Filed On", "Date of filing"],
        "verification_status": ["e-Verification Status", "Verification Status", "Verified"],
        "processing_status": ["Current Status", "Processing Status", "Status"],
        "pan": ["PAN"],
    },
    "forms": {
        "form_label": ["Form Name", "Form", "Form No", "Form Type"],
        "acknowledgement_number": ["Acknowledgement Number", "Acknowledgment Number", "Ack No", "Acknowledgement No"],
        "assessment_year": ["Assessment Year", "A.Y.", "Tax Year", "Financial Year"],
        "filed_on": ["Filing Date", "Date of Filing", "Filed On", "Date of filing"],
        "filing_type": ["Filing Type", "Type of Filing"],
        "status": ["Status", "Form Status"],
        "filed_by": ["Filed By", "Submitted By", "Filed by"],
        "pan": ["PAN"],
    },
}

CARD_SELECTORS = "div.card-container, mat-card, .card"

# The module list pages do not use the e-Proceedings card classes that
# CARD_JS reads (.body1 label -> .heading5 value). Captured live on
# 2026-09-23 (View Filed Returns, /dashboard/itrStatus): labels are
# mat-label.rightsideLabel / .contentLabel, values mat-label.fieldVal /
# .leftSideVal, and a value is not always the label's sibling ("Filing Type"
# sits in a wrapper div). So labels and values are paired in document order:
# each label takes the first value that follows it before the next label.
# The e-Proceedings classes are kept in the lists so either layout reads.
MODULE_CARD_JS = r"""
(card) => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();
  // View Filed Forms > View All (mat-card.subCard) uses thirdColKey /
  // thirdColValue, and draws the filing date value above its leftColKey label.
  const LABEL = ['rightsideLabel', 'contentLabel', 'thirdColKey', 'body1', 'body2', 'dataHeading'];
  const VALUE = ['fieldVal', 'leftSideVal', 'thirdColValue', 'heading5', 'heading6', 'subtitle1', 'subtitle2'];
  const has = (el, list) => list.some((c) => el.classList.contains(c));
  const sel = [...LABEL, ...VALUE].map((c) => '.' + c).join(',');
  // modal templates live inside the card; their text is not card data
  const inModal = (el) => !!el.closest('.modal, [role=dialog], mat-dialog-container');
  const fields = {};
  let pending = null;
  for (const el of card.querySelectorAll(sel)) {
    if (inModal(el)) continue;
    if (has(el, VALUE) && pending !== null) {
      if (!(pending in fields)) fields[pending] = norm(el.textContent);
      pending = null;
    } else if (has(el, LABEL)) {
      let own = '';
      for (const n of el.childNodes) if (n.nodeType === 3) own += n.textContent;
      pending = norm(own) || null;
    }
  }
  for (const key of card.querySelectorAll('.leftColKey')) {
    // value, <br>, label inside one wrapper div
    const val = key.parentElement && key.parentElement.querySelector('.leftColVal');
    const k = norm(key.textContent);
    if (k && val && !(k in fields)) fields[k] = norm(val.textContent);
  }
  // the acknowledgement number on a filed-form card is two bare spans
  const ack = (card.innerText || '').match(/Acknowledge?ment No\.?\s*:?\s*(\d{10,20})/i);
  if (ack && !('Acknowledgement No' in fields)) fields['Acknowledgement No'] = ack[1];
  // "A.Y. 2025-26" is the card title, not a label/value pair
  const head = card.querySelector('.contentHeadingText, mat-card-title');
  if (head) {
    const m = norm(head.textContent).match(/^(A\.?Y\.?|F\.?Y\.?|T\.?Y\.?)\s*(\d{4}-\d{2,4})/i);
    if (m) fields['A.Y.'] = m[2];
  }
  // status timeline, newest first as the portal draws it
  const steps = Array.from(card.querySelectorAll('.matStepStatus')).map((s) => {
    const d = s.parentElement && s.parentElement.querySelector('.matStepDate');
    return [norm(d && d.textContent), norm(s.textContent)];
  });
  const buttons = Array.from(card.querySelectorAll('button, .hyperLink'))
    .filter((b) => !inModal(b)).map((b) => norm(b.textContent)).filter(Boolean);
  return { fields, above: {}, steps, buttons, text: card.innerText || '' };
}
"""


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


class _Walk:
    """Counters and the stop flag shared by every list a module walks."""

    def __init__(self) -> None:
        self.cards = 0
        self.fetched = 0
        self.skipped = 0
        self.stopped = False


async def _walk_cards(session: IngestSession, relay: Relay, module: str, selector: str,
                      walk: _Walk, extra: dict[str, str] | None = None) -> None:
    """Every card matching `selector` on the current page, all pages."""
    page = session.page
    assert page is not None
    await _set_page_size_max(page, relay)
    seen_pages = 0
    while seen_pages < 50 and not walk.stopped:
        total = await page.locator(selector).count()
        log(f"  {module}: page {seen_pages + 1}: {total} card(s)")
        if total == 0:
            break
        for i in range(total):
            await session.ensure_alive()
            card = page.locator(selector).nth(i)
            if not await card.count():
                break
            await session.pace()
            raw: dict[str, Any] = await card.evaluate(MODULE_CARD_JS)
            if extra:
                raw.setdefault("fields", {}).update({k: v for k, v in extra.items() if v})
            fields, conf = map_fields(module, raw)
            if module == "returns" and fields.get("processing_status") is None and raw.get("steps"):
                # the newest timeline entry is the portal's own current status
                fields["processing_status"] = _clean(raw["steps"][0][1])
                conf["processing_status"] = "low"
            buttons = fields.pop("_buttons", [])
            key = fields.get("acknowledgement_number") or fields.get("demand_reference_number")
            if not key:
                # A card without its identifier is not a record we can keep.
                log(f"  {module}: card {i + 1} has no identifier; labels seen: {sorted(raw.get('fields', {}))}", "warn")
                continue
            walk.cards += 1
            emit("progress", kind="walk", panel=module, card=i + 1, of=total, name=str(key))
            emit("header", panel=module, proceeding=fields, notice=None,
                 confidence={"proceeding": conf, "notice": {}})
            action = await relay.request_verdict()
            if action == "stop":
                walk.stopped = True
                break
            if action != "fetch":
                walk.skipped += 1
                continue
            # Exact labels: filed-form cards also carry Withdraw, which the
            # click guard refuses anyway, and these never match it.
            pdf = await _download_within(session, relay, card, r"^download (form|return|itr)$|^download$|pdf")
            receipt = await _download_within(session, relay, card, r"receipt|acknowledg")
            if pdf or receipt:
                walk.fetched += 1
            emit("item", reference_id=str(key), pdf_b64=pdf, receipt_b64=receipt,
                 filename=f"{key}.pdf", note=None if (pdf or receipt) else f"no file offered; controls: {buttons}")
        if walk.stopped or not await _next_page(page):
            break
        seen_pages += 1
        await page.wait_for_timeout(1500)


# View Filed Forms is two levels (seen live 2026-09-23): one summary card per
# form type (mat-card.eachMatCardStyle, nested in one outer card, with
# .headFormNameStyle "Form No. 15CA" and "View All"), and behind View
# All the individual filings as mat-card.subCard. The summary cards are not
# filings and carry no acknowledgement number.
FORM_SUMMARY = "mat-card.eachMatCardStyle"
FORM_FILING = "mat-card.subCard"


async def _back_to_form_summary(session: IngestSession, relay: Relay) -> bool:
    page = session.page
    assert page is not None
    for name in ("Back", "Go back to View Filed Forms"):
        btn = await first_visible(page.get_by_role("button", name=name, exact=True))
        if btn:
            await _safe_click(page, btn, name, relay)
            try:
                await page.locator(FORM_SUMMARY).first.wait_for(state="visible", timeout=15000)
                return True
            except PWTimeout:
                break
    return await _open_module(session, relay, "forms")


async def _walk_forms(session: IngestSession, relay: Relay, walk: _Walk) -> None:
    page = session.page
    assert page is not None
    kinds = await page.locator(FORM_SUMMARY).count()
    log(f"  forms: {kinds} form type(s) filed")
    for i in range(kinds):
        if walk.stopped:
            break
        summary = page.locator(FORM_SUMMARY).nth(i)
        label = _clean(await summary.locator(".headFormNameStyle").first.inner_text()) or ""
        view_all = summary.locator(".hyperLink", has_text=re.compile(r"^\s*View All\s*$", re.I)).first
        if not await view_all.count():
            log(f"  forms: {label or 'a form type'} has no View All", "warn")
            continue
        await _safe_click(page, view_all, "View All", relay)
        try:
            await page.locator(FORM_FILING).first.wait_for(state="visible", timeout=20000)
        except PWTimeout:
            log(f"  forms: no filings rendered for {label or 'a form type'}", "warn")
        else:
            await _walk_cards(session, relay, "forms", FORM_FILING, walk, {"Form Name": label})
        if not await _back_to_form_summary(session, relay):
            log("  forms: could not get back to the form list; stopping the forms walk", "error")
            break


async def list_module(session: IngestSession, relay: Relay, module: str) -> None:
    page = session.page
    if page is None:
        raise RuntimeError("browser not started")
    walk = _Walk()
    note: str | None = None

    await session.ensure_alive()
    if not await _open_module(session, relay, module):
        note = f"the {module} list never rendered"
        emit("panel_missing", panel=module, msg=note)
        emit("panel_done", panel=module, cards=0, notices=0, fetched=0, skipped=0, stopped_early=False, note=note)
        return

    if module == "forms":
        await _walk_forms(session, relay, walk)
    else:
        await _walk_cards(session, relay, module, CARD_SELECTORS, walk)

    emit("panel_done", panel=module, cards=walk.cards, notices=0, fetched=walk.fetched,
         skipped=walk.skipped, stopped_early=walk.stopped, note=note)
