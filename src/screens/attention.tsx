/** Screen 1 — Attention (docs/16 §1, docs/18 §2–§3). Top to bottom: the
 *  sync line, the risk strip, the filter bar with the window chips, the
 *  active chips, the hint line, then the ranked list card with saved views.
 *  Windows are cumulative (Last 7 ⊂ Last 15 ⊂ Last 30). Every count is
 *  computed after the filter bar and before the tile or window selection,
 *  so a selected window never shrinks its own number to zero. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useDraft } from "../hooks/use-draft";
import { useOwners } from "../hooks/use-owners";
import { useRowNav, type RowNavProps } from "../hooks/use-row-nav";
import { useAttention, useWorkItems } from "../hooks/use-work-items";
import { api, describeError } from "../lib/api";
import { RANK_LABEL, RANK_TONE, type Rank, type RankedItem } from "../lib/attention";
import {
  RISK_LABEL, RISK_TILES, RISK_TONE, WINDOW_DAYS, countWindows, inLimitation, inTileFilter, inWindow, rangeText,
  windowDays, windowLabel, windowRange, windowSummary, type RiskTile, type WindowDays, type WindowKind, type WindowValue,
} from "../lib/windows";
import { migrateAttentionFilters } from "../lib/filters-migrate";
import { todayIst, type Ymd } from "../lib/dates";
import { describeDueShort, shortDateOf } from "../lib/due";
import { MODULES, MODULE_LABEL, MODULE_NOUN, plural } from "../lib/labels";
import { DEFAULT_FILTERS, type AttentionFilters } from "../lib/attention-filters";
import { usePersistedFilters } from "../lib/persisted-filters";
import { useQuery } from "../lib/query";
import { href, navigate } from "../lib/router";
import { useSavedViews, type SavedView } from "../lib/saved-views";
import { sectionLabel, sectionTone } from "../lib/section-tone";
import { STATUSES, STATUS_LABEL, actionsFor, isSettled } from "../lib/status";
import { toast, toastError } from "../lib/toast";
import type { Module, SyncLine, WorkItemRow } from "../lib/types";
import { Confirm, Dialog } from "../ui/dialog";
import DraftDrawer from "../ui/draft-drawer";
import EmptyState from "../ui/empty-state";
import ExportDialog from "../ui/export-dialog";
import Icon from "../ui/icons";
import OwnerSelect, { Avatar } from "../ui/owner-select";
import { Page, PageBody, PageHead } from "../ui/page";
import PendingDocs, { pendingOf } from "../ui/pending-docs";
import { StatusPill } from "../ui/pill";

/** Rows rendered at a time; the rest arrive on request. */
const PAGE = 200;
const MINE = "__mine";

const same = (a: AttentionFilters, b: AttentionFilters) =>
  (Object.keys(DEFAULT_FILTERS) as (keyof AttentionFilters)[]).every((k) => a[k] === b[k]);

// ------------------------------------------------------------------ sync line

/** `6:12 am` today, `22 Sep, 6:12 am` otherwise, in IST. */
function syncTime(iso: string, today: Ymd): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const time = d.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
  const day = todayIst(d);
  return day.y === today.y && day.m === today.m && day.d === today.d ? time : `${shortDateOf(`${day.y}-${String(day.m).padStart(2, "0")}-${String(day.d).padStart(2, "0")}`, today)}, ${time}`;
}

function SyncLineView({ today }: { today: Ymd }) {
  // Keyed under work_items so a running sweep's refreshes reach it too.
  const q = useQuery<SyncLine>("work_items:syncline", () => api.syncLine());
  const s = q.data;
  if (!s) return <p className="att-sync">{q.error ? "Sync state unavailable" : " "}</p>;
  if (!s.last_run_at) return <p className="att-sync">Never synced</p>;
  return (
    <p className="att-sync">
      Synced {syncTime(s.last_run_at, today)} · {plural(s.clients, "client")}
      {s.failed ? <> · <span className="due danger">{s.failed} failed</span> · <a href={href({ name: "ingestion", filter: "failed" })}>Retry</a></> : null}
    </p>
  );
}

// ------------------------------------------------------------------ risk strip, windows, hint

function RiskStrip({ counts, active, onPick }: { counts: Record<RiskTile, number>; active: (t: RiskTile) => boolean; onPick: (t: RiskTile) => void }) {
  return (
    <div className="att-strip" role="group" aria-label="Risk">
      {RISK_TILES.map((t) => (
        <button key={t} type="button" className={`att-tile ${RISK_TONE[t]}`} aria-pressed={active(t)} onClick={() => onPick(t)}>
          <span className="label">{RISK_LABEL[t]}</span>
          <span className="value">{counts[t]}</span>
        </button>
      ))}
    </div>
  );
}

/** One single-select group: Last 7 / 15 / 30 or Next 7 / 15 / 30, with
 *  counts. Clicking the active one clears it. */
function WindowGroup({ kind, counts, active, onPick }: {
  kind: WindowKind; counts: Record<WindowDays, number>; active: WindowValue; onPick: (v: WindowValue) => void;
}) {
  return (
    <span className="att-window-group">
      <span className="att-window-label">{kind === "issued" ? "Issued" : "Due"}</span>
      <span className="segmented" role="radiogroup" aria-label={kind === "issued" ? "Issued window" : "Due window"}>
        {WINDOW_DAYS.map((n) => {
          const v = String(n) as WindowValue;
          return (
            <button key={n} type="button" role="radio" aria-checked={active === v} onClick={() => onPick(active === v ? "" : v)}>
              {windowLabel(kind, n)}<span className="att-window-count">{counts[n]}</span>
            </button>
          );
        })}
      </span>
    </span>
  );
}

/** docs/18 §2: literal copy, one sentence per active window. */
function HintLine({ issued, due, today }: { issued: WindowValue; due: WindowValue; today: Ymd }) {
  const i = windowDays(issued);
  const d = windowDays(due);
  if (!i && !d) return <p className="att-hint">Showing all open items.</p>;
  return (
    <p className="att-hint">
      {i ? (
        <span className="att-hint-part">
          <span className="pill att-days">Days 1–{i}</span>
          <span>Showing notices issued {rangeText(windowRange("issued", i, today))}. Last 7 is inside Last 15, which is inside Last 30.</span>
        </span>
      ) : null}
      {d ? (
        <span className="att-hint-part">
          <span className="pill att-days">Days 1–{d}</span>
          <span>Showing notices due {rangeText(windowRange("due", d, today))}. Next 7 is inside Next 15, which is inside Next 30.</span>
        </span>
      ) : null}
    </p>
  );
}

/** `Limitation ≤ 90d` with a 30 / 60 / 90 menu (docs/18 §3.3). Click
 *  applies the default; the menu changes the days; the active chip's ×
 *  clears it. */
function LimitationChip({ value, onPick }: { value: "" | "30" | "60" | "90"; onPick: (v: "" | "30" | "60" | "90") => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <span className="att-lim">
      <button type="button" className={`chip${value ? " on" : ""}`} aria-pressed={!!value}
              onClick={() => onPick(value ? "" : "90")}>Limitation ≤ {value || "90"}d</button>
      <button type="button" className="chip att-lim-menu" aria-label="Limitation days" aria-haspopup="menu" aria-expanded={open}
              onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}><Icon name="chevron-down" /></button>
      {open ? (
        <span className="att-menu" role="menu">
          {(["30", "60", "90"] as const).map((d) => (
            <button key={d} type="button" role="menuitem" aria-checked={value === d}
                    onClick={() => { setOpen(false); onPick(d); }}>≤ {d} days</button>
          ))}
        </span>
      ) : null}
    </span>
  );
}

// ------------------------------------------------------------------ chips

interface Chip { key: string; label: string; clear: () => void }

function Chips({ chips, onClearAll }: { chips: Chip[]; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="att-chips" aria-label="Active filters">
      {chips.map((c) => (
        <span key={c.key} className="pill accent att-chip">
          {c.label}
          <button type="button" aria-label={`Remove ${c.label}`} title="Remove" onClick={c.clear}><Icon name="x" /></button>
        </span>
      ))}
      <button type="button" className="btn small quiet" onClick={onClearAll}>Clear all</button>
    </div>
  );
}

// ------------------------------------------------------------------ views row

function ViewsRow({ views, current, onPick, onAll, onSave, onRename, onDelete, full }: {
  views: SavedView<AttentionFilters>[]; current: AttentionFilters;
  onPick: (v: SavedView<AttentionFilters>) => void; onAll: () => void; onSave: () => void;
  onRename: (v: SavedView<AttentionFilters>) => void; onDelete: (v: SavedView<AttentionFilters>) => void; full: boolean;
}) {
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  const all = same(current, DEFAULT_FILTERS);
  return (
    <div className="att-views" role="tablist" aria-label="Saved views">
      <button type="button" role="tab" aria-selected={all} onClick={onAll}>All</button>
      {views.map((v) => (
        <span key={v.id} className="att-view" onContextMenu={(e) => { e.preventDefault(); setMenu(v.id); }}>
          <button type="button" role="tab" aria-selected={!all && same(current, { ...DEFAULT_FILTERS, ...v.filters })} onClick={() => onPick(v)}>{v.name}</button>
          <button type="button" className="att-view-more" aria-label={`${v.name}: rename or delete`} title="Rename or delete"
                  onClick={(e) => { e.stopPropagation(); setMenu(menu === v.id ? null : v.id); }}><Icon name="more" /></button>
          {menu === v.id ? (
            <span className="att-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenu(null); onRename(v); }}>Rename</button>
              <button type="button" role="menuitem" className="danger" onClick={() => { setMenu(null); onDelete(v); }}>Delete</button>
            </span>
          ) : null}
        </span>
      ))}
      <button type="button" className="att-save-view" onClick={onSave} disabled={full}
              title={full ? "Twelve saved views is the limit. Delete one first." : undefined}>+ Save view</button>
    </div>
  );
}

function NameDialog({ title, initial, onSave, onClose }: {
  title: string; initial: string; onSave: (name: string) => void; onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0;
  return (
    <Dialog title={title} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={!ok} onClick={() => onSave(name)}>Save</button>
      </>
    }>
      <div className="field">
        <label htmlFor="view-name">Name</label>
        <input id="view-name" className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && ok) onSave(name); }} placeholder="View name" />
        <span className="hint">Saves the selects, owner, tile, windows and chips. Search text is not saved.</span>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ list

function Row({ item, nav, today, owning, onOwn, onDraft, onDate }: {
  item: RankedItem; nav: RowNavProps; today: Ymd; owning: boolean;
  onOwn: (open: boolean) => void; onDraft: () => void; onDate: () => void;
}) {
  const r = item.row;
  const open = () => navigate({ name: "item", module: r.module, id: r.id });
  const due = describeDueShort(item.effectiveDue, item.status, today);
  const issued = shortDateOf(r.issued_on, today);
  const acts = actionsFor(item.status);
  const proceeding = r.module === "proceedings";
  const canDraft = proceeding && acts.draft;
  const canDate = proceeding && !item.effectiveDue && acts.editManualDueDate;
  const limitationSoon = item.rank === 2;
  const stop = (f: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); f(); };
  return (
    <tr className="row-link att-row" onClick={open} {...nav}>
      <td className="wrap">
        <span className="att-client">
          {r.client_name}
          {r.has_note ? <span className="att-note" title={`${r.note_preview ?? ""}${(r.note_preview?.length ?? 0) >= 120 ? "…" : ""}`}><Icon name="note" /></span> : null}
        </span>
        <div className="sub mono">{[r.client_code, r.pan_masked].filter(Boolean).join(" · ")}</div>
      </td>
      <td className="wrap">
        <span className={`pill ${sectionTone(r)}`} title={r.title}>{sectionLabel(r)}</span><PendingDocs count={pendingOf(r)} />
        <div className="sub">{MODULE_NOUN[r.module]}{r.assessment_year ? ` · AY ${r.assessment_year}` : ""}</div>
      </td>
      <td>{issued ? <span className="num">{issued}</span> : <span className="muted" title="No issued date stated">—</span>}</td>
      <td>
        <span className={`due ${due.tone}`}>{due.date}{due.suffix ? <span className="att-suffix"> {due.suffix}</span> : null}</span>
        {!item.effectiveDue && due.tone === "muted" && !isSettled(item.status) ? <span className="unverified">unverified</span> : null}
        {r.manual_due_date ? <div className="sub">manual</div> : null}
        {limitationSoon ? <div className="sub due warning">limitation {shortDateOf(r.limitation_date, today)}</div> : null}
        {!item.effectiveDue && r.suggested_due_date ? <div className="sub suggested">suggested {shortDateOf(r.suggested_due_date, today)}</div> : null}
      </td>
      <td className="att-owner">
        {owning
          ? <OwnerSelect module={r.module} id={r.id} current={r.assignee} onDone={() => onOwn(false)} />
          : <button type="button" className="att-avatar-btn" title={r.assignee ? `${r.assignee} — change` : "Assign"}
                    onClick={stop(() => onOwn(true))}><Avatar name={r.assignee} /></button>}
      </td>
      <td className="att-stage">
        <span className="att-stage-pill"><StatusPill status={item.status} /></span>
        <span className="actions att-hover">
          <a className="btn small" href={href({ name: "item", module: r.module, id: r.id })} onClick={(e) => e.stopPropagation()}>View</a>
          <button className="btn small" disabled={!canDraft} onClick={stop(onDraft)}
                  title={canDraft ? "Draft a reply to the latest open notice" : "Drafts are for open proceedings"}>Draft</button>
          <button className="btn small" disabled={!canDate} onClick={stop(onDate)}
                  title={canDate ? "Ask Claude for the due date in the notice" : "Only for an open proceeding with no due date"}>✦ Date</button>
          <button className="btn small" onClick={stop(() => onOwn(true))}>Assign</button>
        </span>
      </td>
    </tr>
  );
}

/** The newest open communication of a proceeding: what Draft and ✦ Date act on. */
async function latestOpenNotice(proceedingId: string) {
  const p = await api.proceeding(proceedingId);
  const open = p.communications.filter((c) => ["open", "adjournment_sought", "unknown"].includes(c.status));
  open.sort((a, b) => (b.issued_on ?? "").localeCompare(a.issued_on ?? ""));
  return open[0] ?? null;
}

// ------------------------------------------------------------------ screen

export default function AttentionScreen() {
  const [f, setF] = usePersistedFilters<AttentionFilters>("attention", DEFAULT_FILTERS, migrateAttentionFilters);
  const [searchText, setSearchText] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [searchText]);
  const [exporting, setExporting] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [owning, setOwning] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ mode: "save" } | { mode: "rename"; view: SavedView<AttentionFilters> } | null>(null);
  const [deleting, setDeleting] = useState<SavedView<AttentionFilters> | null>(null);
  const saved = useSavedViews<AttentionFilters>("attention", migrateAttentionFilters);
  const owners = useOwners();
  const draft = useDraft();
  const [draftSource, setDraftSource] = useState<string | null>(null);

  const clients = useClients("");
  const q = useWorkItems({ client_ids: f.clientId ? [f.clientId] : null, assessment_year: f.ay || null, module: f.module || null, status: f.status || null });
  const ranked = useAttention(q.data);
  const today = useMemo(() => todayIst(), [q.data]);

  // The filter bar beyond the core's filters: owner and search.
  const afterBar = useMemo(() => {
    const me = owners.me?.toLowerCase() ?? null;
    return ranked.filter(({ row: r }) => {
      if (f.owner === MINE ? (!me || r.assignee?.toLowerCase() !== me) : f.owner && r.assignee !== f.owner) return false;
      if (search) {
        const hay = [r.client_name, r.client_code, r.pan_masked, r.title, r.reference, r.section].filter(Boolean).join("\n").toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });
  }, [ranked, f.owner, owners.me, search]);
  const counts = useMemo(() => countWindows(afterBar.map((i) => i.row), today), [afterBar, today]);

  // Windows, tiles and chips all AND together; the ranking never changes
  // (docs/18 §2: the chip bar is the only place a window is chosen).
  const issuedDays = windowDays(f.issued);
  const dueDays = windowDays(f.due);
  const limitationDays = f.limitation ? Number(f.limitation) : null;
  const matching = useMemo(() => afterBar.filter(({ row }) =>
    inTileFilter(row, f.tile, today)
    && (!issuedDays || inWindow(row, "issued", issuedDays, today))
    && (!dueDays || inWindow(row, "due", dueDays, today))
    && (!f.notViewedByAo || row.not_viewed_by_ao)
    && (limitationDays === null || inLimitation(row, limitationDays, today))),
  [afterBar, f.tile, issuedDays, dueDays, f.notViewedByAo, limitationDays, today]);
  const visible = useMemo(() => matching.slice(0, limit), [matching, limit]);
  useEffect(() => { setLimit(PAGE); }, [f.clientId, f.ay, f.module, f.status, f.owner, f.tile, f.issued, f.due, f.notViewedByAo, f.limitation, search]);

  const years = useMemo(
    () => [...new Set((q.data ?? []).map((r) => r.assessment_year).filter((y): y is string => !!y))].sort().reverse(),
    [q.data]);
  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "Client";

  // A tile click applies the matching chip (docs/18 §2 25.5): two tiles
  // are a filter of their own, the other two toggle a chip.
  const tileActive = (t: RiskTile) =>
    t === "ao" ? f.notViewedByAo : t === "limitation60" ? f.limitation === "60" : f.tile === t;
  const pickTile = (t: RiskTile) => setF((cur) => {
    if (t === "ao") return { ...cur, notViewedByAo: !cur.notViewedByAo };
    if (t === "limitation60") return { ...cur, limitation: cur.limitation === "60" ? "" : "60" };
    return { ...cur, tile: cur.tile === t ? "" : t };
  });
  const clearAll = () => { setF(DEFAULT_FILTERS); setSearchText(""); setSearch(""); };
  const clearWindow = () => setF({ tile: "", issued: "", due: "", notViewedByAo: false, limitation: "" });

  const chips: Chip[] = [];
  if (f.clientId) chips.push({ key: "client", label: clientName(f.clientId), clear: () => setF({ clientId: "" }) });
  if (f.ay) chips.push({ key: "ay", label: `AY ${f.ay}`, clear: () => setF({ ay: "" }) });
  if (f.module) chips.push({ key: "module", label: MODULE_LABEL[f.module], clear: () => setF({ module: "" }) });
  if (f.status) chips.push({ key: "status", label: STATUS_LABEL[f.status as keyof typeof STATUS_LABEL] ?? f.status, clear: () => setF({ status: "" }) });
  if (f.owner) chips.push({ key: "owner", label: f.owner === MINE ? "Mine" : `Owner: ${f.owner}`, clear: () => setF({ owner: "" }) });
  const tileLabel = f.tile === "nodate" ? "No due date" : f.tile ? RISK_LABEL[f.tile] : "";
  if (f.tile) chips.push({ key: "tile", label: tileLabel, clear: () => setF({ tile: "" }) });
  if (issuedDays) chips.push({ key: "issued", label: windowSummary("issued", issuedDays), clear: () => setF({ issued: "" }) });
  if (dueDays) chips.push({ key: "due", label: windowSummary("due", dueDays), clear: () => setF({ due: "" }) });
  if (f.notViewedByAo) chips.push({ key: "ao", label: "Not viewed by AO", clear: () => setF({ notViewedByAo: false }) });
  if (f.limitation) chips.push({ key: "limitation", label: `Limitation ≤ ${f.limitation}d`, clear: () => setF({ limitation: "" }) });

  const noun = f.module === "proceedings" ? "notice" : "item";
  const summary = [
    plural(matching.length, noun),
    f.status ? STATUS_LABEL[f.status as keyof typeof STATUS_LABEL] : "Open",
    ...(f.tile ? [tileLabel] : []),
    ...(issuedDays ? [windowSummary("issued", issuedDays)] : []),
    ...(dueDays ? [windowSummary("due", dueDays)] : []),
  ].join(" · ");
  const sortLabel = "Sort: urgency";

  const openAt = useCallback((i: number) => {
    const it = visible[i];
    if (it) navigate({ name: "item", module: it.row.module, id: it.row.id });
  }, [visible]);
  const nav = useRowNav(visible.length, openAt);

  // The ranking holds whatever window is chosen (docs/18 §2).
  const groups = useMemo(() => {
    const out: { rank: Rank | null; items: { item: RankedItem; index: number }[] }[] = [];
    visible.forEach((item, index) => {
      const rank: Rank | null = item.rank;
      const last = out[out.length - 1];
      if (last && last.rank === rank) last.items.push({ item, index });
      else out.push({ rank, items: [{ item, index }] });
    });
    return out;
  }, [visible]);

  const startDraft = async (row: WorkItemRow) => {
    try {
      const c = await latestOpenNotice(row.id);
      if (!c) { toast("No open notice on this proceeding to draft a reply to."); return; }
      setDraftSource(c.documents.find((d) => d.state === "stored")?.id ?? null);
      await draft.open(c.reference_id);
    } catch (e) { toastError(describeError(e)); }
  };
  const askDate = async (row: WorkItemRow) => {
    try {
      const c = await latestOpenNotice(row.id);
      if (!c) { toast("No open notice on this proceeding to read a date from."); return; }
      const a = await api.suggestDueDate(c.reference_id);
      toast(a.due_date ? `Suggested ${a.due_date}${a.basis ? `: ${a.basis}` : ""}` : (a.basis ?? "No deadline was found in this notice."));
      void q.refetch();
    } catch (e) { toastError(describeError(e)); }
  };

  const noneAtAll = !ranked.length && !chips.length;
  const windowActive = !!(f.tile || f.issued || f.due || f.notViewedByAo || f.limitation);
  const windowText = chips.filter((c) => ["tile", "issued", "due", "ao", "limitation"].includes(c.key)).map((c) => c.label).join(" and ");

  return (
    <Page>
      <PageHead title="Attention" meta={q.loading && !q.data ? "Loading" : plural(ranked.length, "open item")}>
        <button className="btn" onClick={() => setExporting(true)}><Icon name="upload" /><span>Export</span></button>
      </PageHead>
      <PageBody>
        <SyncLineView today={today} />
        <RiskStrip counts={counts.tiles} active={tileActive} onPick={pickTile} />

        <div className="toolbar">
          <select className="select" value={f.clientId} aria-label="Client" onChange={(e) => setF({ clientId: e.target.value })}>
            <option value="">All clients</option>
            {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" value={f.ay} onChange={(e) => setF({ ay: e.target.value })} aria-label="Assessment year">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>AY {y}</option>)}
          </select>
          <select className="select" value={f.module} onChange={(e) => setF({ module: e.target.value as "" | Module })} aria-label="Module">
            <option value="">All modules</option>
            {MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}</option>)}
          </select>
          <select className="select" value={f.status} onChange={(e) => setF({ status: e.target.value })} aria-label="Status">
            <option value="">Open statuses</option>
            {STATUSES.filter((s) => !isSettled(s)).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="select" value={f.owner} onChange={(e) => setF({ owner: e.target.value })} aria-label="Owner">
            <option value="">Anyone</option>
            <option value={MINE} disabled={!owners.me}>Mine</option>
            {owners.names.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <label className="search">
            <Icon name="search" />
            <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Client, PAN, section, reference"
                   aria-label="Search the list" onKeyDown={(e) => { if (e.key === "Escape") setSearchText(""); }} />
          </label>
          <span className="grow" />
          <span className="meta">↑ ↓ to move · Enter to open</span>
        </div>
        <div className="att-windows" role="group" aria-label="Windows and chips">
          <WindowGroup kind="issued" counts={counts.issued} active={f.issued} onPick={(v) => setF({ issued: v })} />
          <WindowGroup kind="due" counts={counts.due} active={f.due} onPick={(v) => setF({ due: v })} />
          <span className="att-window-sep" />
          <button type="button" className={`chip${f.notViewedByAo ? " on" : ""}`} aria-pressed={f.notViewedByAo}
                  onClick={() => setF({ notViewedByAo: !f.notViewedByAo })}>Not viewed by AO<span className="att-window-count">{counts.tiles.ao}</span></button>
          <LimitationChip value={f.limitation} onPick={(v) => setF({ limitation: v })} />
        </div>
        <Chips chips={chips} onClearAll={clearAll} />
        <HintLine issued={f.issued} due={f.due} today={today} />

        <div className="att-card">
          <div className="att-card-head">
            <span>{summary}</span>
            <span>{sortLabel}</span>
          </div>
          <ViewsRow views={saved.views} current={f} full={saved.full}
                    onAll={clearAll}
                    onPick={(v) => { setF({ ...DEFAULT_FILTERS, ...v.filters }); setSearchText(""); setSearch(""); }}
                    onSave={() => setNaming({ mode: "save" })}
                    onRename={(v) => setNaming({ mode: "rename", view: v })}
                    onDelete={(v) => setDeleting(v)} />
          {q.error ? (
            <div className="banner danger" role="alert">{q.error}</div>
          ) : q.loading && !q.data ? (
            <div className="loading">Loading</div>
          ) : !visible.length ? (
            noneAtAll ? (
              <EmptyState title="Nothing needs attention."
                          body="Open proceedings, demands, returns and forms appear here once a sweep has run. Settled items stay in client detail and in exports."
                          action={<a className="btn" href={href({ name: "ingestion" })}>Go to ingestion</a>} />
            ) : windowActive && afterBar.length ? (
              <EmptyState title={`Nothing in ${windowText}.`}
                          body="No open item falls in this window with the current filters. The other windows above still count theirs."
                          action={<button className="btn" onClick={clearWindow}>Show all open items</button>} />
            ) : (
              <EmptyState title="Nothing open matches these filters."
                          body="Clear a filter to see the rest of the open items."
                          action={<button className="btn" onClick={clearAll}>Clear all</button>} />
            )
          ) : (
            <>
              <table className="table att-table" onKeyDown={nav.onKeyDown} aria-label="Items needing attention">
                <colgroup>
                  <col style={{ width: "27.8%" }} /><col style={{ width: "13%" }} /><col style={{ width: "13%" }} />
                  <col style={{ width: "16.7%" }} /><col style={{ width: "11.1%" }} /><col style={{ width: "18.4%" }} />
                </colgroup>
                <thead><tr>
                  <th>Client · PAN</th><th>Section</th><th>Issued</th><th>Due</th><th>Owner</th><th>Stage</th>
                </tr></thead>
                {groups.map((g, gi) => (
                  <tbody key={`${g.rank ?? "all"}-${gi}`}>
                    {g.rank ? (
                      <tr className="group"><th colSpan={6} scope="rowgroup">
                        <span className={`dot ${RANK_TONE[g.rank]}`} />{RANK_LABEL[g.rank]}<span className="count">{g.items.length}</span>
                      </th></tr>
                    ) : null}
                    {g.items.map(({ item, index }) => {
                      const k = `${item.row.module}:${item.row.id}`;
                      return <Row key={k} item={item} nav={nav.rowProps(index)} today={today} owning={owning === k}
                                  onOwn={(o) => setOwning(o ? k : null)}
                                  onDraft={() => { void startDraft(item.row); }} onDate={() => { void askDate(item.row); }} />;
                    })}
                  </tbody>
                ))}
              </table>
              {matching.length > visible.length ? (
                <div className="table-foot">
                  <span className="meta">{visible.length} of {matching.length} shown</span>
                  <button className="btn small" onClick={() => setLimit((n) => n + PAGE)}>Show {Math.min(PAGE, matching.length - visible.length)} more</button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </PageBody>
      {exporting ? (
        <ExportDialog onClose={() => setExporting(false)} choices={{
          view: { items: matching.map((i) => [i.row.module, i.row.id] as [string, string]), label: `attention list · ${[...chips.map((c) => c.label), ...(search ? [`search “${searchText.trim()}”`] : [])].join(" · ") || "all open items"}`, sheet: "Attention" },
        }} />
      ) : null}
      {naming ? (
        <NameDialog title={naming.mode === "save" ? "Save view" : "Rename view"}
                    initial={naming.mode === "rename" ? naming.view.name : ""}
                    onClose={() => setNaming(null)}
                    onSave={(name) => {
                      if (naming.mode === "save") {
                        if (saved.save(name, f)) toast(`View “${name.trim()}” saved.`);
                        else toastError("Twelve saved views is the limit. Delete one first.");
                      } else saved.rename(naming.view.id, name);
                      setNaming(null);
                    }} />
      ) : null}
      {deleting ? (
        <Confirm title="Delete view" body={`Delete the saved view “${deleting.name}”? The items it shows are not touched.`}
                 confirmLabel="Delete" danger onClose={() => setDeleting(null)}
                 onConfirm={() => { saved.remove(deleting.id); setDeleting(null); }} />
      ) : null}
      {draft.draft ? <DraftDrawer draft={draft.draft} busy={draft.busy} sourceDocumentId={draftSource} onClose={draft.close}
                                  onSave={(t) => { void draft.saveText(t); }} onReviewed={(r) => { void draft.setReviewed(r); }} /> : null}
    </Page>
  );
}
