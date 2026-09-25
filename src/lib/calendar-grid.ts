/** The statutory calendar's pure parts (docs/19 §4, §5), ported from
 *  vcfo's `statutory-calendar-utils.ts`: grid builder, keyboard movement,
 *  status and labels, heat levels, pill label. Monday-first by default
 *  (Q63: `FIRST_DAY` is the one place that changes). `today` is always a
 *  parameter; nothing here reads the clock. Dates are ISO `YYYY-MM-DD`. */
import { dayNumber, parseDate, toIso, type Ymd } from "./dates";

export type FirstDay = "monday" | "sunday";
/** Q63 seam. */
export const FIRST_DAY: FirstDay = "monday";

export interface StatutoryMonthCell { iso: string; day: number; inMonth: boolean }

export function addDays(d: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** 0 = the week's first day. */
function weekdayIndex(d: Ymd, firstDay: FirstDay): number {
  const sunday0 = new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay();
  return firstDay === "monday" ? (sunday0 + 6) % 7 : sunday0;
}

/** Six weeks so the card height never changes; `trimWeeks` for the overlay. */
export function buildStatutoryMonthGrid(year: number, month: number, firstDay: FirstDay = FIRST_DAY, weeks = 6): StatutoryMonthCell[] {
  const first: Ymd = { y: year, m: month, d: 1 };
  let cur = addDays(first, -weekdayIndex(first, firstDay));
  const out: StatutoryMonthCell[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    out.push({ iso: toIso(cur), day: cur.d, inMonth: cur.m === month });
    cur = addDays(cur, 1);
  }
  return out;
}

/** Only the weeks the month needs (overlay month view). */
export function trimWeeks(cells: StatutoryMonthCell[]): StatutoryMonthCell[] {
  const last = cells.map((c) => c.inMonth).lastIndexOf(true);
  return cells.slice(0, Math.ceil((last + 1) / 7) * 7);
}

export function weekdayLabels(firstDay: FirstDay = FIRST_DAY): string[] {
  const mon = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return firstDay === "monday" ? mon : ["Sun", ...mon.slice(0, 6)];
}

const KEY_STEP: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };

/** Spatial move across a 7-column grid. Null when the key is not a move. */
export function calendarCellIndexAfterKey(from: number, key: string, length: number, cols = 7): number | null {
  if (length <= 0 || from < 0 || from >= length) return null;
  if (key === "Home") return from - (from % cols);
  if (key === "End") return Math.min(length - 1, from - (from % cols) + (cols - 1));
  const step = KEY_STEP[key];
  if (step == null) return null;
  const next = from + step;
  if (next < 0 || next >= length) return from;
  return next;
}

/** Prefer the next in-month cell in the same direction; stay put at the edge. */
export function nextInMonthCellIndex(cells: readonly { inMonth: boolean }[], from: number, key: string): number | null {
  const raw = calendarCellIndexAfterKey(from, key, cells.length);
  if (raw == null) return null;
  if (key === "Home" || key === "End") {
    if (cells[raw]?.inMonth) return raw;
    const step = key === "Home" ? 1 : -1;
    for (let i = raw; i >= 0 && i < cells.length; i += step) if (cells[i].inMonth) return i;
    return from;
  }
  const step = KEY_STEP[key] ?? 0;
  if (step === 0) return raw;
  for (let i = raw; i >= 0 && i < cells.length; i += Math.sign(step)) if (cells[i].inMonth) return i;
  return from;
}

// ------------------------------------------------------------------ status

export type StatutoryStatus = "overdue" | "due-soon" | "upcoming";
const DUE_SOON_DAYS = 7;

/** Whole days from today to the date; negative once past; 0 for unreadable input. */
export function statutoryDaysUntil(dateIso: string, today: Ymd): number {
  const d = parseDate(dateIso);
  return d ? dayNumber(d) - dayNumber(today) : 0;
}

export function statutoryStatus(dateIso: string, today: Ymd): StatutoryStatus {
  const days = statutoryDaysUntil(dateIso, today);
  if (days < 0) return "overdue";
  if (days <= DUE_SOON_DAYS) return "due-soon";
  return "upcoming";
}

/** docs/19 §12: Overdue · Today · Tomorrow · n days · Upcoming. */
export function statutoryStatusLabel(dateIso: string, today: Ymd): string {
  const days = statutoryDaysUntil(dateIso, today);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days <= DUE_SOON_DAYS) return `${days} days`;
  return "Upcoming";
}

export type StatutoryHeatLevel = 0 | 1 | 2 | 3;
/** Four steps: none / one / two–three / four+. */
export function statutoryHeatLevel(count: number): StatutoryHeatLevel {
  if (!Number.isFinite(count) || count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  return 3;
}

/** The first clause of a portal title: up to the first ";" or ":", or the
 *  first comma once the clause is long enough to stand alone. The full
 *  title lives in the tooltip. */
export function statutoryPillLabel(title: string, max = 72): string {
  const first = title.split(/[;:]/)[0].trim();
  if (first.length <= max) return first;
  const comma = first.indexOf(",", 24);
  const cut = comma > 0 && comma < max ? first.slice(0, comma) : first.slice(0, max).replace(/\s+\S*$/, "");
  return `${cut.trim()}…`;
}

// ------------------------------------------------------------------ FY maths

/** The Indian financial year that holds `d`: 1 Apr – 31 Mar. */
export function fyStartYear(d: Ymd): number {
  return d.m >= 4 ? d.y : d.y - 1;
}

export function fyLabel(startYear: number): string {
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** `[first month, last month]` the calendar may show: this FY's April to next FY's March (docs/19 §4). */
export function monthBounds(today: Ymd): [{ y: number; m: number }, { y: number; m: number }] {
  const fy = fyStartYear(today);
  return [{ y: fy, m: 4 }, { y: fy + 2, m: 3 }];
}

export function monthKey(y: number, m: number): number { return y * 12 + (m - 1); }

export function clampMonth(y: number, m: number, today: Ymd): { y: number; m: number } {
  const [lo, hi] = monthBounds(today);
  const k = monthKey(y, m);
  if (k < monthKey(lo.y, lo.m)) return lo;
  if (k > monthKey(hi.y, hi.m)) return hi;
  return { y, m };
}

export function shiftMonth(y: number, m: number, delta: number): { y: number; m: number } {
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** DOM id for an agenda day group — a grid click scrolls here. */
export function statutoryAgendaId(iso: string): string { return `statutory-agenda-${iso}`; }

/** `Wednesday 30 September` for an aria-label. */
export function longDay(iso: string): string {
  const d = parseDate(iso);
  if (!d) return iso;
  const wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay()];
  return `${wd} ${d.d} ${MONTH_NAMES[d.m - 1]}`;
}

export function shortWeekday(iso: string): string {
  const d = parseDate(iso);
  if (!d) return "";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay()];
}

// ------------------------------------------------------------------ legend

/** docs/19 §2.3, order as the Rust rule table (audit before ITR, Q67).
 *  Notices is a layer, not a category. */
export const LEGEND: { id: string; label: string }[] = [
  { id: "tds_deposit", label: "TDS/TCS deposit" },
  { id: "tds_returns", label: "Returns & certificates" },
  { id: "advance_tax", label: "Advance tax" },
  { id: "audit", label: "Audit & reports" },
  { id: "itr", label: "ITR filing" },
  { id: "forms", label: "Statements & forms" },
  { id: "other", label: "Other" },
  { id: "firm", label: "Firm dates" },
];
