"""The two Claude API calls this tool makes, both reading a stored notice PDF:

  1. due_date_from_pdf()  - what is the response due date, or None if unstated
  2. draft_from_pdf()     - what the notice demands, what documents it wants,
                            and a draft reply for the owner to edit

Both send the PDF as a document block and constrain the answer to a JSON
schema, so the caller gets a dict rather than prose to parse.

Nothing here ever writes to the portal. The draft is a draft.
"""
import base64
import json

import anthropic

from .config import settings

# The owner's choice (CLAUDE.md roadmap). Exact id, no date suffix.
MODEL = "claude-sonnet-4-6"

# The API caps a request at 32MB; a notice PDF is a few hundred KB.
MAX_PDF_BYTES = 25 * 1024 * 1024


class ClaudeUnavailable(RuntimeError):
    """No API key, or the PDF cannot be sent. Shown to the owner as-is."""


DUE_DATE_SCHEMA = {
    "type": "object",
    "properties": {
        "due_date": {
            "type": ["string", "null"],
            "description": "The response due date as DD-MMM-YYYY, e.g. 15-Sep-2026. "
                           "null if the notice states no deadline at all.",
        },
        "basis": {
            "type": "string",
            "description": "One line saying where the date came from, e.g. "
                           "'stated on page 1' or 'within 15 days of service on 18-Aug-2026'.",
        },
    },
    "required": ["due_date", "basis"],
    "additionalProperties": False,
}

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {
            "type": "string",
            "description": "Plain language, 2-4 sentences: what this notice is "
                           "about and what it asks the taxpayer to do. No jargon.",
        },
        "checklist": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Each document, statement or explanation the notice "
                           "demands, one per entry. Empty if it demands nothing.",
        },
        "draft_reply": {
            "type": "string",
            "description": "A formal reply the taxpayer could submit, addressed to "
                           "the issuing officer, referencing the notice and its "
                           "reference id. Use [square brackets] wherever a fact is "
                           "not in the notice and the taxpayer must fill it in.",
        },
    },
    "required": ["summary", "checklist", "draft_reply"],
    "additionalProperties": False,
}


# .env.example ships this placeholder; treating it as a real key would turn a
# "you have not set a key yet" into a confusing 401 from the API.
PLACEHOLDER_KEYS = {"", "sk-ant-add-later", "your-api-key"}


def have_key() -> bool:
    return settings.anthropic_api_key.strip() not in PLACEHOLDER_KEYS


def _client() -> anthropic.AsyncAnthropic:
    if not have_key():
        raise ClaudeUnavailable("add API key in .env")
    # Async: a blocking call would freeze the dashboard's WebSocket too.
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)


def _pdf_block(data: bytes) -> dict:
    """The stored notice, straight out of the pdf_blob column."""
    if not data:
        raise ClaudeUnavailable("the stored PDF is empty")
    if len(data) > MAX_PDF_BYTES:
        raise ClaudeUnavailable(
            f"the PDF is {len(data) // (1024 * 1024)}MB, too big to send")
    return {
        "type": "document",
        "source": {
            "type": "base64",
            "media_type": "application/pdf",
            "data": base64.standard_b64encode(data).decode("ascii"),
        },
    }


def _json_answer(response) -> dict:
    """output_config guarantees the first text block is valid JSON."""
    text = next((b.text for b in response.content if b.type == "text"), "")
    return json.loads(text)


async def due_date_from_pdf(pdf: bytes, *, ref_id: str,
                            issued_on: str | None = None,
                            served_on: str | None = None) -> dict:
    """-> {"due_date": "DD-MMM-YYYY" | None, "basis": "<one line>"}"""
    dates = []
    if issued_on:
        dates.append(f"The portal says it was issued on {issued_on}.")
    if served_on:
        dates.append(f"The portal says it was served on {served_on}.")

    prompt = (
        "This is a notice from the Indian income tax e-filing portal "
        f"(reference id {ref_id}). " + " ".join(dates) + "\n\n"
        "Find the date by which the taxpayer must respond.\n"
        "- If the notice states a date, use it exactly.\n"
        "- If it only states a period ('within 15 days of receipt of this "
        "notice'), work the date out from that period and the issue or service "
        "date above, and say so in the basis.\n"
        "- If the notice sets no deadline at all, return null. Do not guess.\n"
        "Return the date as DD-MMM-YYYY."
    )

    client = _client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=2000,
        messages=[{"role": "user", "content": [_pdf_block(pdf),
                                               {"type": "text", "text": prompt}]}],
        output_config={"format": {"type": "json_schema", "schema": DUE_DATE_SCHEMA}},
    )
    return _json_answer(response)


async def draft_from_pdf(pdf: bytes, *, ref_id: str,
                         notice_us: str | None = None,
                         assessee: str | None = None,
                         assessment_year: str | None = None) -> dict:
    """-> {"summary": str, "checklist": [str], "draft_reply": str}"""
    facts = [f"Notice reference id: {ref_id}."]
    if notice_us:
        facts.append(f"Issued under section {notice_us}.")
    if assessee:
        facts.append(f"Assessee: {assessee}.")
    if assessment_year:
        facts.append(f"Assessment year: {assessment_year}.")

    prompt = (
        "This is a notice from the Indian income tax e-filing portal.\n"
        + " ".join(facts) + "\n\n"
        "Read it and produce three things:\n"
        "1. A plain-language summary of what it asks for. The reader is a "
        "developer, not a tax professional - expand the jargon.\n"
        "2. A checklist of every document or explanation it demands.\n"
        "3. A formal draft reply to the issuing officer.\n\n"
        "The reply is a DRAFT for a human to review, edit and file himself. "
        "Never invent facts, figures or dates that are not in the notice: put "
        "[square brackets] where the taxpayer must fill something in. If the "
        "notice demands nothing, say so rather than inventing a request."
    )

    client = _client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": [_pdf_block(pdf),
                                               {"type": "text", "text": prompt}]}],
        output_config={"format": {"type": "json_schema", "schema": DRAFT_SCHEMA}},
    )
    return _json_answer(response)
