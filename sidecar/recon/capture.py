"""Everything written to disk for one screen, and the network recorder.

Per screen: page.html (serialised live DOM), inventory.json (every visible
interactive element with candidate selectors, headings, tables, forms),
aria.yaml (accessibility tree), shot.png (full page) and meta.json.

The network recorder keeps each XHR/fetch exchange of the portal's own API as
JSON on disk, plus a values-free shape of every endpoint in api-catalog.json.
The catalog is the part meant to be read when writing automation; raw bodies
hold client data and stay local.
"""
import json
import re
import time
from pathlib import Path
from typing import Any

from playwright.async_api import Page, Request, Response

INVENTORY_JS = r"""
() => {
  const vis = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
  };
  const txt = el => (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 160);
  const cssPath = el => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 8; n = n.parentElement) {
      if (n.id && !/\d{4,}/.test(n.id)) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let p = n.tagName.toLowerCase();
      const fcn = n.getAttribute('formcontrolname');
      if (fcn) p += `[formcontrolname="${fcn}"]`;
      else if (n.parentElement) {
        const sib = [...n.parentElement.children].filter(c => c.tagName === n.tagName);
        if (sib.length > 1) p += `:nth-of-type(${sib.indexOf(n) + 1})`;
      }
      parts.unshift(p);
    }
    return parts.join(' > ');
  };
  const attrs = el => {
    const o = {};
    for (const a of el.attributes) {
      if (/^(id|name|type|role|placeholder|formcontrolname|aria-[\w-]+|href|routerlink|data-[\w-]+|for|title|class|mattooltip)$/i.test(a.name))
        o[a.name] = a.value.slice(0, 200);
    }
    return o;
  };
  const SEL = 'a,button,input,select,textarea,[role=button],[role=tab],[role=menuitem],[role=link],[role=checkbox],[role=radio],[role=option],[role=combobox],[tabindex]:not([tabindex="-1"]),mat-select,mat-tab,.mat-tab-label,.mat-mdc-tab,[routerlink],[ng-reflect-router-link]';
  const interactive = [...document.querySelectorAll(SEL)].filter(vis).slice(0, 1500).map(el => ({
    tag: el.tagName.toLowerCase(), text: txt(el), attrs: attrs(el), css: cssPath(el),
    disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
  }));
  const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading],.page-title,.heading')]
    .filter(vis).map(el => ({tag: el.tagName.toLowerCase(), text: txt(el)})).slice(0, 200);
  const tables = [...document.querySelectorAll('table,[role=table],[role=grid],mat-table')].filter(vis).map(t => ({
    css: cssPath(t),
    headers: [...t.querySelectorAll('th,[role=columnheader],mat-header-cell')].map(txt),
    rows: t.querySelectorAll('tr,[role=row],mat-row').length,
  })).slice(0, 50);
  const forms = [...document.querySelectorAll('input,select,textarea,mat-select')].filter(vis).map(el => {
    let label = el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    if (!label && el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) label = txt(l); }
    if (!label) { const f = el.closest('mat-form-field,.form-group,.field'); if (f) { const l = f.querySelector('label,mat-label'); if (l) label = txt(l); } }
    return {tag: el.tagName.toLowerCase(), type: el.getAttribute('type'), label, css: cssPath(el), attrs: attrs(el)};
  }).slice(0, 400);
  const frames = [...document.querySelectorAll('iframe')].map(f => f.src).slice(0, 20);
  return {url: location.href, title: document.title, headings, interactive, tables, forms, frames};
}
"""

API_HINT = re.compile(r"/(iec|itbaportal|services|api|ws|rest)/", re.I)
STATIC = re.compile(r"\.(js|css|png|jpe?g|gif|svg|woff2?|ttf|ico|map)(\?|$)", re.I)


def slug(text: str, limit: int = 60) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "-", text).strip("-").lower()
    return (s or "page")[:limit]


def shape(value: Any, depth: int = 0) -> Any:
    """Keys and types only, never values: safe to read and share."""
    if depth > 6:
        return "..."
    if isinstance(value, dict):
        return {k: shape(v, depth + 1) for k, v in list(value.items())[:80]}
    if isinstance(value, list):
        return [shape(value[0], depth + 1)] if value else []
    if value is None:
        return "null"
    return type(value).__name__


class NetRecorder:
    """Records the portal's own API calls while a screen is being visited."""

    def __init__(self, out: Path) -> None:
        self.out = out
        self.out.mkdir(parents=True, exist_ok=True)
        self.catalog: dict[str, dict[str, Any]] = {}
        self.current_screen = "login"
        self._seq = 0

    def attach(self, page: Page) -> None:
        page.on("response", self._on_response)

    async def _on_response(self, resp: Response) -> None:
        req: Request = resp.request
        if req.resource_type not in ("xhr", "fetch") or STATIC.search(req.url):
            return
        if self.current_screen == "login":
            return  # login exchanges carry the user id and password
        try:
            ctype = resp.headers.get("content-type", "")
            body: Any = None
            if "json" in ctype:
                body = await resp.json()
            post: Any = None
            if req.post_data:
                try:
                    post = json.loads(req.post_data)
                except ValueError:
                    post = req.post_data[:2000]
        except Exception:  # noqa: BLE001 - a body can vanish on navigation
            return
        path = re.sub(r"\?.*$", "", req.url)
        key = f"{req.method} {path}"
        entry = self.catalog.setdefault(key, {
            "method": req.method, "url": path, "status": resp.status,
            "content_type": ctype, "seen_on": [], "request_shape": None,
            "response_shape": None, "samples": [],
        })
        if self.current_screen not in entry["seen_on"]:
            entry["seen_on"].append(self.current_screen)
        if post is not None and entry["request_shape"] is None:
            entry["request_shape"] = shape(post)
        if body is not None and entry["response_shape"] is None:
            entry["response_shape"] = shape(body)
        self._seq += 1
        name = f"{self._seq:05d}-{slug(path.rsplit('/', 1)[-1], 40)}.json"
        if len(entry["samples"]) < 3:
            entry["samples"].append(name)
        (self.out / name).write_text(json.dumps({
            "screen": self.current_screen, "method": req.method, "url": req.url,
            "status": resp.status, "request": post, "response": body,
            "at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }, indent=1, default=str))

    def flush(self, dest: Path) -> None:
        dest.write_text(json.dumps(self.catalog, indent=1, default=str))


async def capture_screen(page: Page, root: Path, name: str, path: list[str]) -> dict[str, Any]:
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    await page.wait_for_timeout(1200)
    try:
        await page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:  # noqa: BLE001 - the portal polls; idle may never come
        pass
    inv: dict[str, Any] = await page.evaluate(INVENTORY_JS)
    (d / "page.html").write_text(await page.content())
    (d / "inventory.json").write_text(json.dumps(inv, indent=1))
    try:
        (d / "aria.yaml").write_text(await page.locator("body").aria_snapshot())
    except Exception:  # noqa: BLE001
        pass
    try:
        await page.screenshot(path=str(d / "shot.png"), full_page=True)
    except Exception:  # noqa: BLE001
        pass
    meta = {"name": name, "click_path": path, "url": page.url, "title": inv.get("title"),
            "headings": [h["text"] for h in inv.get("headings", [])][:15],
            "interactive": len(inv.get("interactive", [])),
            "tables": [t["headers"] for t in inv.get("tables", [])][:10],
            "at": time.strftime("%Y-%m-%dT%H:%M:%S")}
    (d / "meta.json").write_text(json.dumps(meta, indent=1))
    return meta
