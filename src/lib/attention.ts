/** The attention ranking (docs/09 screen 1). Pure; the hook feeds it rows.
 *
 *  1. overdue, soonest first
 *  2. limitation date within 30 days
 *  3. due within 7 days
 *  4. open with no stated due date - the dangerous ones
 *  5. everything else open
 *
 *  Settled items (closed, submitted) never rank: only the attention list
 *  filters by status. A manual date fills a blank; a suggestion never
 *  counts. */
import { daysBetween, parseDate, todayIst, type Ymd } from "./dates";
import { describeDue, type DueDescription } from "./due";
import { isSettled, parseStatus, type Status } from "./status";
import type { WorkItemRow } from "./types";

export type Rank = 1 | 2 | 3 | 4 | 5;

export const RANK_LABEL: Record<Rank, string> = {
  1: "Overdue",
  2: "Limitation within 30 days",
  3: "Due within 7 days",
  4: "Open, no due date stated",
  5: "Open",
};

export interface RankedItem {
  row: WorkItemRow;
  status: Status;
  rank: Rank;
  /** The date the ranking used: stated, else manual. */
  effectiveDue: string | null;
  due: DueDescription;
  limitation: DueDescription;
  sortKey: number;
}

export function rankRows(rows: WorkItemRow[], today: Ymd = todayIst()): RankedItem[] {
  const out: RankedItem[] = [];
  for (const row of rows) {
    const status = parseStatus(row.status);
    if (isSettled(status)) continue;
    const effectiveDue = row.due_date ?? row.manual_due_date ?? null;
    const due = describeDue(effectiveDue, status, today);
    const limitation = describeDue(row.limitation_date, status, today);
    const dueDays = due.days;
    const limDate = parseDate(row.limitation_date);
    const limDays = limDate ? daysBetween(today, limDate) : null;
    let rank: Rank;
    let sortKey: number;
    if (dueDays !== null && dueDays < 0) { rank = 1; sortKey = dueDays; }
    else if (limDays !== null && limDays <= 30) { rank = 2; sortKey = limDays; }
    else if (dueDays !== null && dueDays <= 7) { rank = 3; sortKey = dueDays; }
    else if (dueDays === null) { rank = 4; sortKey = 0; }
    else { rank = 5; sortKey = dueDays; }
    out.push({ row, status, rank, effectiveDue, due, limitation, sortKey });
  }
  out.sort((a, b) => a.rank - b.rank || a.sortKey - b.sortKey || a.row.client_name.localeCompare(b.row.client_name));
  return out;
}

export type DueWindow = "" | "overdue" | "7" | "30" | "none";

export function inDueWindow(item: RankedItem, window: DueWindow): boolean {
  const d = item.due.days;
  switch (window) {
    case "": return true;
    case "overdue": return d !== null && d < 0;
    case "7": return d !== null && d >= 0 && d <= 7;
    case "30": return d !== null && d >= 0 && d <= 30;
    case "none": return d === null;
  }
}
