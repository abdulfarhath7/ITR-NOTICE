/** The full-screen calendar (docs/19 §5): a fixed overlay over the content
 *  column with Month / Year / Agenda views. State is the card's, passed
 *  in, so switching modes never resets anything. The sidebar collapses to
 *  icons while it is open and restores on close; body scroll is locked;
 *  Escape closes and focus returns to the "Full screen" button. */
import { useEffect, useMemo, useRef } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, describeError } from "../lib/api";
import {
  LEGEND, MONTH_NAMES, buildStatutoryMonthGrid, monthBounds, monthKey, shiftMonth, statutoryAgendaId, statutoryHeatLevel,
  statutoryPillLabel, trimWeeks, weekdayLabels, fyLabel,
} from "../lib/calendar-grid";
import { parseDate, toIso } from "../lib/dates";
import { plural } from "../lib/labels";
import { toast, toastError } from "../lib/toast";
import { AgendaGroup, CategoryDot, NoticesPill, ScopeControl, useGridKeys, type CalendarState } from "../screens/calendar";
import Icon from "./icons";

const PILL_SLOTS = [0, 1, 2] as const;

function MonthView({ cal }: { cal: CalendarState }) {
  const gridRef = useRef<HTMLDivElement>(null);
  const cells = useMemo(() => trimWeeks(buildStatutoryMonthGrid(cal.month.y, cal.month.m, cal.firstDay)), [cal.month, cal.firstDay]);
  const onKey = useGridKeys(cal, cells, gridRef);
  const weeks = cells.length / 7;
  return (
    <>
      <div className="stat-max-dows" aria-hidden="true">{weekdayLabels(cal.firstDay).map((w) => <span key={w} className="stat-max-dow">{w}</span>)}</div>
      <div ref={gridRef} role="grid" aria-label={`${MONTH_NAMES[cal.month.m - 1]} ${cal.month.y}`} className="stat-max-grid"
           style={{ gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))` }} onKeyDown={onKey}>
        {cells.map((cell) => {
          if (!cell.inMonth) return <div key={cell.iso} role="presentation" className="stat-max-cell is-outside" aria-hidden="true"><span className="stat-max-num">{cell.day}</span></div>;
          const items = cal.byDate.get(cell.iso) ?? [];
          const notices = cal.noticesMuted ? 0 : (cal.notices.get(cell.iso)?.length ?? 0) + (cal.limitations.get(cell.iso)?.length ?? 0);
          const isToday = cell.iso === cal.todayIso;
          return (
            <button key={cell.iso} type="button" role="gridcell" className="stat-max-cell" data-cal-iso={cell.iso}
                    tabIndex={cal.focused === cell.iso || (!cal.focused && isToday) ? 0 : -1}
                    aria-selected={cal.selected === cell.iso} aria-current={isToday ? "date" : undefined}
                    data-today={isToday ? "true" : undefined} data-selected={cal.selected === cell.iso ? "true" : undefined}
                    onClick={() => cal.select(cell.iso)}>
              <span className="stat-max-num">{cell.day}</span>
              <span className="stat-max-pills">
                {PILL_SLOTS.map((s) => {
                  const it = items[s];
                  if (!it) return <span key={s} className="stat-max-pill is-empty" />;
                  return (
                    <span key={s} className="stat-max-pill" title={it.title} style={{ "--cat": `var(--cat-${it.category})` } as React.CSSProperties}>
                      <span className="stat-max-pill-notch" aria-hidden="true" /><span className="stat-max-pill-label">{statutoryPillLabel(it.title, 40)}</span>
                    </span>
                  );
                })}
                {items.length > 3 ? <span className="stat-max-more">+{items.length - 3} more</span> : null}
                {notices ? <span className="stat-max-notices-line">{plural(notices, "notice")} due</span> : null}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function YearView({ cal }: { cal: CalendarState }) {
  const [lo] = monthBounds(cal.today);
  const fy = cal.fy;
  const months = Array.from({ length: 12 }, (_, i) => shiftMonth(fy, 4, i));
  void lo;
  return (
    <div className="stat-year" role="list" aria-label={`${fyLabel(fy)} by month`}>
      {months.map(({ y, m }) => {
        const cells = trimWeeks(buildStatutoryMonthGrid(y, m, cal.firstDay));
        const prefix = `${y}-${String(m).padStart(2, "0")}`;
        const noticeCount = [...cal.notices.entries()].filter(([k]) => k.startsWith(prefix)).reduce((n, [, r]) => n + r.length, 0);
        return (
          <section key={prefix} className="stat-year-month" role="listitem">
            <h3><span>{MONTH_NAMES[m - 1]} <span className="meta">{y}</span></span>{noticeCount && !cal.noticesMuted ? <span className="meta">{noticeCount} notices</span> : null}</h3>
            <div className="stat-year-grid">
              {cells.map((c) => {
                const n = cal.byDate.get(c.iso)?.length ?? 0;
                const nn = cal.notices.get(c.iso)?.length ?? 0;
                const d = parseDate(c.iso);
                const tip = `${d?.d ?? ""} ${MONTH_NAMES[(d?.m ?? 1) - 1].slice(0, 3)} · ${plural(n, "deadline")}${nn ? ` · ${plural(nn, "notice")}` : ""}`;
                return (
                  <button key={c.iso} type="button" className={`stat-year-day${c.inMonth ? "" : " is-outside"}`} data-heat={statutoryHeatLevel(n)}
                          data-today={c.iso === cal.todayIso ? "true" : undefined} title={tip} aria-label={tip} tabIndex={c.inMonth ? 0 : -1}
                          onClick={() => { cal.goMonth(y, m); cal.select(c.iso); cal.setView("month"); }} />
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function AgendaView({ cal }: { cal: CalendarState }) {
  const from = `${cal.fy}-04-01`;
  const to = `${cal.fy + 1}-03-31`;
  const days = useMemo(() => {
    const set = new Set<string>();
    for (const k of cal.byDate.keys()) if (k >= from && k <= to) set.add(k);
    if (!cal.noticesMuted) for (const k of cal.notices.keys()) if (k >= from && k <= to) set.add(k);
    const list = [...set].sort();
    return list.includes(cal.todayIso) ? [cal.todayIso, ...list.filter((d) => d !== cal.todayIso)] : list;
  }, [cal.byDate, cal.notices, cal.noticesMuted, cal.todayIso, from, to]);
  const cursor = useRef(0);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key !== "j" && e.key !== "k") return;
      e.preventDefault();
      const n = Math.max(0, Math.min(days.length - 1, cursor.current + (e.key === "j" ? 1 : -1)));
      cursor.current = n;
      const iso = days[n];
      if (iso) { cal.select(iso); document.getElementById(statutoryAgendaId(iso))?.scrollIntoView({ block: "nearest" }); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [days, cal]);
  let lastMonth = "";
  return (
    <div className="stat-cal-agenda" aria-label="Agenda for the year">
      {days.length ? days.map((iso) => {
        const month = iso.slice(0, 7);
        const head = month !== lastMonth && iso !== cal.todayIso ? <h3 className="stat-agenda-month" key={`m${month}`}>{MONTH_NAMES[Number(month.slice(5)) - 1]} {month.slice(0, 4)}</h3> : null;
        if (iso !== cal.todayIso) lastMonth = month;
        return <div key={iso}>{head}{iso === cal.todayIso ? <span className="pill accent stat-agenda-today">Today</span> : null}<AgendaGroup iso={iso} cal={cal} expandNotices /></div>;
      }) : <div className="stat-cal-empty">Nothing falls due in {fyLabel(cal.fy)} for these filters.</div>}
    </div>
  );
}

export default function CalendarOverlay({ cal, returnTo }: { cal: CalendarState; returnTo: React.RefObject<HTMLButtonElement> }) {
  const close = () => { cal.setMode("minimized"); requestAnimationFrame(() => returnTo.current?.focus()); };

  // Sidebar to icons, body scroll locked, Escape closes, 1/2/3 pick a view.
  useEffect(() => {
    const shell = document.querySelector(".shell");
    const wasCollapsed = shell?.classList.contains("nav-collapsed") ?? false;
    shell?.classList.add("nav-collapsed");
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "1") cal.setView("month");
      else if (e.key === "2") cal.setView("year");
      else if (e.key === "3") cal.setView("agenda");
    };
    window.addEventListener("keydown", onKey);
    return () => {
      if (!wasCollapsed) shell?.classList.remove("nav-collapsed");
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exportIcs = async () => {
    try {
      const path = await save({ defaultPath: `LCC_calendar_${fyLabel(cal.fy).replace(/\s+/g, "_")}.ics`, filters: [{ name: "Calendar", extensions: ["ics"] }] });
      if (!path) return;
      await api.exportStatutoryIcs(cal.fy, path);
      toast("Calendar file written. Notices are never exported here.");
    } catch (e) { toastError(describeError(e)); }
  };

  const monthName = MONTH_NAMES[cal.month.m - 1];
  const rightDay = cal.selected ?? cal.todayIso;
  const counts = cal.monthCounts(cal.month.y, cal.month.m);
  void monthKey; void toIso;

  return (
    <div className="stat-max" role="dialog" aria-modal="true" aria-label="Calendar, full screen">
      <div className="stat-max-bar">
        <h1>Calendar</h1>
        <span className="pill accent stat-cal-fy">{fyLabel(cal.fy)}</span>
        <span className="segmented" role="radiogroup" aria-label="View">
          {(["month", "year", "agenda"] as const).map((v, i) => (
            <button key={v} type="button" role="radio" aria-checked={cal.view === v} onClick={() => cal.setView(v)} title={`${i + 1}`}>
              {v === "month" ? "Month" : v === "year" ? "Year" : "Agenda"}
            </button>
          ))}
        </span>
        <ScopeControl cal={cal} />
        <span className="stat-max-chips" role="group" aria-label="Categories">
          {LEGEND.map((c) => (
            <button key={c.id} type="button" className={`chip stat-max-chip${cal.muted.has(c.id) ? " is-muted" : " on"}`} aria-pressed={!cal.muted.has(c.id)}
                    title={`${c.label} · ${counts[c.id] ?? 0} this month`} onClick={(e) => (e.shiftKey ? cal.solo(c.id) : cal.toggleMute(c.id))}>
              <CategoryDot category={c.id} muted={cal.muted.has(c.id)} />{c.label}
            </button>
          ))}
          <button type="button" className={`chip stat-max-chip${cal.noticesMuted ? " is-muted" : " on"}`} aria-pressed={!cal.noticesMuted}
                  onClick={() => cal.toggleMute("notices")}>Notices</button>
        </span>
        <span className="grow" />
        {cal.view === "month" ? (
          <>
            <button className="btn small icon" onClick={() => cal.shift(-1)} disabled={!cal.canPrev} aria-label="Previous month"><Icon name="chevron-left" /></button>
            <span className="num">{monthName} {cal.month.y}</span>
            <button className="btn small icon" onClick={() => cal.shift(1)} disabled={!cal.canNext} aria-label="Next month"><Icon name="chevron-right" /></button>
          </>
        ) : null}
        <button className="btn small" onClick={cal.jumpToday}>Today</button>
        <button className="btn small" onClick={() => { void exportIcs(); }} title="Statutory and firm dates of the FY">.ics</button>
        <button className="btn small" onClick={() => window.print()} title="Print month">Print month</button>
        <button className="btn small" onClick={close} aria-label="Exit full screen (Esc)" title="Exit full screen (Esc)"><Icon name="x" /><span>Exit full screen</span></button>
      </div>
      <div className="stat-max-main">
        <div className="stat-max-stage">
          {cal.view === "month" ? <MonthView cal={cal} /> : cal.view === "year" ? <YearView cal={cal} /> : <AgendaView cal={cal} />}
        </div>
        {cal.view === "month" ? (
          <aside className="stat-max-panel" aria-label="Selected day">
            <h2>{cal.selected ? `${parseDate(cal.selected)?.d ?? ""} ${MONTH_NAMES[(parseDate(cal.selected)?.m ?? 1) - 1]}` : "Today"}</h2>
            <AgendaGroup iso={rightDay} cal={cal} />
            {(cal.notices.get(rightDay)?.length ?? 0) > 2 ? (
              <p className="meta">
                <NoticesPill iso={rightDay} count={cal.notices.get(rightDay)?.length ?? 0} today={cal.today} />{" "}
                +{(cal.notices.get(rightDay)?.length ?? 0) - 2} more · <a href="#/attention">open in Attention</a>
              </p>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
