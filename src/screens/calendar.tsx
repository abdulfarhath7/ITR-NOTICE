/** Screen 9 — Calendar (docs/16 §5). A projection of `list_work_items`:
 *  open items counted on their effective due day (or issued day). Client
 *  and module come from the Attention screen's persisted filters and are
 *  shown as chips only. Items with no date never appear on a day. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useWorkItems } from "../hooks/use-work-items";
import { ATTENTION_SCREEN, DEFAULT_FILTERS, type AttentionFilters } from "../lib/attention-filters";
import { effectiveDue, inWindow, windowLabel, WINDOW_DAYS } from "../lib/windows";
import { MONTH_NAMES, WEEKDAYS, addDays, dayTone, groupByDay, limitationByDay, monthGrid, type DayField } from "../lib/calendar";
import { LimitationCell } from "../ui/ao-cells";
import { dayNumber, parseDate, toIso, todayIst, type Ymd } from "../lib/dates";
import { describeDueShort } from "../lib/due";
import { MODULE_LABEL, plural } from "../lib/labels";
import { usePersistedFilters, writeFilters } from "../lib/persisted-filters";
import { href, navigate } from "../lib/router";
import { sectionLabel, sectionTone } from "../lib/section-tone";
import { isSettled, parseStatus } from "../lib/status";
import type { WorkItemRow } from "../lib/types";
import EmptyState from "../ui/empty-state";
import ExportDialog from "../ui/export-dialog";
import Icon from "../ui/icons";
import { Avatar } from "../ui/owner-select";
import { Page, PageBody, PageHead } from "../ui/page";
import PendingDocs, { pendingOf } from "../ui/pending-docs";
import { StatusPill } from "../ui/pill";

function DayList({ rows, limits, field, today, listRef }: {
  rows: WorkItemRow[]; limits: WorkItemRow[]; field: DayField; today: Ymd; listRef: React.RefObject<HTMLDivElement>;
}) {
  if (!rows.length && !limits.length) {
    return <div className="cal-list" ref={listRef} tabIndex={-1}><p className="muted cal-list-empty">Nothing open on this day.</p></div>;
  }
  return (
    <div className="cal-list" ref={listRef} tabIndex={-1} role="list">
      {limits.map((r) => (
        <div key={`lim:${r.id}`} className="cal-item" role="listitem">
          <div className="cal-item-client">
            <span>{r.client_name}</span>
            <span className="sub mono">{[r.client_code, r.pan_masked].filter(Boolean).join(" · ")}</span>
          </div>
          <span className="pill-with-mark"><span className="pill accent">Limitation</span><span className="sub"> {sectionLabel(r)}</span></span>
          <span className="cal-item-when"><LimitationCell isAssessment date={r.limitation_date} today={today} /></span>
          <Avatar name={r.assignee} />
          <span className="cal-item-stage">
            <span className="cal-item-pill"><StatusPill status={r.status} /></span>
            <a className="btn small cal-item-view" href={href({ name: "item", module: r.module, id: r.id })}>View</a>
          </span>
        </div>
      ))}
      {rows.map((r) => {
        const due = describeDueShort(effectiveDue(r), r.status, today);
        return (
          <div key={`${r.module}:${r.id}`} className="cal-item" role="listitem">
            <div className="cal-item-client">
              <span>{r.client_name}</span>
              <span className="sub mono">{[r.client_code, r.pan_masked].filter(Boolean).join(" · ")}</span>
            </div>
            <span className="pill-with-mark"><span className={`pill ${sectionTone(r)}`}>{sectionLabel(r)}</span><PendingDocs count={pendingOf(r)} /></span>
            <span className="cal-item-when">{field === "issued" ? <span className={`due ${due.tone}`}>{due.date} {due.suffix}</span> : null}</span>
            <Avatar name={r.assignee} />
            <span className="cal-item-stage">
              <span className="cal-item-pill"><StatusPill status={r.status} /></span>
              <a className="btn small cal-item-view" href={href({ name: "item", module: r.module, id: r.id })}>View</a>
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function CalendarScreen() {
  const today = useMemo(() => todayIst(), []);
  const [filters, setFilters] = usePersistedFilters<AttentionFilters>(ATTENTION_SCREEN, DEFAULT_FILTERS);
  const [field, setField] = useState<DayField>("due");
  const [selected, setSelected] = useState<Ymd>(today);
  const [month, setMonth] = useState<{ y: number; m: number }>({ y: today.y, m: today.m });
  const [exporting, setExporting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const clients = useClients("");
  const q = useWorkItems({ client_ids: filters.clientId ? [filters.clientId] : null, module: filters.module || null });

  const byDay = useMemo(() => groupByDay(q.data ?? [], field), [q.data, field]);
  const limByDay = useMemo(() => (field === "due" ? limitationByDay(q.data ?? []) : new Map<string, WorkItemRow[]>()), [q.data, field]);
  // docs/18 §2: the same cumulative windows as Attention, from one helper.
  const nextCounts = useMemo(() => WINDOW_DAYS.map((n) => [n, (q.data ?? []).filter((r) => inWindow(r, "due", n, today)).length] as const), [q.data, today]);
  const openWindow = (n: number) => {
    writeFilters(ATTENTION_SCREEN, { ...filters, tile: "", issued: "", due: String(n) as AttentionFilters["due"] });
    navigate({ name: "attention" });
  };
  const noDate = useMemo(() => (q.data ?? []).filter((r) => !isSettled(parseStatus(r.status)) && !parseDate(effectiveDue(r))).length, [q.data]);
  const weeks = useMemo(() => monthGrid(month.y, month.m), [month]);
  const selectedIso = toIso(selected);
  const dayRows = byDay.get(selectedIso) ?? [];
  const dayLimits = limByDay.get(selectedIso) ?? [];

  const select = useCallback((d: Ymd) => {
    setSelected(d);
    if (d.y !== month.y || d.m !== month.m) setMonth({ y: d.y, m: d.m });
  }, [month]);
  const shiftMonth = (n: number) => {
    const t = new Date(Date.UTC(month.y, month.m - 1 + n, 1));
    setMonth({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 });
  };

  // Arrow keys move the day, t jumps to today, Enter focuses the list.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)))) return;
      if (document.querySelector(".overlay")) return;
      const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (e.key in step) {
        if (t && listRef.current?.contains(t)) return;
        e.preventDefault(); select(addDays(selected, step[e.key]));
      } else if (e.key === "t" || e.key === "T") { e.preventDefault(); select(today); }
      else if (e.key === "Enter" && !(t && (t.tagName === "A" || t.tagName === "BUTTON"))) {
        e.preventDefault(); (listRef.current?.querySelector<HTMLElement>("a.btn") ?? listRef.current)?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [selected, select, today]);

  const clientName = filters.clientId ? (clients.data?.find((c) => c.id === filters.clientId)?.name ?? "Client") : null;
  const openNoDate = () => {
    writeFilters(ATTENTION_SCREEN, { ...filters, tile: "nodate", issued: "", due: "" });
    navigate({ name: "attention" });
  };
  const isToday = (d: Ymd) => dayNumber(d) === dayNumber(today);

  return (
    <Page>
      <PageHead title="Calendar" meta={`${field === "due" ? "Due" : "Issued"} dates of open items`}>
        <button className="btn" onClick={() => setExporting(true)} disabled={!dayRows.length}><Icon name="upload" /><span>Export day</span></button>
      </PageHead>
      <PageBody>
        <div className="cal-bar">
          <div className="cal-month">
            <h2>{MONTH_NAMES[month.m - 1]} {month.y}</h2>
            <button className="btn small icon" onClick={() => shiftMonth(-1)} aria-label="Previous month" title="Previous month"><Icon name="chevron-left" /></button>
            <button className="btn small" onClick={() => select(today)} title="Today (t)">Today</button>
            <button className="btn small icon" onClick={() => shiftMonth(1)} aria-label="Next month" title="Next month"><Icon name="chevron-right" /></button>
          </div>
          <div className="segmented" role="radiogroup" aria-label="Which date">
            <button type="button" role="radio" aria-checked={field === "due"} onClick={() => setField("due")}>Due</button>
            <button type="button" role="radio" aria-checked={field === "issued"} onClick={() => setField("issued")}>Issued</button>
          </div>
          {clientName ? <span className="pill accent att-chip">{clientName}<button type="button" aria-label="Remove client filter" onClick={() => setFilters({ clientId: "" })}><Icon name="x" /></button></span> : null}
          {filters.module ? <span className="pill accent att-chip">{MODULE_LABEL[filters.module]}<button type="button" aria-label="Remove module filter" onClick={() => setFilters({ module: "" })}><Icon name="x" /></button></span> : null}
          <span className="grow" />
          {field === "due" && noDate ? <button className="btn quiet" onClick={openNoDate}>{plural(noDate, "item")} without a due date →</button> : null}
        </div>
        {field === "due" ? (
          <div className="cal-next" role="group" aria-label="Due in the next days">
            {nextCounts.map(([n, count]) => (
              <button key={n} type="button" className="chip" onClick={() => openWindow(n)} title={`Open Attention · ${windowLabel("due", n)}`}>
                {windowLabel("due", n)}<span className="att-window-count">{count}</span>
              </button>
            ))}
            <span className="meta">Next 7 is inside Next 15, which is inside Next 30.</span>
          </div>
        ) : null}

        {q.error ? <div className="banner danger" role="alert">{q.error}</div> : (
          <div className="cal-grid" role="grid" aria-label={`${MONTH_NAMES[month.m - 1]} ${month.y}`}>
            <div className="cal-row cal-head" role="row">{WEEKDAYS.map((w) => <span key={w} role="columnheader">{w}</span>)}</div>
            {weeks.map((week) => (
              <div key={week[0].iso} className="cal-row" role="row">
                {week.map((day) => {
                  const n = byDay.get(day.iso)?.length ?? 0;
                  const l = limByDay.get(day.iso)?.length ?? 0;
                  const tone = field === "due" ? dayTone(day.date, today) : "normal";
                  return (
                    <button key={day.iso} type="button" role="gridcell" aria-selected={day.iso === selectedIso}
                            className={`cal-day${day.outside ? " outside" : ""}${isToday(day.date) ? " today" : ""}`}
                            onClick={() => select(day.date)} aria-label={`${day.iso}${n ? `, ${n} open` : ""}${l ? `, ${l} limitation` : ""}`}>
                      <span className="cal-date">{day.date.d}</span>
                      {n ? <span className={`pill ${tone} cal-count`}>{n}</span> : null}
                      {l ? <span className="pill accent cal-count cal-lim" title="Limitation dates">{l}</span> : null}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div className="card-head"><h2>{isToday(selected) ? "Today" : `${selected.d} ${MONTH_NAMES[selected.m - 1]}`}</h2><span className="meta">{plural(dayRows.length, "open item")}{dayLimits.length ? ` · ${plural(dayLimits.length, "limitation date")}` : ""}</span></div>
          {q.loading && !q.data ? <div className="loading">Loading</div>
            : !q.data?.length ? <EmptyState title="Nothing to show yet." body="Open items appear on their due dates once a sweep has run." />
            : <DayList rows={dayRows} limits={dayLimits} field={field} today={today} listRef={listRef} />}
        </div>
      </PageBody>
      {exporting ? (
        <ExportDialog onClose={() => setExporting(false)} choices={{
          view: { items: dayRows.map((r) => [r.module, r.id] as [string, string]),
                  label: `calendar · ${field} ${selectedIso}${clientName ? ` · ${clientName}` : ""}${filters.module ? ` · ${MODULE_LABEL[filters.module]}` : ""}`, sheet: "Calendar" },
        }} />
      ) : null}
    </Page>
  );
}
