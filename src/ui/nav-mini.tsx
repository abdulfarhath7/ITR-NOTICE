/** Sidebar "Next deadlines" and the Attention "Next statutory" tile
 *  (docs/19 §6). Both read the next statutory rows in force: scope
 *  "Applies to us" when any client has profile fields set, else "All". */
import { api } from "../lib/api";
import { statutoryPillLabel, statutoryStatus, statutoryStatusLabel, statutoryDaysUntil } from "../lib/calendar-grid";
import { parseDate, shortDate, toIso, todayIst } from "../lib/dates";
import { useQuery } from "../lib/query";
import { href } from "../lib/router";
import type { CalendarSettings, StatutoryItem } from "../lib/types";
import Icon from "./icons";

function addDaysIso(iso: string, n: number): string {
  const d = parseDate(iso);
  if (!d) return iso;
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return toIso({ y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() });
}

/** The next `days` days of statutory and firm rows, Applies-to-us first. */
export function useNextStatutory(days: number) {
  const today = toIso(todayIst());
  const to = addDaysIso(today, days);
  return useQuery<StatutoryItem[]>(`statutory:next:${days}:${today}`, async () => {
    const applies = await api.listStatutory(today, to, "applies");
    return applies.length ? applies : api.listStatutory(today, to, "all");
  });
}

export function NavMini() {
  const settings = useQuery<CalendarSettings>("calendar:settings", () => api.calendarSettings());
  const q = useNextStatutory(30);
  const today = todayIst();
  if (settings.data && !settings.data.sidebar_mini) return null;
  const next = (q.data ?? []).slice(0, 3);
  const soon = (q.data ?? []).filter((i) => statutoryDaysUntil(i.due_on, today) <= 7).length;
  return (
    <>
      <div className="nav-mini" aria-label="Next deadlines">
        <span className="nav-mini-cap">Next deadlines</span>
        {next.length ? next.map((i) => (
          <a key={i.id} href={href({ name: "calendar", day: i.due_on })} title={`${i.title} · ${statutoryStatusLabel(i.due_on, today)}`}>
            <span className={`d ${statutoryStatus(i.due_on, today)}`}>{shortDate(parseDate(i.due_on) ?? today, today)}</span>
            <span className="t">{statutoryPillLabel(i.title, 40)}</span>
          </a>
        )) : <span className="meta">{q.loading ? "…" : "No statutory dates in 30 d"}</span>}
      </div>
      <a className="nav-mini-icon" href={href({ name: "calendar" })} title={`${soon} deadlines in the next 7 days`} aria-label={`Calendar, ${soon} deadlines in the next 7 days`}>
        <Icon name="calendar" />{soon ? <span className="count">{soon}</span> : null}
      </a>
    </>
  );
}

/** Attention strip's fifth tile (docs/19 §6). */
export function NextStatutoryTile() {
  const q = useNextStatutory(30);
  const today = todayIst();
  const first = q.data?.[0] ?? null;
  const days = first ? statutoryDaysUntil(first.due_on, today) : null;
  const tone = days !== null && days <= 2 ? "danger" : "muted";
  return (
    <a className={`att-tile statutory ${tone}`} href={href(first ? { name: "calendar", day: first.due_on } : { name: "calendar" })}
       title={first ? `${first.title} · ${statutoryStatusLabel(first.due_on, today)}` : undefined}>
      <span className="label">Next statutory{first ? ` · ${statutoryPillLabel(first.title, 36)}` : ""}</span>
      <span className="value">{first ? (days === 0 ? "today" : `${days} d`) : q.loading ? "…" : "No statutory dates in 30 d"}</span>
    </a>
  );
}
