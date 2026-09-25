/** Screen 9 — Calendar (docs/19 §4; Build 2 §5 absorbed). The statutory
 *  layer comes from the portal's public calendar and the firm's own dates;
 *  the Notices layer is the open work items on their effective due (or
 *  issued) day. One state object feeds the minimized card and the
 *  full-screen overlay, so switching modes never resets anything.
 *  `today` comes from `todayIst()`, the only clock. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useClients } from "../hooks/use-clients";
import { useWorkItems } from "../hooks/use-work-items";
import { api, describeError } from "../lib/api";
import { ATTENTION_SCREEN, DEFAULT_FILTERS, type AttentionFilters } from "../lib/attention-filters";
import {
  LEGEND, MONTH_NAMES, buildStatutoryMonthGrid, clampMonth, fyLabel, fyStartYear, longDay, monthBounds, monthKey,
  nextInMonthCellIndex, shiftMonth, shortWeekday, statutoryAgendaId, statutoryDaysUntil, statutoryPillLabel, statutoryStatus,
  statutoryStatusLabel, weekdayLabels, type FirstDay, type StatutoryMonthCell,
} from "../lib/calendar-grid";
import { readCalendarPrefs, writeCalendarPrefs, type CalendarMode, type CalendarPrefs, type CalendarScope, type CalendarView, type NoticesDate } from "../lib/calendar-prefs";
import { dayTone, groupByDay, limitationByDay } from "../lib/calendar";
import { parseDate, shortDate, toIso, todayIst, type Ymd } from "../lib/dates";
import { MODULE_LABEL, plural } from "../lib/labels";
import { usePersistedFilters, writeFilters } from "../lib/persisted-filters";
import { invalidate, useQuery } from "../lib/query";
import { href, navigate } from "../lib/router";
import { sectionLabel } from "../lib/section-tone";
import { toast, toastError } from "../lib/toast";
import type { CalendarSettings, StatutoryItem, StatutoryStatus, WorkItemRow } from "../lib/types";
import { LimitationCell } from "../ui/ao-cells";
import CalendarOverlay from "../ui/calendar-overlay";
import Icon from "../ui/icons";
import { Page, PageBody, PageHead } from "../ui/page";
import { StatusPill } from "../ui/pill";

const FLASH_MS = 600;
const DOT_SLOTS = [0, 1, 2] as const;
const EMPTY: StatutoryItem[] = [];
const NO_ROWS: WorkItemRow[] = [];

// ------------------------------------------------------------------ state

export interface CalendarState {
  today: Ymd;
  todayIso: string;
  fy: number;
  firstDay: FirstDay;
  month: { y: number; m: number };
  canPrev: boolean;
  canNext: boolean;
  shift: (delta: number) => void;
  goMonth: (y: number, m: number) => void;
  jumpToday: () => void;
  selected: string | null;
  select: (iso: string | null) => void;
  focused: string | null;
  setFocused: (iso: string | null) => void;
  flashDay: string | null;
  scope: CalendarScope;
  setScope: (s: CalendarScope) => void;
  muted: ReadonlySet<string>;
  toggleMute: (cat: string) => void;
  solo: (cat: string) => void;
  showAll: () => void;
  noticesDate: NoticesDate;
  setNoticesDate: (d: NoticesDate) => void;
  mode: CalendarMode;
  setMode: (m: CalendarMode) => void;
  view: CalendarView;
  setView: (v: CalendarView) => void;
  /** Statutory + firm rows of the whole visible range, after scope, before mutes. */
  scoped: StatutoryItem[];
  /** After mutes, by ISO day. */
  byDate: ReadonlyMap<string, StatutoryItem[]>;
  /** Per-category counts for a month, after scope, before mutes (legend). */
  monthCounts: (y: number, m: number) => Record<string, number>;
  notices: ReadonlyMap<string, WorkItemRow[]>;
  limitations: ReadonlyMap<string, WorkItemRow[]>;
  noticesMuted: boolean;
  status: StatutoryStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshing: boolean;
}

export function useCalendarState(day?: string): CalendarState {
  const today = useMemo(() => todayIst(), []);
  const todayIso = toIso(today);
  const fy = fyStartYear(today);
  const [prefs, setPrefs] = useState<CalendarPrefs>(() => readCalendarPrefs());
  const patch = (p: Partial<CalendarPrefs>) => setPrefs(writeCalendarPrefs(p));
  const settingsQ = useQuery<CalendarSettings>("calendar:settings", () => api.calendarSettings());
  const firstDay: FirstDay = settingsQ.data?.first_day ?? "monday";

  const routeDay = parseDate(day);
  const [month, setMonthRaw] = useState(() => routeDay ? clampMonth(routeDay.y, routeDay.m, today) : clampMonth(today.y, today.m, today));
  const [selected, setSelected] = useState<string | null>(() => (routeDay ? toIso(routeDay) : null));
  const [focused, setFocused] = useState<string | null>(null);
  const [flashDay, setFlashDay] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);
  useEffect(() => {
    if (!routeDay) return;
    setMonthRaw(clampMonth(routeDay.y, routeDay.m, today));
    setSelected(toIso(routeDay));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  const [lo, hi] = monthBounds(today);
  const canPrev = monthKey(month.y, month.m) > monthKey(lo.y, lo.m);
  const canNext = monthKey(month.y, month.m) < monthKey(hi.y, hi.m);
  const goMonth = useCallback((y: number, m: number) => { setMonthRaw(clampMonth(y, m, today)); setFocused(null); }, [today]);
  const shift = useCallback((delta: number) => { const n = shiftMonth(month.y, month.m, delta); goMonth(n.y, n.m); setSelected(null); setFlashDay(null); }, [month, goMonth]);
  const jumpToday = useCallback(() => { goMonth(today.y, today.m); setSelected(todayIso); setFocused(todayIso); }, [goMonth, today, todayIso]);

  // The whole range the card can show: this FY to the end of the next.
  const from = `${lo.y}-04-01`;
  const to = `${hi.y}-03-31`;
  const q = useQuery<StatutoryItem[]>(`statutory:${prefs.scope}`, () => api.listStatutory(from, to, prefs.scope));
  const statusQ = useQuery<StatutoryStatus>("statutory:status", () => api.statutoryStatus());
  const scoped = q.data ?? EMPTY;
  const muted = useMemo(() => new Set(prefs.muted), [prefs.muted]);
  const byDate = useMemo(() => {
    const m = new Map<string, StatutoryItem[]>();
    for (const it of scoped) {
      if (muted.has(it.category)) continue;
      const l = m.get(it.due_on);
      if (l) l.push(it); else m.set(it.due_on, [it]);
    }
    return m;
  }, [scoped, muted]);
  const monthCounts = useCallback((y: number, m: number) => {
    const prefix = `${y}-${String(m).padStart(2, "0")}`;
    const out: Record<string, number> = {};
    for (const c of LEGEND) out[c.id] = 0;
    for (const it of scoped) if (it.due_on.startsWith(prefix)) out[it.category] = (out[it.category] ?? 0) + 1;
    return out;
  }, [scoped]);

  // Notices layer: the Attention filters' client and module, as Build 2.
  const [filters] = usePersistedFilters<AttentionFilters>(ATTENTION_SCREEN, DEFAULT_FILTERS);
  const items = useWorkItems({ client_ids: filters.clientId ? [filters.clientId] : null, module: filters.module || null });
  const notices = useMemo(() => groupByDay(items.data ?? [], prefs.noticesDate), [items.data, prefs.noticesDate]);
  const limitations = useMemo(() => (prefs.noticesDate === "due" ? limitationByDay(items.data ?? []) : new Map<string, WorkItemRow[]>()), [items.data, prefs.noticesDate]);

  const select = useCallback((iso: string | null) => {
    setSelected(iso);
    setFocused(iso);
    if (!iso) { setFlashDay(null); return; }
    setFlashDay(iso);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashDay((d) => (d === iso ? null : d)), FLASH_MS);
  }, []);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const out = await api.refreshStatutory();
      const failed = out.filter((o) => o.status === "failed");
      if (failed.length === out.length) toastError(`Portal calendar unavailable: ${failed[0]?.error ?? "no answer"}`);
      else toast(`Calendar refreshed: ${out.reduce((n, o) => n + o.added, 0)} added, ${out.reduce((n, o) => n + o.extended, 0)} extended.`);
      invalidate("statutory");
      invalidate("updates");
    } catch (e) { toastError(describeError(e)); }
    finally { setRefreshing(false); }
  }, []);

  return {
    today, todayIso, fy, firstDay, month, canPrev, canNext, shift, goMonth, jumpToday,
    selected, select, focused, setFocused, flashDay,
    scope: prefs.scope, setScope: (s) => { patch({ scope: s }); setSelected(null); },
    muted,
    toggleMute: (c) => patch({ muted: muted.has(c) ? prefs.muted.filter((x) => x !== c) : [...prefs.muted, c] }),
    solo: (c) => patch({ muted: [...LEGEND.map((l) => l.id), "notices"].filter((x) => x !== c) }),
    showAll: () => patch({ muted: [] }),
    noticesDate: prefs.noticesDate, setNoticesDate: (d) => patch({ noticesDate: d }),
    mode: prefs.mode, setMode: (m) => patch({ mode: m }),
    view: prefs.view, setView: (v) => patch({ view: v }),
    scoped, byDate, monthCounts, notices, limitations, noticesMuted: muted.has("notices"),
    status: statusQ.data ?? null, loading: q.loading && !q.data, error: q.error ?? null, refresh, refreshing,
  };
}

// ------------------------------------------------------------------ pieces

export function CategoryDot({ category, muted = false }: { category: string; muted?: boolean }) {
  return <span className={`stat-dot${muted ? " is-empty" : ""}`} style={{ "--cat": `var(--cat-${category})` } as React.CSSProperties} aria-hidden="true" />;
}

function categoriesOf(items: readonly StatutoryItem[]): string[] {
  const present = new Set(items.map((i) => i.category));
  return LEGEND.map((l) => l.id).filter((id) => present.has(id));
}

/** The Notices count pill, Build 2 style: danger past, warning today/tomorrow. */
export function NoticesPill({ iso, count, today }: { iso: string; count: number; today: Ymd }) {
  if (!count) return null;
  const d = parseDate(iso);
  const tone = d ? dayTone(d, today) : "normal";
  return <span className={`pill ${tone} stat-cal-notices`} title={plural(count, "notice")}>{count}</span>;
}

function DayTile({ cell, items, notices, cal, monthLabel, onSelect }: {
  cell: StatutoryMonthCell; items: readonly StatutoryItem[]; notices: number; cal: CalendarState; monthLabel: string; onSelect: (iso: string) => void;
}) {
  if (!cell.inMonth) {
    return <div role="presentation" className="stat-cal-cell is-outside" aria-hidden="true"><span className="stat-cal-cell-num">{cell.day}</span></div>;
  }
  const cats = categoriesOf(items);
  const isToday = cell.iso === cal.todayIso;
  const label = `${longDay(cell.iso)}${items.length ? `, ${plural(items.length, "deadline")}` : ""}${notices ? `, ${plural(notices, "notice")} due` : ""}`;
  void monthLabel;
  return (
    <button type="button" role="gridcell" className="stat-cal-cell" data-cal-iso={cell.iso}
            tabIndex={cal.focused === cell.iso || (!cal.focused && isToday) ? 0 : -1}
            aria-current={isToday ? "date" : undefined} aria-selected={cal.selected === cell.iso} aria-label={label}
            data-today={isToday ? "true" : undefined} data-selected={cal.selected === cell.iso ? "true" : undefined}
            onClick={() => onSelect(cell.iso)}>
      <span className="stat-cal-cell-num">{cell.day}</span>
      <span className="stat-cal-cell-foot">
        <span className="stat-cal-dots">{DOT_SLOTS.map((s) => cats[s] ? <CategoryDot key={s} category={cats[s]} /> : <span key={s} className="stat-dot is-empty" />)}</span>
        {cal.noticesMuted ? null : <NoticesPill iso={cell.iso} count={notices} today={cal.today} />}
      </span>
    </button>
  );
}

/** One statutory row of the agenda (docs/19 §4). */
export function StatutoryRow({ item, cal }: { item: StatutoryItem; cal: CalendarState }) {
  const status = statutoryStatus(item.due_on, cal.today);
  return (
    <div className="stat-cal-row" title={item.title}>
      <CategoryDot category={item.category} />
      <span className="stat-cal-row-title">{statutoryPillLabel(item.title)}</span>
      {cal.scope === "applies" && item.applies_count !== null ? <span className="stat-cal-row-applies">applies to {plural(item.applies_count, "client")}</span> : null}
      {item.original_on ? (
        <span className="stat-cal-row-ext"><s>{shortDate(parseDate(item.original_on) ?? cal.today, cal.today)}</s> Extended to {shortDate(parseDate(item.due_on) ?? cal.today, cal.today)}{item.circular ? ` · Circular ${item.circular}` : ""}</span>
      ) : null}
      <span className={`stat-cal-status ${status}`}>{statutoryStatusLabel(item.due_on, cal.today)}</span>
    </div>
  );
}

/** The Notices row: count pill, first two, and Open (docs/19 §4). */
export function NoticesRow({ iso, rows, cal, expanded = false }: { iso: string; rows: WorkItemRow[]; cal: CalendarState; expanded?: boolean }) {
  if (!rows.length) return null;
  const first = rows.slice(0, expanded ? rows.length : 2).map((r) => `${r.client_name} ${sectionLabel(r)}`).join(", ");
  const more = rows.length - (expanded ? rows.length : 2);
  const days = statutoryDaysUntil(iso, cal.today);
  // Within 30 days: Attention with the Due window that holds the day; beyond, this day list (Q64).
  const open = () => {
    if (cal.noticesDate === "due" && days >= 0 && days < 30) {
      const due = days < 7 ? "7" : days < 15 ? "15" : "30";
      writeFilters(ATTENTION_SCREEN, { ...DEFAULT_FILTERS, due });
      navigate({ name: "attention" });
    } else {
      cal.select(iso);
    }
  };
  return (
    <div className="stat-cal-row">
      <NoticesPill iso={iso} count={rows.length} today={cal.today} />
      <span className="stat-cal-row-title">Notices {cal.noticesDate === "due" ? "due" : "issued"} · {first}{more > 0 ? `, +${more}` : ""}</span>
      <button type="button" className="btn small" onClick={open}>Open</button>
    </div>
  );
}

function NoticesList({ rows, limits }: { rows: WorkItemRow[]; limits: WorkItemRow[] }) {
  return (
    <div className="stat-cal-rows">
      {rows.map((r) => (
        <div key={`${r.module}:${r.id}`} className="stat-cal-row">
          <span className="stat-cal-row-title">{r.client_name} · {sectionLabel(r)}{r.assessment_year ? ` · AY ${r.assessment_year}` : ""}</span>
          <StatusPill status={r.status} />
          <a className="btn small" href={href({ name: "item", module: r.module, id: r.id })}>View</a>
        </div>
      ))}
      {limits.map((r) => (
        <div key={`lim:${r.id}`} className="stat-cal-row">
          <span className="pill" title="Limitation date (Q56)">Limitation</span>
          <span className="stat-cal-row-title">{r.client_name} · {sectionLabel(r)}</span>
          <LimitationCell isAssessment date={r.limitation_date} />
          <a className="btn small" href={href({ name: "item", module: r.module, id: r.id })}>View</a>
        </div>
      ))}
    </div>
  );
}

export function AgendaGroup({ iso, cal, expandNotices = false }: { iso: string; cal: CalendarState; expandNotices?: boolean }) {
  const items = cal.byDate.get(iso) ?? EMPTY;
  const rows = cal.noticesMuted ? NO_ROWS : (cal.notices.get(iso) ?? NO_ROWS);
  const limits = cal.noticesMuted ? NO_ROWS : (cal.limitations.get(iso) ?? NO_ROWS);
  const d = parseDate(iso);
  const past = iso < cal.todayIso;
  const isToday = iso === cal.todayIso;
  const selected = cal.selected === iso;
  return (
    <section id={statutoryAgendaId(iso)}
             className={`stat-cal-group${selected ? " is-selected" : ""}${cal.flashDay === iso ? " is-flash" : ""}${past && !selected ? " is-past" : ""}`}>
      <div className={`stat-cal-group-day${isToday ? " is-today" : ""}`} aria-hidden="true">
        <span className="stat-cal-group-dow">{isToday ? "Today" : shortWeekday(iso)}</span>
        <span className="stat-cal-group-num">{d?.d ?? ""}</span>
      </div>
      <div className="stat-cal-rows">
        {items.map((it) => <StatutoryRow key={it.id} item={it} cal={cal} />)}
        {expandNotices || selected ? <NoticesList rows={rows} limits={limits} /> : <NoticesRow iso={iso} rows={rows} cal={cal} />}
        {!items.length && !rows.length && !limits.length ? <span className="stat-cal-empty">Nothing falls due on this day.</span> : null}
      </div>
    </section>
  );
}

/** Legend with counts, mute, Shift-solo and the Notices row (docs/19 §4). */
export function Legend({ cal, counts, noticesCount }: { cal: CalendarState; counts: Record<string, number>; noticesCount: number }) {
  return (
    <div className="stat-cal-legend" role="group" aria-label="Legend">
      <p className="stat-cal-legend-cap">Legend</p>
      {LEGEND.map((c) => {
        const muted = cal.muted.has(c.id);
        return (
          <button key={c.id} type="button" className={`stat-cal-legend-row${muted ? " is-muted" : ""}`} aria-pressed={!muted}
                  title={`${c.label} · click to mute, Shift-click to show only this`}
                  onClick={(e) => (e.shiftKey ? cal.solo(c.id) : cal.toggleMute(c.id))}>
            <CategoryDot category={c.id} muted={muted} />
            <span className="stat-cal-legend-name">{c.label}</span>
            <span className="stat-cal-legend-n num">{counts[c.id] ?? 0}</span>
          </button>
        );
      })}
      {cal.muted.size ? <button type="button" className="link-btn stat-cal-legend-link" onClick={cal.showAll}>Show all</button> : null}
      <span className="stat-cal-legend-rule" aria-hidden="true" />
      <div className={`stat-cal-notices-row${cal.noticesMuted ? " is-muted" : ""}`}>
        <button type="button" className={`stat-cal-legend-row${cal.noticesMuted ? " is-muted" : ""}`} aria-pressed={!cal.noticesMuted}
                onClick={(e) => (e.shiftKey ? cal.solo("notices") : cal.toggleMute("notices"))} title="Notices due · click to mute">
          <span className="pill stat-cal-notices">{noticesCount}</span>
          <span className="stat-cal-legend-name">Notices due</span>
        </button>
        <span className="segmented" role="radiogroup" aria-label="Which date the Notices layer uses">
          <button type="button" role="radio" aria-checked={cal.noticesDate === "due"} onClick={() => cal.setNoticesDate("due")}>Due</button>
          <button type="button" role="radio" aria-checked={cal.noticesDate === "issued"} onClick={() => cal.setNoticesDate("issued")}>Issued</button>
        </span>
      </div>
    </div>
  );
}

export function ScopeControl({ cal }: { cal: CalendarState }) {
  return (
    <span className="segmented" role="radiogroup" aria-label="Scope">
      {(["all", "applies", "overdue"] as const).map((s) => (
        <button key={s} type="button" role="radio" aria-checked={cal.scope === s} onClick={() => cal.setScope(s)}>
          {s === "all" ? "All" : s === "applies" ? "Applies to us" : "Overdue"}
        </button>
      ))}
    </span>
  );
}

/** The month grid with the full keyboard set; shared by the card and the overlay. */
export function useGridKeys(cal: CalendarState, cells: StatutoryMonthCell[], gridRef: React.RefObject<HTMLDivElement>) {
  return (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const iso = (e.target as HTMLElement).dataset.calIso;
    if (!iso) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cal.select(iso); return; }
    const from = cells.findIndex((c) => c.iso === iso);
    const next = nextInMonthCellIndex(cells, from, e.key);
    if (next == null || next === from) return;
    e.preventDefault();
    const nextIso = cells[next]?.iso;
    if (!nextIso) return;
    cal.setFocused(nextIso);
    requestAnimationFrame(() => gridRef.current?.querySelector<HTMLElement>(`[data-cal-iso="${nextIso}"]`)?.focus());
  };
}

// ------------------------------------------------------------------ screen

export default function CalendarScreen({ day }: { day?: string }) {
  const cal = useCalendarState(day);
  const clients = useClients("");
  const [filters, setFilters] = usePersistedFilters<AttentionFilters>(ATTENTION_SCREEN, DEFAULT_FILTERS);
  const gridRef = useRef<HTMLDivElement>(null);
  const fullBtn = useRef<HTMLButtonElement>(null);
  const cells = useMemo(() => buildStatutoryMonthGrid(cal.month.y, cal.month.m, cal.firstDay), [cal.month, cal.firstDay]);
  const onGridKey = useGridKeys(cal, cells, gridRef);
  const counts = useMemo(() => cal.monthCounts(cal.month.y, cal.month.m), [cal, cal.month]);
  const prefix = `${cal.month.y}-${String(cal.month.m).padStart(2, "0")}`;
  const noticesInMonth = useMemo(() => [...cal.notices.entries()].filter(([k]) => k.startsWith(prefix)).reduce((n, [, r]) => n + r.length, 0), [cal.notices, prefix]);
  const agendaDays = useMemo(() => {
    const days = new Set<string>();
    for (const k of cal.byDate.keys()) if (k.startsWith(prefix)) days.add(k);
    if (!cal.noticesMuted) { for (const k of cal.notices.keys()) if (k.startsWith(prefix)) days.add(k); for (const k of cal.limitations.keys()) if (k.startsWith(prefix)) days.add(k); }
    const list = [...days].sort();
    // Today first when nothing is selected.
    if (!cal.selected && list.includes(cal.todayIso)) return [cal.todayIso, ...list.filter((d) => d !== cal.todayIso)];
    return list;
  }, [cal.byDate, cal.notices, cal.limitations, cal.noticesMuted, cal.selected, cal.todayIso, prefix]);

  // A grid click scrolls the agenda group into view with the flash.
  useEffect(() => {
    if (!cal.selected || !cal.flashDay) return;
    const el = document.getElementById(statutoryAgendaId(cal.selected));
    el?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }, [cal.selected, cal.flashDay]);

  // t · [ · ] · F on the screen, outside inputs and dialogs.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)))) return;
      if (document.querySelector(".overlay")) return;
      if (e.key === "t" || e.key === "T") { e.preventDefault(); cal.jumpToday(); }
      else if (e.key === "[") { e.preventDefault(); if (cal.canPrev) cal.shift(-1); }
      else if (e.key === "]") { e.preventDefault(); if (cal.canNext) cal.shift(1); }
      else if ((e.key === "f" || e.key === "F") && cal.mode !== "maximized") { e.preventDefault(); cal.setMode("maximized"); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [cal]);

  const clientName = filters.clientId ? (clients.data?.find((c) => c.id === filters.clientId)?.name ?? "Client") : null;
  const monthName = MONTH_NAMES[cal.month.m - 1];
  const none = !cal.loading && !cal.scoped.length && !cal.status?.deadlines;
  const hidden = !cal.loading && !none && agendaDays.length === 0;
  const failed = cal.status?.last_status === "failed";

  return (
    <Page>
      <PageHead title="Calendar" meta={<span className="pill accent stat-cal-fy">{fyLabel(cal.fy)}</span>}>
        <ScopeControl cal={cal} />
        <button ref={fullBtn} className="btn" onClick={() => cal.setMode("maximized")} title="Full screen (F)"><Icon name="external" /><span>Full screen</span></button>
      </PageHead>
      <PageBody>
        <div className="stat-cal card">
          <div className="card-body">
            {(clientName || filters.module) ? (
              <div className="row" style={{ marginBottom: "0.5rem" }}>
                {clientName ? <span className="pill accent att-chip">{clientName}<button type="button" aria-label="Remove client filter" onClick={() => setFilters({ clientId: "" })}><Icon name="x" /></button></span> : null}
                {filters.module ? <span className="pill accent att-chip">{MODULE_LABEL[filters.module]}<button type="button" aria-label="Remove module filter" onClick={() => setFilters({ module: "" })}><Icon name="x" /></button></span> : null}
                <span className="meta">Notices layer follows the Attention filters</span>
              </div>
            ) : null}
            {failed ? (
              <p className="stat-cal-warn"><Icon name="alert" />Portal calendar unavailable since {cal.status?.last_fetched_at?.slice(0, 10) ?? "?"}{cal.status?.last_ok_at ? ` · showing data from ${cal.status.last_ok_at.slice(0, 10)}` : ""}</p>
            ) : null}
            <div className="stat-cal-body">
              <div>
                <div className="stat-cal-monthline">
                  <h2>{monthName}<span className="year">{cal.month.y}</span></h2>
                  <span className="grow" />
                  <button className="btn small icon" onClick={() => cal.shift(-1)} disabled={!cal.canPrev} aria-label="Previous month" title="Previous month ([)"><Icon name="chevron-left" /></button>
                  <button className="btn small" onClick={cal.jumpToday} title="Today (t)">Today</button>
                  <button className="btn small icon" onClick={() => cal.shift(1)} disabled={!cal.canNext} aria-label="Next month" title="Next month (])"><Icon name="chevron-right" /></button>
                </div>
                <div className="stat-cal-dows" aria-hidden="true">{weekdayLabels(cal.firstDay).map((w) => <span key={w} className="stat-cal-dow">{w}</span>)}</div>
                <div ref={gridRef} role="grid" aria-label={`${monthName} ${cal.month.y}`} className="stat-cal-month" onKeyDown={onGridKey}>
                  {cells.map((cell) => (
                    <DayTile key={cell.iso} cell={cell} items={cal.byDate.get(cell.iso) ?? EMPTY}
                             notices={(cal.notices.get(cell.iso)?.length ?? 0) + (cal.limitations.get(cell.iso)?.length ?? 0)}
                             cal={cal} monthLabel={monthName} onSelect={cal.select} />
                  ))}
                </div>
              </div>
              <Legend cal={cal} counts={counts} noticesCount={noticesInMonth} />
            </div>

            <div className="stat-cal-agenda" aria-label="Agenda">
              {cal.error ? <div className="banner danger" role="alert">{cal.error}</div>
                : cal.loading ? <div className="loading">Loading</div>
                : none ? (
                  <div className="stat-cal-empty">
                    Calendar not fetched yet · <button type="button" className="link-btn" disabled={cal.refreshing} onClick={() => { void cal.refresh(); }}>Refresh</button>
                    {noticesInMonth && !cal.noticesMuted ? <> · {plural(noticesInMonth, "notice")} due this month are shown on the grid.</> : null}
                  </div>
                ) : hidden ? (
                  <div className="stat-cal-empty">Nothing falls due in {monthName} for these filters{cal.muted.size || cal.scope !== "all" ? <> · <button type="button" className="link-btn" onClick={() => { cal.showAll(); cal.setScope("all"); }}>Show all</button></> : null}</div>
                ) : (cal.selected ? [cal.selected] : agendaDays).map((iso) => <AgendaGroup key={iso} iso={iso} cal={cal} />)}
              {cal.selected && !cal.loading ? <button type="button" className="link-btn stat-cal-legend-link" onClick={() => cal.select(null)}>Show the whole month</button> : null}
            </div>
          </div>
        </div>
      </PageBody>
      {cal.mode === "maximized" ? <CalendarOverlay cal={cal} returnTo={fullBtn} /> : null}
    </Page>
  );
}
