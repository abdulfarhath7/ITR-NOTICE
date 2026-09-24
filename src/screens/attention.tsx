/** Screen 1 — Attention (docs/16 §1). Top to bottom: the sync line, the
 *  needs-action strip, the filter bar with its chips, the Issued and Due
 *  lanes, then the list card with saved views. Every count is computed
 *  after the filter bar and before the tile or bucket selection, so a
 *  selected bucket never shrinks its own number to zero. */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useDraft } from "../hooks/use-draft";
import { useOwners } from "../hooks/use-owners";
import { useRowNav, type RowNavProps } from "../hooks/use-row-nav";
import { useAttention, useWorkItems } from "../hooks/use-work-items";
import { api, describeError } from "../lib/api";
import { RANK_LABEL, RANK_TONE, type Rank, type RankedItem } from "../lib/attention";
import {
  BUCKET_LABEL, BUCKET_SUMMARY, DUE_BUCKETS, ISSUED_BUCKETS, TILES, TILE_LABEL, TILE_TONE,
  countBuckets, dueBucket, effectiveDue, inTile, issuedBucket,
  type DueBucket, type IssuedBucket, type Tile,
} from "../lib/buckets";
import { parseDate, todayIst, type Ymd } from "../lib/dates";
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

// ------------------------------------------------------------------ strip and lanes

function Strip({ counts, active, onPick }: { counts: Record<Tile, number>; active: "" | Tile; onPick: (t: Tile) => void }) {
  return (
    <div className="att-strip" role="group" aria-label="Needs action">
      {TILES.map((t) => (
        <button key={t} type="button" className={`att-tile ${TILE_TONE[t]}`} aria-pressed={active === t} onClick={() => onPick(t)}>
          <span className="label">{TILE_LABEL[t]}</span>
          <span className="value">{counts[t]}</span>
        </button>
      ))}
    </div>
  );
}

function Bucket({ label, count, active, warn, onClick }: {
  label: string; count: number; active: boolean; warn?: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className={`att-bucket${warn && !active && count > 0 ? " warning" : ""}`} aria-pressed={active} onClick={onClick}>
      <span className="label">{label}</span>
      <span className="value">{count}</span>
    </button>
  );
}

function Lanes({ issued, due, activeIssued, activeDue, onIssued, onDue }: {
  issued: Record<IssuedBucket, number>; due: Record<DueBucket, number>;
  activeIssued: "" | IssuedBucket; activeDue: "" | DueBucket;
  onIssued: (b: IssuedBucket) => void; onDue: (b: DueBucket) => void;
}) {
  return (
    <div className="att-lanes">
      <section className="att-lane" aria-label="Issued">
        <h3 className="att-lane-label"><Icon name="calendar" />Issued</h3>
        <div className="att-buckets cols-3">
          {ISSUED_BUCKETS.map((b) => (
            <Bucket key={b} label={BUCKET_LABEL[b]} count={issued[b]} active={activeIssued === b} onClick={() => onIssued(b)} />
          ))}
        </div>
      </section>
      <section className="att-lane" aria-label="Due">
        <h3 className="att-lane-label"><Icon name="clock" />Due</h3>
        <div className="att-buckets cols-5">
          {DUE_BUCKETS.map((b) => (
            <Bucket key={b} label={BUCKET_LABEL[b]} count={due[b]} active={activeDue === b} warn={b === "next7"} onClick={() => onDue(b)} />
          ))}
          <a className="att-bucket link" href={href({ name: "calendar" })}>
            <span className="label"><Icon name="calendar" />Calendar</span>
            <span className="open">Open</span>
          </a>
        </div>
      </section>
    </div>
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
               onKeyDown={(e) => { if (e.key === "Enter" && ok) onSave(name); }} placeholder="Rao – scrutiny" />
        <span className="hint">Saves the selects, owner, tile and buckets. Search text is not saved.</span>
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
          {r.has_note ? <span className="att-note" title="Has a note — open the item to read it"><Icon name="note" /></span> : null}
        </span>
        <div className="sub mono">{[r.client_code, r.pan_masked].filter(Boolean).join(" · ")}</div>
      </td>
      <td className="wrap">
        <span className={`pill ${sectionTone(r)}`} title={r.title}>{sectionLabel(r)}</span>
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
  const [f, setF] = usePersistedFilters<AttentionFilters>("attention", DEFAULT_FILTERS);
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
  const saved = useSavedViews<AttentionFilters>("attention");
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
  const counts = useMemo(() => countBuckets(afterBar.map((i) => i.row), today), [afterBar, today]);

  const matching = useMemo(() => {
    let out = afterBar.filter(({ row }) =>
      (!f.tile || inTile(row, f.tile, today))
      && (!f.issued || issuedBucket(row, today) === f.issued)
      && (!f.due || dueBucket(row, today) === f.due));
    // Inside a bucket: soonest due first, or newest issued first.
    const dayOf = (iso: string | null) => { const d = parseDate(iso); return d ? Date.UTC(d.y, d.m - 1, d.d) : 0; };
    if (f.due) out = [...out].sort((a, b) => dayOf(effectiveDue(a.row)) - dayOf(effectiveDue(b.row)));
    else if (f.issued) out = [...out].sort((a, b) => dayOf(b.row.issued_on) - dayOf(a.row.issued_on));
    return out;
  }, [afterBar, f.tile, f.issued, f.due, today]);
  const visible = useMemo(() => matching.slice(0, limit), [matching, limit]);
  useEffect(() => { setLimit(PAGE); }, [f.clientId, f.ay, f.module, f.status, f.owner, f.tile, f.issued, f.due, search]);

  const years = useMemo(
    () => [...new Set((q.data ?? []).map((r) => r.assessment_year).filter((y): y is string => !!y))].sort().reverse(),
    [q.data]);
  const clientName = (id: string) => clients.data?.find((c) => c.id === id)?.name ?? "Client";

  const pickTile = (t: Tile) => setF((cur) => ({ ...cur, tile: cur.tile === t ? "" : t, issued: "", due: "" }));
  const pickIssued = (b: IssuedBucket) => setF((cur) => ({ ...cur, issued: cur.issued === b ? "" : b, tile: "" }));
  const pickDue = (b: DueBucket) => setF((cur) => ({ ...cur, due: cur.due === b ? "" : b, tile: "" }));
  const clearAll = () => { setF(DEFAULT_FILTERS); setSearchText(""); setSearch(""); };
  const clearWindow = () => setF({ tile: "", issued: "", due: "" });

  const chips: Chip[] = [];
  if (f.clientId) chips.push({ key: "client", label: clientName(f.clientId), clear: () => setF({ clientId: "" }) });
  if (f.ay) chips.push({ key: "ay", label: `AY ${f.ay}`, clear: () => setF({ ay: "" }) });
  if (f.module) chips.push({ key: "module", label: MODULE_LABEL[f.module], clear: () => setF({ module: "" }) });
  if (f.status) chips.push({ key: "status", label: STATUS_LABEL[f.status as keyof typeof STATUS_LABEL] ?? f.status, clear: () => setF({ status: "" }) });
  if (f.owner) chips.push({ key: "owner", label: f.owner === MINE ? "Mine" : `Owner: ${f.owner}`, clear: () => setF({ owner: "" }) });
  if (f.tile) chips.push({ key: "tile", label: TILE_LABEL[f.tile], clear: () => setF({ tile: "" }) });
  if (f.issued) chips.push({ key: "issued", label: BUCKET_SUMMARY[f.issued], clear: () => setF({ issued: "" }) });
  if (f.due) chips.push({ key: "due", label: BUCKET_SUMMARY[f.due], clear: () => setF({ due: "" }) });

  const noun = f.module === "proceedings" ? "notice" : "item";
  const summary = [
    plural(matching.length, noun),
    f.status ? STATUS_LABEL[f.status as keyof typeof STATUS_LABEL] : "Open",
    ...(f.tile ? [TILE_LABEL[f.tile]] : []),
    ...(f.issued ? [BUCKET_SUMMARY[f.issued]] : []),
    ...(f.due ? [BUCKET_SUMMARY[f.due]] : []),
  ].join(" · ");
  const sortLabel = f.due ? "Sort: due date ↑" : f.issued ? "Sort: issued date ↓" : "Sort: urgency";

  const openAt = useCallback((i: number) => {
    const it = visible[i];
    if (it) navigate({ name: "item", module: it.row.module, id: it.row.id });
  }, [visible]);
  const nav = useRowNav(visible.length, openAt);

  // Group headers by rank only in the default order; inside a bucket the
  // rows are sorted by date and a rank header would split them.
  const grouped = !f.issued && !f.due;
  const groups = useMemo(() => {
    const out: { rank: Rank | null; items: { item: RankedItem; index: number }[] }[] = [];
    visible.forEach((item, index) => {
      const rank = grouped ? item.rank : null;
      const last = out[out.length - 1];
      if (last && last.rank === rank) last.items.push({ item, index });
      else out.push({ rank, items: [{ item, index }] });
    });
    return out;
  }, [visible, grouped]);

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
  const windowActive = !!(f.tile || f.issued || f.due);
  const windowLabel = f.tile ? TILE_LABEL[f.tile] : [f.issued && BUCKET_SUMMARY[f.issued], f.due && BUCKET_SUMMARY[f.due]].filter(Boolean).join(" and ");

  return (
    <Page>
      <PageHead title="Attention" meta={q.loading && !q.data ? "Loading" : plural(ranked.length, "open item")}>
        <button className="btn" onClick={() => setExporting(true)}><Icon name="upload" /><span>Export</span></button>
      </PageHead>
      <PageBody>
        <SyncLineView today={today} />
        <Strip counts={counts.tiles} active={f.tile} onPick={pickTile} />

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
        <Chips chips={chips} onClearAll={clearAll} />

        <Lanes issued={counts.issued} due={counts.due} activeIssued={f.issued} activeDue={f.due} onIssued={pickIssued} onDue={pickDue} />

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
              <EmptyState title={`Nothing in ${windowLabel}.`}
                          body="No open item falls in this window with the current filters. The other windows above still count theirs."
                          action={<button className="btn" onClick={clearWindow}>Show all windows</button>} />
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
          view: { items: matching.map((i) => [i.row.module, i.row.id] as [string, string]), label: `attention list · ${chips.map((c) => c.label).join(" · ") || "all open items"}` },
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
                                  onSave={(t) => { void draft.saveText(t); }} /> : null}
    </Page>
  );
}
