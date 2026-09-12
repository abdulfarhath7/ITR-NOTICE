"""Anchored parsers for the e-Proceedings cards, written from the DOM
captures under data/debug/recon3 (never from screenshots).

Every field is read by anchoring on its label element and taking the value
element the portal places next to it. A field that could only be recovered
by a regex over the card's text carries confidence "low"; a field whose
anchor was found carries "high". The Rust core turns any "low" into
`verified_flag = 0`.

Card anatomy (proceeding, div.card-container.matCardRow):
  .card-header  span.body1 "Proceeding Name :" -> span.heading5
                span.body1 "Assessment Year :" -> span.heading5
  .card-body    span.body2.stepperStatus "PAN" -> div.heading6
                span.body2.stepperStatus "Name of Assessee" -> div.heading6
                span.body2.stepperStatus "Financial Year :" -> span.subtitle2
                span.body2.stepperStatus "Applicable Act :" -> span.subtitle2
                mat-vertical-stepper steps: .subtitle2 (date) + .body2 (status)
  buttons       "View Notices/Orders (n)"

Card anatomy (notice, div.card-container.matCard):
  .card-header  span.body1 "Notice/ Communication Reference ID :" > span.heading5
  .col-md-2     div.heading6 (value) above div.dataHeading "Notice u/s"
  .col-md-3     div.heading6 (value) above div.dataHeading "Document reference ID"
  .col-md-4     span.dataHeading "Description :" -> span.subtitle2
                "Issued On :", "Served On :", "Response Due Date :",
                "Last Response submitted On :", "Response viewed by AO on :"
  buttons       "Submit Response" | "View Response", "Notice/Letter pdf",
                "Seek/View Adjournment"
"""

import re
from typing import Any

# Runs inside the page against one card element. Returns
# {fields: {label -> value}, above: {label -> value}, steps: [[date, status]],
#  buttons: [text], text: innerText}
CARD_JS = r"""
(card) => {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').replace(/\s*:\s*$/, '').trim();
  const valueClasses = ['heading5', 'heading6', 'subtitle1', 'subtitle2'];
  const isValue = (el) => el && el.classList && valueClasses.some((c) => el.classList.contains(c));
  const fields = {};
  const above = {};
  const labels = card.querySelectorAll('.body1, .body2, .dataHeading');
  for (const lab of labels) {
    // own text only, so a nested value span does not become part of the label
    let own = '';
    for (const n of lab.childNodes) if (n.nodeType === 3) own += n.textContent;
    const key = norm(own);
    if (!key) continue;
    // 1. a value nested inside the label (the reference id header)
    const nested = Array.from(lab.children).find(isValue);
    if (nested) { fields[key] = norm(nested.textContent); continue; }
    // 2. the next value-class sibling, stepping over empty spacer spans
    let sib = lab.nextElementSibling, found = null;
    for (let i = 0; sib && i < 3 && !found; i++, sib = sib.nextElementSibling) {
      if (isValue(sib)) { found = sib; break; }
      const inner = Array.from(sib.querySelectorAll('*')).find(isValue);
      if (inner) { found = inner; break; }
      if (norm(sib.textContent)) break;   // a non-empty non-value sibling ends the search
    }
    if (found) { fields[key] = norm(found.textContent); continue; }
    // 3. the value sits above the label (Notice u/s, Document reference ID)
    const prev = lab.previousElementSibling;
    if (prev && isValue(prev)) { above[key] = norm(prev.textContent); continue; }
    fields[key] = '';
  }
  const steps = Array.from(card.querySelectorAll('.mat-step-text-label')).map((s) => {
    const d = s.querySelector('.subtitle2, .subtitle1');
    const st = s.querySelector('.body2, .stepperStatus');
    return [norm(d && d.textContent), norm(st && st.textContent)];
  });
  const buttons = Array.from(card.querySelectorAll('button')).map((b) => norm(b.textContent)).filter(Boolean);
  return { fields, above, steps, buttons, text: card.innerText || '' };
}
"""

PAN_RE = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
NOT_AVAILABLE = {"", "-", "Not Available", "NA", "N/A"}


def _clean(v: str | None) -> str | None:
    if v is None:
        return None
    v = v.strip()
    return None if v in NOT_AVAILABLE else v


def _after(text: str, label: str) -> str | None:
    m = re.search(rf"{re.escape(label)}\s*:?\s*\n?\s*([^\n]+)", text)
    if not m:
        return None
    return _clean(m.group(1))


def _pick(raw: dict[str, Any], conf: dict[str, str], key: str, label: str,
          fallback_label: str | None = None) -> str | None:
    """Anchored first; the text regex only as a fallback, and marked."""
    fields: dict[str, str] = raw.get("fields", {})
    if label in fields:
        conf[key] = "high"
        return _clean(fields[label])
    val = _after(raw.get("text", ""), fallback_label or label)
    conf[key] = "low" if val is not None else "missing"
    return val


def parse_proceeding(raw: dict[str, Any], tab: str, sub_tab: str) -> tuple[dict[str, Any], dict[str, str]]:
    conf: dict[str, str] = {}
    steps: list[list[str]] = raw.get("steps") or []
    status = None
    initiated_on = None
    closure_date = None
    if steps:
        conf["status"] = "high"
        # The stepper lists the proceeding's states in order with the date
        # each was reached; the last one is the current state.
        status = _clean(steps[-1][1]) if steps[-1] else None
        initiated_on = _clean(steps[0][0]) if steps[0] else None
        conf["initiated_on"] = "high" if initiated_on else "missing"
        if status and status.lower() == "closed":
            closure_date = _clean(steps[-1][0])
            conf["closure_date"] = "high" if closure_date else "missing"
    else:
        m = re.search(r"\b(Open|Closed|Submitted)\b", raw.get("text", ""))
        status = m.group(1) if m else None
        conf["status"] = "low" if status else "missing"
        conf["initiated_on"] = "missing"

    pan = _pick(raw, conf, "pan", "PAN")
    if pan and not PAN_RE.fullmatch(pan):
        m = PAN_RE.search(raw.get("text", ""))
        pan = m.group(0) if m else None
        conf["pan"] = "low" if pan else "missing"

    card = {
        "tab": tab,
        "sub_tab": sub_tab,
        "proceeding_name": _pick(raw, conf, "proceeding_name", "Proceeding Name"),
        "pan": pan,
        "assessee_name": _pick(raw, conf, "assessee_name", "Name of Assessee"),
        "assessment_year": _pick(raw, conf, "assessment_year", "Assessment Year"),
        "financial_year": _pick(raw, conf, "financial_year", "Financial Year"),
        "applicable_act": _pick(raw, conf, "applicable_act", "Applicable Act"),
        "status": status,
        "initiated_on": initiated_on,
        "closure_date": closure_date or _pick(raw, conf, "closure_date_text", "Proceeding Closure Date"),
        "closure_order": _pick(raw, conf, "closure_order", "Proceeding Closure Order"),
        "notice_count": _count_from(raw.get("buttons", []), "View Notices/Orders"),
    }
    return card, conf


def _count_from(buttons: list[str], prefix: str) -> int | None:
    for b in buttons:
        if b.startswith(prefix):
            m = re.search(r"\((\d+)\)", b)
            return int(m.group(1)) if m else None
    return None


def parse_notice(raw: dict[str, Any]) -> tuple[dict[str, Any], dict[str, str]]:
    conf: dict[str, str] = {}
    fields: dict[str, str] = raw.get("fields", {})
    above: dict[str, str] = raw.get("above", {})
    text: str = raw.get("text", "")

    ref = _clean(fields.get("Notice/ Communication Reference ID") or fields.get("Notice/Communication Reference ID"))
    if ref:
        conf["reference_id"] = "high"
    else:
        m = re.search(r"Reference ID\s*:?\s*(\d+)", text)
        ref = m.group(1) if m else None
        conf["reference_id"] = "low" if ref else "missing"

    section = _clean(above.get("Notice u/s"))
    conf["section"] = "high" if section else "missing"
    din = _clean(above.get("Document reference ID"))
    if din:
        conf["din"] = "high"
    else:
        m = re.search(r"(ITBA/[\w/().-]+)", text)
        din = m.group(1) if m else None
        conf["din"] = "low" if din else "missing"

    buttons = [b.lower() for b in raw.get("buttons", [])]
    responded: int | None
    if any("view response" in b for b in buttons):
        responded = 1
    elif any("submit response" in b for b in buttons):
        responded = 0
    else:
        responded = None
    conf["responded"] = "high" if responded is not None else "missing"

    notice = {
        "reference_id": ref,
        "section": section,
        "din": din,
        "description": _pick(raw, conf, "description", "Description"),
        "issued_on": _pick(raw, conf, "issued_on", "Issued On"),
        "served_on": _pick(raw, conf, "served_on", "Served On"),
        "response_due_date": _pick(raw, conf, "response_due_date", "Response Due Date"),
        "last_response_on": _pick(raw, conf, "last_response_on", "Last Response submitted On"),
        "ao_viewed_on": _pick(raw, conf, "ao_viewed_on", "Response viewed by AO on"),
        "responded": responded,
        "has_pdf_button": any("pdf" in b for b in buttons),
        "has_adjournment_button": any("adjournment" in b for b in buttons),
    }
    return notice, conf
