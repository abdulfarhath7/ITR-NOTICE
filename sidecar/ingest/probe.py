"""The probe (docs/17 §2.2): a cheap look at a listing that says whether
anything on it moved since the last sweep.

The hash is built from portal row content only - the fields the parser read
off each card, in portal order, first `pages` pages. Nothing the tool
computes (today's date, a bucket, a rank) goes in: a wrong input here would
hide real notices. Any failure answers `list_hash: null`, which the core
treats as "changed".
"""
import hashlib
import json
from typing import Any

from app.portal.scraper import PROCEEDING_CARD, _next_page, _set_page_size_max

from .modules import CARD_SELECTORS, FORM_SUMMARY, MODULE_CARD_JS, _open_module, map_fields
from .parse import CARD_JS, parse_proceeding
from .protocol import emit, log
from .session import IngestSession, Relay
from .walk import PanelStats, open_panel, split_panel

DEFAULT_PAGES = 2


def row_hash(fields: dict[str, Any]) -> str:
    """One row's content hash. Keys sorted so field order on the page never
    matters; values as the parser returned them."""
    clean = {k: v for k, v in fields.items() if not k.startswith("_")}
    return hashlib.sha256(json.dumps(clean, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


def list_hash(row_hashes: list[str]) -> str:
    """SHA-256 over the row hashes in portal order. An empty listing has a
    stable hash too: "nothing there" is a state worth remembering."""
    return hashlib.sha256("".join(row_hashes).encode("ascii")).hexdigest()


async def _rows_on_pages(session: IngestSession, relay: Relay, selector: str, js: str,
                         parse: Any, pages: int) -> list[str]:
    page = session.page
    assert page is not None
    await _set_page_size_max(page, relay)
    hashes: list[str] = []
    for n in range(max(1, pages)):
        cards = page.locator(selector)
        total = await cards.count()
        for i in range(total):
            await session.ensure_alive()
            raw: dict[str, Any] = await cards.nth(i).evaluate(js)
            hashes.append(row_hash(parse(raw)))
        if n + 1 >= pages or not await _next_page(page):
            break
        await page.wait_for_timeout(1500)
    return hashes


async def probe(session: IngestSession, relay: Relay, panel: str, pages: int = DEFAULT_PAGES) -> None:
    """Answer one `probe` command with exactly one `probe_done`."""
    try:
        if panel in ("demands", "returns", "forms"):
            hashes = await _probe_module(session, relay, panel, pages)
        else:
            hashes = await _probe_panel(session, relay, panel, pages)
    except Exception as e:  # noqa: BLE001 - a failed probe means "sweep it"
        log(f"  probe {panel} failed ({e!r}); the client will be swept", "warn")
        emit("probe_done", panel=panel, list_hash=None, rows=0, note=repr(e))
        return
    if hashes is None:
        emit("probe_done", panel=panel, list_hash=list_hash(["missing"]), rows=0, note="panel not shown")
        return
    log(f"  probe {panel}: {len(hashes)} row(s)")
    emit("probe_done", panel=panel, list_hash=list_hash(hashes), rows=len(hashes), note=None)


async def _probe_panel(session: IngestSession, relay: Relay, panel: str, pages: int) -> list[str] | None:
    tab_key, sub_key = split_panel(panel)
    # A throwaway stats object: open_panel reports an absent panel through it.
    count = await open_panel(session, relay, panel, PanelStats(panel))
    if count is None:
        return None
    if count == 0:
        return []
    return await _rows_on_pages(session, relay, PROCEEDING_CARD, CARD_JS,
                                lambda raw: parse_proceeding(raw, tab_key, sub_key)[0], pages)


async def _probe_module(session: IngestSession, relay: Relay, module: str, pages: int) -> list[str] | None:
    if not await _open_module(session, relay, module):
        return None
    if module == "forms":
        # The summary cards (one per form type) carry the filing counts;
        # a new filing changes one of them.
        page = session.page
        assert page is not None
        summaries = page.locator(FORM_SUMMARY)
        texts = [await summaries.nth(i).inner_text() for i in range(await summaries.count())]
        return [row_hash({"text": " ".join(t.split())}) for t in texts]
    return await _rows_on_pages(session, relay, CARD_SELECTORS, MODULE_CARD_JS,
                                lambda raw: map_fields(module, raw)[0], pages)
