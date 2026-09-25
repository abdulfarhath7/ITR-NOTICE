/** The Notices layer's pure parts (docs/16 §5, docs/19 §4): open items
 *  grouped by day, and the day tone. The month grid moved to
 *  `calendar-grid.ts` in Build 5. `today` is always a parameter. A NULL
 *  date never lands on a day. */
import { dayNumber, parseDate, toIso, type Ymd } from "./dates";
import { effectiveDue } from "./windows";
import { isSettled, parseStatus } from "./status";
import type { WorkItemRow } from "./types";

export type DayField = "due" | "issued";

/** docs/18 §3.3 (Q56): open assessment proceedings on their limitation
 *  date. One item source; drop the call to drop the items. */
export function limitationByDay(rows: WorkItemRow[]): Map<string, WorkItemRow[]> {
  const out = new Map<string, WorkItemRow[]>();
  for (const r of rows) {
    if (!r.is_assessment || isSettled(parseStatus(r.status))) continue;
    const d = parseDate(r.limitation_date);
    if (!d) continue;
    const k = toIso(d);
    const list = out.get(k);
    if (list) list.push(r); else out.set(k, [r]);
  }
  return out;
}

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
