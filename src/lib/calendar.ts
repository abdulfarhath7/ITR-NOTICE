/** The Calendar screen's pure parts (docs/16 §5): a Monday-first month
 *  grid in IST calendar dates, and open items grouped by day. `today` is
 *  always a parameter. A NULL date never lands on a day. */
import { dayNumber, parseDate, toIso, type Ymd } from "./dates";
import { effectiveDue } from "./buckets";
import { isSettled, parseStatus } from "./status";
import type { WorkItemRow } from "./types";

export interface GridDay {
  date: Ymd;
  iso: string;
  /** Leading or trailing day from the neighbouring month. */
  outside: boolean;
}

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function addDays(d: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Whole weeks covering the month, Monday first. */
export function monthGrid(year: number, month: number): GridDay[][] {
  const first: Ymd = { y: year, m: month, d: 1 };
  const weekday = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;   // Monday = 0
  let cur = addDays(first, -weekday);
  const weeks: GridDay[][] = [];
  do {
    const week: GridDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: cur, iso: toIso(cur), outside: cur.m !== month });
      cur = addDays(cur, 1);
    }
    weeks.push(week);
  } while (cur.m === month);
  return weeks;
}

export type DayField = "due" | "issued";

/** Open items by the ISO day of the chosen field. */
export function groupByDay(rows: WorkItemRow[], field: DayField): Map<string, WorkItemRow[]> {
  const out = new Map<string, WorkItemRow[]>();
  for (const r of rows) {
    if (isSettled(parseStatus(r.status))) continue;
    const d = parseDate(field === "due" ? effectiveDue(r) : r.issued_on);
    if (!d) continue;
    const k = toIso(d);
    const list = out.get(k);
    if (list) list.push(r); else out.set(k, [r]);
  }
  return out;
}

/** A day's pill tone: danger for a past day still holding open items,
 *  warning for today and tomorrow, normal otherwise. */
export function dayTone(day: Ymd, today: Ymd): "danger" | "warning" | "normal" {
  const diff = dayNumber(day) - dayNumber(today);
  if (diff < 0) return "danger";
  if (diff <= 1) return "warning";
  return "normal";
}
