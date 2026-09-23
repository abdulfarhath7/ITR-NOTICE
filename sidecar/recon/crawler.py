"""Menu-driven crawl of a logged-in portal.

The income tax portal answers any URL or hash change with a security modal
that blocks the page, so the crawl never navigates by URL. It discovers the
header menu by clicking a top-level entry and diffing which controls became
visible, recurses into sub-menus, and treats "the URL changed" as "a screen
was reached". Each screen is captured, then its tabs and a few allowlisted
"view" drill-downs are captured too. Every path is replayed from the home
screen, so one broken screen never strands the rest of the crawl.
"""
import asyncio
import json
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from app.portal.session import dismiss_security_popup
from playwright.async_api import Page

from .capture import NetRecorder, capture_screen, slug
from .guard import DISMISS, denied, in_page_click_ok, menu_click_ok, norm

CLICKABLES_JS = r"""
(opts) => {
  // Material icon ligatures render as words inside the label and flip on
  // open/close (expand_more <-> expand_less); they are not part of the name.
  const clean = t => t.replace(/\b(expand_more|expand_less|chevron_right|chevron_left|keyboard_arrow_\w+|arrow_drop_\w+|arrow_forward\w*|arrow_back\w*|navigate_next|navigate_before)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const vis = el => {
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const SEL = opts.tabs
    ? '[role=tab],.mat-tab-label,.mat-mdc-tab,.nav-tabs a,.nav-tabs button,.tab-link'
    : 'a,button,[role=menuitem],[role=button],[role=link],[routerlink],li[tabindex],.mat-menu-item,.dropdown-item,.nav-link,.hyperLink';
  const out = [];
  for (const el of document.querySelectorAll(SEL)) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const text = clean(el.innerText || el.getAttribute('aria-label') || '');
    if (!text || text.length > 80) continue;
    if (opts.maxY && r.top > opts.maxY) continue;
    out.push({text, y: Math.round(r.top), x: Math.round(r.left),
              href: el.getAttribute('href') || '', target: el.getAttribute('target') || ''});
  }
  return out;
}
"""

MARK_JS = r"""
([label, tabs, prefer]) => {
  // Material icon ligatures render as words inside the label and flip on
  // open/close (expand_more <-> expand_less); they are not part of the name.
  const clean = t => t.replace(/\b(expand_more|expand_less|chevron_right|chevron_left|keyboard_arrow_\w+|arrow_drop_\w+|arrow_forward\w*|arrow_back\w*|navigate_next|navigate_before)\b/g, ' ').replace(/\s+/g, ' ').trim();
  document.querySelectorAll('[data-recon-target]').forEach(e => e.removeAttribute('data-recon-target'));
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const SEL = tabs
    ? '[role=tab],.mat-tab-label,.mat-mdc-tab,.nav-tabs a,.nav-tabs button,.tab-link'
    : 'a,button,[role=menuitem],[role=button],[role=link],[routerlink],li[tabindex],.mat-menu-item,.dropdown-item,.nav-link,.hyperLink';
  const hits = [...document.querySelectorAll(SEL)].filter(el => vis(el) &&
    clean(el.innerText || el.getAttribute('aria-label') || '') === label);
  if (!hits.length) return false;
  // deepest match wins (a menu <li> often wraps the real <a>); among equals,
  // the one nearest the top of the page for header menus
  hits.sort((a, b) => (b.contains(a) ? 1 : 0) - (a.contains(b) ? 1 : 0) ||
    (prefer === 'top' ? a.getBoundingClientRect().top - b.getBoundingClientRect().top : 0));
  hits[0].setAttribute('data-recon-target', '1');
  return true;
}
"""

Log = Callable[[str], None]


class Crawler:
    def __init__(self, page: Page, out: Path, net: NetRecorder, log: Log,
                 ensure_alive: Callable[[], Awaitable[None]],
                 home_labels: tuple[str, ...], pace: float = 1.5,
                 max_screens: int = 400, header_max_y: int = 260) -> None:
        self.page = page
        self.out = out
        self.net = net
        self.log = log
        self.ensure_alive = ensure_alive
        self.home_labels = home_labels
        self.pace = pace
        self.max_screens = max_screens
        self.header_max_y = header_max_y
        self.screens: list[dict[str, Any]] = []
        self.seen_urls: set[str] = set()
        self.menu_tree: dict[str, Any] = {}
        self.external: set[str] = set()
        self.errors: list[dict[str, str]] = []
        self._n = 0

    # ------------------------------------------------------------ primitives
    async def _settle(self) -> None:
        await asyncio.sleep(self.pace)
        await self._dismiss_dialogs()

    async def _dismiss_dialogs(self) -> None:
        await dismiss_security_popup(self.page)
        # Other modals ("session about to expire", info popups): only benign
        # buttons are ever pressed, and only inside a visible dialog.
        dialog = self.page.locator("[role=dialog]:visible, .modal.show, mat-dialog-container")
        try:
            if not await dialog.count():
                return
            for label in DISMISS:
                btn = dialog.first.get_by_role("button", name=label, exact=True)
                if await btn.count() and await btn.first.is_visible():
                    await btn.first.click(timeout=3000)
                    await asyncio.sleep(0.5)
                    return
        except Exception:  # noqa: BLE001
            return

    async def _clickables(self, tabs: bool = False, header: bool = False) -> list[dict[str, Any]]:
        opts = {"tabs": tabs, "maxY": self.header_max_y if header else 0}
        items: list[dict[str, Any]] = await self.page.evaluate(CLICKABLES_JS, opts)
        return items

    async def _click_label(self, label: str, tabs: bool = False, top: bool = False) -> bool:
        ok = await self.page.evaluate(MARK_JS, [label, tabs, "top" if top else ""])
        if not ok:
            return False
        # XHRs fired by this click belong to the screen it leads to.
        self.net.current_screen = f"after-click:{label}"
        try:
            await self.page.locator("[data-recon-target]").first.click(timeout=8000)
        except Exception:  # noqa: BLE001
            await self._dismiss_dialogs()
            try:
                await self.page.locator("[data-recon-target]").first.click(timeout=8000)
            except Exception:  # noqa: BLE001
                return False
        await self._settle()
        return True

    async def go_home(self) -> None:
        await self.ensure_alive()
        await self._dismiss_dialogs()
        for label in self.home_labels:
            if await self._click_label(label, top=True):
                return
        # Escape closes any open dropdown so the next replay starts clean.
        await self.page.keyboard.press("Escape")

    async def replay(self, path: list[str]) -> bool:
        await self.go_home()
        for i, label in enumerate(path):
            if not await self._click_label(label, top=(i == 0)):
                return False
        return True

    def _url_key(self, url: str) -> str:
        return url.split("?", 1)[0]

    # ----------------------------------------------------------------- crawl
    async def capture(self, path: list[str], note: str = "") -> dict[str, Any] | None:
        if len(self.screens) >= self.max_screens:
            return None
        self._n += 1
        name = f"{self._n:03d}-{slug(' '.join(path) + (' ' + note if note else ''))}"
        self.net.current_screen = name
        try:
            meta = await capture_screen(self.page, self.out / "screens", name, path)
        except Exception as e:  # noqa: BLE001
            self.errors.append({"path": " > ".join(path), "error": repr(e)[:300]})
            return None
        meta["note"] = note
        self.screens.append(meta)
        self.log(f"captured {name}  [{self.page.url.split('#', 1)[-1][:80]}]")
        self._write_index()
        return meta

    async def crawl(self) -> None:
        await self.go_home()
        self.seen_urls.add(self._url_key(self.page.url))
        await self.capture(["Home"])
        await self._explore_page(["Home"], [])

        top = await self._clickables(header=True)
        top_labels = []
        for item in top:
            lab = norm(item["text"])
            if lab and lab not in top_labels and menu_click_ok(lab) and lab not in self.home_labels:
                top_labels.append(lab)
        self.log(f"header menu candidates: {top_labels}")
        for lab in top_labels:
            await self._walk_menu([lab], self.menu_tree, depth=0)
        self._write_index()

    async def capture_paths(self, paths: list[list[str]]) -> None:
        """Targeted mode: replay each path, capture where it lands, then its
        tabs. Every label still goes through the menu/in-page guard."""
        for path in paths:
            try:
                await self.go_home()
                ok = True
                for i, label in enumerate(path):
                    allowed = menu_click_ok(label) if i < 3 else in_page_click_ok(label)
                    if not allowed or not await self._click_label(label, top=(i == 0)):
                        self.errors.append({"path": " > ".join(path), "error": f"could not click {label!r}"})
                        ok = False
                        break
                if ok:
                    await self.capture(path)
                    await self._explore_page(path, [])
            except Exception as e:  # noqa: BLE001
                self.errors.append({"path": " > ".join(path), "error": repr(e)[:300]})
        self._write_index()

    async def _walk_menu(self, path: list[str], tree: dict[str, Any], depth: int) -> None:
        if len(self.screens) >= self.max_screens:
            return
        try:
            await self.go_home()
            for i, label in enumerate(path[:-1]):
                await self._click_label(label, top=(i == 0))
            before_url = self._url_key(self.page.url)
            before = {norm(c["text"]) for c in await self._clickables()}
            if not await self._click_label(path[-1], top=(len(path) == 1)):
                tree[path[-1]] = {"_missing": True}
                return
            after_url = self._url_key(self.page.url)
            node: dict[str, Any] = {}
            tree[path[-1]] = node
            if after_url != before_url:
                node["_url"] = self.page.url
                if after_url not in self.seen_urls:
                    self.seen_urls.add(after_url)
                    await self.capture(path)
                    await self._explore_page(path, [])
                return
            if depth >= 3:
                return
            now = await self._clickables()
            fresh = []
            for c in now:
                lab = norm(c["text"])
                if lab and lab not in before and lab not in fresh and lab not in path and menu_click_ok(lab):
                    if c.get("target") == "_blank" or (c["href"].startswith("http") and "incometax.gov.in" not in c["href"]):
                        self.external.add(f"{lab} -> {c['href']}")
                        continue
                    fresh.append(lab)
            if not fresh:
                # Same URL, nothing new: an in-place panel. Capture it once.
                node["_inplace"] = True
                await self.capture(path, "inplace")
                return
            node["_children"] = fresh
            for child in fresh:
                await self._walk_menu(path + [child], node, depth + 1)
        except Exception as e:  # noqa: BLE001 - one bad entry never ends the crawl
            self.errors.append({"path": " > ".join(path), "error": repr(e)[:300]})
            self.log(f"error on {' > '.join(path)}: {e!r}"[:300])

    async def _explore_page(self, path: list[str], done_tabs: list[str]) -> None:
        """Tabs of the current screen, then up to three view-style drill-downs."""
        try:
            tabs = []
            for t in await self._clickables(tabs=True):
                lab = norm(t["text"])
                if lab and lab not in tabs and lab not in done_tabs and in_page_or_tab_ok(lab):
                    tabs.append(lab)
            for lab in tabs[:12]:
                if len(self.screens) >= self.max_screens:
                    return
                if await self._click_label(lab, tabs=True):
                    await self.capture(path, f"tab {lab}")
                    # Sub-tabs (e.g. e-Proceedings Self / Other PAN > Open / Closed)
                    for st in await self._clickables(tabs=True):
                        sl = norm(st["text"])
                        if sl and sl not in tabs and in_page_or_tab_ok(sl):
                            if await self._click_label(sl, tabs=True):
                                await self.capture(path, f"tab {lab} {sl}")
                                await self._drill(path + [f"[tab]{lab}", f"[tab]{sl}"])
                    await self._drill(path + [f"[tab]{lab}"])
            if not tabs:
                await self._drill(path)
        except Exception as e:  # noqa: BLE001
            self.errors.append({"path": " > ".join(path), "error": repr(e)[:300]})

    async def _drill(self, path: list[str]) -> None:
        """Open the first card behind each allowlisted view control, once."""
        labels = []
        for c in await self._clickables():
            lab = norm(c["text"])
            if lab and lab not in labels and in_page_click_ok(lab) and not lab.isdigit() \
                    and lab not in (">", "<", "»", "«", "Next", "Previous"):
                labels.append(lab)
        for lab in labels[:3]:
            if len(self.screens) >= self.max_screens:
                return
            if not await self._click_label(lab):
                continue
            await self.capture(path, f"view {lab}")
            # Return by the portal's own Back button, else by replay.
            if not await self._click_label("Back"):
                menu = [p for p in path if not p.startswith("[tab]") and p != "Home"]
                if menu:
                    await self.replay(menu)
                    for p in path:
                        if p.startswith("[tab]"):
                            await self._click_label(p[5:], tabs=True)

    def _write_index(self) -> None:
        idx = {"generated": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "screens": self.screens, "menu_tree": self.menu_tree,
               "external_links": sorted(self.external), "errors": self.errors}
        (self.out / "sitemap.json").write_text(json.dumps(idx, indent=1))
        lines = ["# Portal map", "", f"Generated {idx['generated']}. "
                 f"{len(self.screens)} screens, {len(self.errors)} errors.", "",
                 "| # | Click path | Note | URL | Headings |", "|---|---|---|---|---|"]
        for s in self.screens:
            lines.append(f"| {s['name']} | {' > '.join(s['click_path'])} | {s.get('note', '')} | "
                         f"`{s['url'].split('#', 1)[-1][:70]}` | {'; '.join(s['headings'][:4])[:120]} |")
        if self.external:
            lines += ["", "## External links (not followed)", ""] + [f"- {x}" for x in sorted(self.external)]
        if self.errors:
            lines += ["", "## Errors", ""] + [f"- {e['path']}: {e['error']}" for e in self.errors]
        (self.out / "INDEX.md").write_text("\n".join(lines) + "\n")


def in_page_or_tab_ok(label: str) -> bool:
    """Tabs only switch the view, so the menu rule applies, not the view allowlist."""
    return menu_click_ok(label) and not denied(label)
