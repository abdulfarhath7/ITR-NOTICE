"""docs/12 "Ingestion": the anchored parsers against scrubbed DOM captures.
Run: .venv/bin/python -m pytest sidecar/tests -q  (needs Playwright's Chromium)."""
import asyncio
from pathlib import Path

from ingest.parse import CARD_JS, parse_notice, parse_proceeding
from playwright.async_api import async_playwright

FIXTURES = Path(__file__).parent / "fixtures"


async def _cards(file: str, selector: str) -> list[dict]:
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()
        await page.goto((FIXTURES / file).as_uri())
        raws = await page.locator(selector).evaluate_all(f"(cards) => cards.map({CARD_JS})")
        await browser.close()
        return raws


def test_proceeding_cards_anchor_every_field() -> None:
    raws = asyncio.run(_cards("proceeding-cards.html", "div.card-container.matCardRow"))
    assert len(raws) == 2
    first, conf = parse_proceeding(raws[0], "self", "action")
    assert first["proceeding_name"] == "Issue Letter"
    assert first["assessment_year"] is None            # "Not Available" is a gap, not a value
    assert first["pan"] == "ABCDE1234F"
    assert first["assessee_name"] == "EXAMPLE ASSESSEE LIMITED"
    assert first["status"] == "Open"
    assert first["initiated_on"] is None, "the stepper date is not read (Q22)"
    assert first["closure_date"] is None
    assert first["financial_year"] is None
    assert first["applicable_act"] == "Income Tax Act 1961"
    assert first["notice_count"] == 1
    for key in ("proceeding_name", "assessment_year", "pan", "assessee_name", "status"):
        assert conf[key] == "high", (key, conf)
    assert conf["initiated_on"] == "missing"

    second, _ = parse_proceeding(raws[1], "self", "action")
    assert second["proceeding_name"] == "First Appeal Proceedings"
    assert second["assessment_year"] == "2023-24"
    assert second["financial_year"] == "2022-23"
    assert second["initiated_on"] is None


def test_notice_card_anchors_reference_din_and_dates() -> None:
    raws = asyncio.run(_cards("notice-cards.html", "div.card-container.matCard"))
    assert len(raws) == 1
    n, conf = parse_notice(raws[0])
    assert n["reference_id"] == "100000000001"
    assert n["din"] == "ITBA/COM/F/17/2026-27/1000000001(1)"
    assert n["section"] is None                        # an Issue Letter has no section
    assert n["description"] == "[ITBA]Issue Letter"
    assert n["issued_on"] == "17-Aug-2026"
    assert n["response_due_date"] is None              # not on this card: a gap
    assert n["last_response_on"] == "18-Aug-2026"
    assert n["ao_viewed_on"] == "27-Aug-2026"
    assert n["responded"] == 1                         # "View Response" button
    assert n["has_pdf_button"] is True
    assert conf["reference_id"] == "high" and conf["din"] == "high" and conf["issued_on"] == "high"
    assert conf["response_due_date"] == "missing"


def test_probe_hash_is_stable_and_moves_with_a_status() -> None:
    """Task 23.3: the probe's list hash is a function of portal row content."""
    from ingest.probe import list_hash, row_hash
    raws = asyncio.run(_cards("proceeding-cards.html", "div.card-container.matCardRow"))
    rows = [parse_proceeding(r, "self", "action")[0] for r in raws]
    first = list_hash([row_hash(r) for r in rows])
    again = list_hash([row_hash(parse_proceeding(r, "self", "action")[0]) for r in raws])
    assert first == again
    changed = [dict(rows[0], status="Closed"), rows[1]]
    assert list_hash([row_hash(r) for r in changed]) != first
