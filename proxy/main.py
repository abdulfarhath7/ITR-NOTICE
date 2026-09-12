"""Litigation Command Center proxy - the one thing that must stay on a server.

Holds two secrets the desktop app must never contain: the Anthropic API key
and the prompts. Stateless: a request carries the PDF in, an answer goes
out, nothing is stored. (DPDP: that makes you a data *processor* for the
firm - keep it that way; never log request bodies.)

Auth: each CA firm gets one bearer token. FIRM_TOKENS="tok1,tok2" in .env.
Metering per firm is the natural next step: count tokens per bearer here.

Run:  uvicorn main:app --host 0.0.0.0 --port 8787
"""
import base64
import json
import os
import secrets
from typing import Any

import anthropic
from anthropic.types import Message
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

load_dotenv()

MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")
MAX_PDF_BYTES = 25 * 1024 * 1024
FIRM_TOKENS = {t.strip() for t in os.getenv("FIRM_TOKENS", "").split(",") if t.strip()}

app = FastAPI(title="Litigation Command Center proxy", docs_url=None, redoc_url=None)
client = anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"])


def firm(authorization: str = Header(default="")) -> str:
    token = authorization.removeprefix("Bearer ").strip()
    if not any(secrets.compare_digest(token, t) for t in FIRM_TOKENS):
        raise HTTPException(401, "unknown firm token")
    return token


DUE_DATE_SCHEMA = {
    "type": "object",
    "properties": {
        "due_date": {"type": ["string", "null"],
                     "description": "Response due date as DD-MMM-YYYY, e.g. 15-Sep-2026. "
                                    "null if the notice states no deadline at all."},
        "basis": {"type": "string",
                  "description": "One line on where the date came from."},
    },
    "required": ["due_date", "basis"], "additionalProperties": False,
}

DRAFT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string",
                    "description": "Plain language, 2-4 sentences: what this notice asks."},
        "checklist": {"type": "array", "items": {"type": "string"},
                      "description": "Each document or explanation demanded, one per entry."},
        "draft_reply": {"type": "string",
                        "description": "A formal reply to the issuing officer referencing the "
                                       "notice. Use [square brackets] for facts not in the notice."},
    },
    "required": ["summary", "checklist", "draft_reply"], "additionalProperties": False,
}


def _pdf_block(b64: str) -> dict[str, Any]:
    raw = base64.standard_b64decode(b64)
    if not raw:
        raise HTTPException(400, "empty PDF")
    if len(raw) > MAX_PDF_BYTES:
        raise HTTPException(413, "PDF too large")
    return {"type": "document",
            "source": {"type": "base64", "media_type": "application/pdf", "data": b64}}


def _json_answer(response: Message) -> dict[str, Any]:
    text = next((b.text for b in response.content if b.type == "text"), "")
    answer: dict[str, Any] = json.loads(text)
    return answer


class DueDateIn(BaseModel):
    ref_id: str
    pdf_b64: str
    issued_on: str | None = None
    served_on: str | None = None


class DraftIn(BaseModel):
    ref_id: str
    pdf_b64: str
    notice_us: str | None = None
    assessee: str | None = None
    assessment_year: str | None = None


@app.post("/v1/due-date")
async def due_date(body: DueDateIn, _: str = Depends(firm)) -> dict[str, Any]:
    dates = []
    if body.issued_on:
        dates.append(f"The portal says it was issued on {body.issued_on}.")
    if body.served_on:
        dates.append(f"The portal says it was served on {body.served_on}.")
    prompt = (
        "This is a notice from the Indian income tax e-filing portal "
        f"(reference id {body.ref_id}). " + " ".join(dates) + "\n\n"
        "Find the date by which the taxpayer must respond.\n"
        "- If the notice states a date, use it exactly.\n"
        "- If it only states a period ('within 15 days of receipt of this "
        "notice'), work the date out from that period and the issue or service "
        "date above, and say so in the basis.\n"
        "- If the notice sets no deadline at all, return null. Do not guess.\n"
        "Return the date as DD-MMM-YYYY."
    )
    response = await client.messages.create(  # type: ignore[call-overload]
        model=MODEL, max_tokens=2000,
        messages=[{"role": "user", "content": [_pdf_block(body.pdf_b64),
                                               {"type": "text", "text": prompt}]}],
        output_config={"format": {"type": "json_schema", "schema": DUE_DATE_SCHEMA}},
    )
    return _json_answer(response)


@app.post("/v1/draft")
async def draft(body: DraftIn, _: str = Depends(firm)) -> dict[str, Any]:
    facts = [f"Notice reference id: {body.ref_id}."]
    if body.notice_us:
        facts.append(f"Issued under section {body.notice_us}.")
    if body.assessee:
        facts.append(f"Assessee: {body.assessee}.")
    if body.assessment_year:
        facts.append(f"Assessment year: {body.assessment_year}.")
    prompt = (
        "This is a notice from the Indian income tax e-filing portal.\n"
        + " ".join(facts) + "\n\n"
        "Read it and produce three things:\n"
        "1. A plain-language summary of what it asks for.\n"
        "2. A checklist of every document or explanation it demands.\n"
        "3. A formal draft reply to the issuing officer.\n\n"
        "The reply is a DRAFT for a chartered accountant to review, edit and "
        "file. Never invent facts, figures or dates that are not in the notice: "
        "put [square brackets] where the taxpayer must fill something in. If the "
        "notice demands nothing, say so rather than inventing a request."
    )
    response = await client.messages.create(  # type: ignore[call-overload]
        model=MODEL, max_tokens=16000, thinking={"type": "adaptive"},
        messages=[{"role": "user", "content": [_pdf_block(body.pdf_b64),
                                               {"type": "text", "text": prompt}]}],
        output_config={"format": {"type": "json_schema", "schema": DRAFT_SCHEMA}},
    )
    return _json_answer(response)


@app.get("/healthz")
async def healthz() -> dict[str, bool]:
    return {"ok": True}
