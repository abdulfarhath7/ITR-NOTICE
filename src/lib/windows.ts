/** Cumulative windows and the risk strip (docs/18 §2, §3). Pure: `today`
 *  is always a parameter, never read from the clock here.
 *
 *  Every window is measured from today and includes everything up to it:
 *  Last 7 ⊂ Last 15 ⊂ Last 30, Next 7 ⊂ Next 15 ⊂ Next 30. Counts overlap
 *  by design. A NULL date is in no window — never a guessed one. Only
 *  open items count. This is the one place a window becomes dates. */
import { daysBetween, parseDate, shortDate, type Ymd } from "./dates";
import { isSettled, parseStatus } from "./status";
import type { WorkItemRow } from "./types";

export type WindowKind = "issued" | "due";
export type WindowDays = 7 | 15 | 30;
export const WINDOW_DAYS: WindowDays[] = [7, 15, 30];

/** `"7" | "15" | "30"` as the persisted filter stores it. */
export type WindowValue = "" | "7" | "15" | "30";

export function windowDays(v: WindowValue): WindowDays | null {
  return v === "7" || v === "15" || v === "30" ? (Number(v) as WindowDays) : null;
}

function addDays(d: Ymd, n: number): Ymd {
  const t = new Date(Date.UTC(d.y, d.m - 1, d.d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** `[from, to]` inclusive. Issued: `[today-(n-1), today]`; due: `[today, today+(n-1)]`. */
export function windowRange(kind: WindowKind, days: WindowDays, today: Ymd): [Ymd, Ymd] {
  return kind === "issued" ? [addDays(today, -(days - 1)), today] : [today, addDays(today, days - 1)];
}

/** Manual when a person entered it, else the portal's (Q14). */
export function effectiveDue(row: WorkItemRow): string | null {
  return row.manual_due_date ?? row.due_date ?? null;
}

export function isOpen(row: WorkItemRow): boolean {
  return !isSettled(parseStatus(row.status));
}

/** Whole days from today to the effective due date; null when none. */
export function daysToDue(row: WorkItemRow, today: Ymd): number | null {
  const d = parseDate(effectiveDue(row));
  return d ? daysBetween(today, d) : null;
}

/** Whole days from today to the limitation date; null when none. */
export function daysToLimitation(row: WorkItemRow, today: Ymd): number | null {
  const d = parseDate(row.limitation_date);
  return d ? daysBetween(today, d) : null;
}

export function inWindow(row: WorkItemRow, kind: WindowKind, days: WindowDays, today: Ymd): boolean {
  if (!isOpen(row)) return false;
  const d = parseDate(kind === "issued" ? row.issued_on : effectiveDue(row));
  if (!d) return false;
  const n = daysBetween(today, d);   // negative = past
  return kind === "issued" ? n <= 0 && n > -days : n >= 0 && n < days;
}

/** `Last 7` / `Next 15` — the chip text. */
export function windowLabel(kind: WindowKind, days: WindowDays): string {
  return `${kind === "issued" ? "Last" : "Next"} ${days}`;
}

/** `Issued in last 15 days` / `Due in next 30 days` — chips and summaries. */
export function windowSummary(kind: WindowKind, days: WindowDays): string {
  return kind === "issued" ? `Issued in last ${days} days` : `Due in next ${days} days`;
}

/** `11 Sep – 25 Sep 2026`: the year once, at the end, as the hint line shows it. */
export function rangeText(range: [Ymd, Ymd]): string {
  const [a, b] = range;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const left = a.y === b.y ? `${a.d} ${MON[a.m - 1]}` : `${a.d} ${MON[a.m - 1]} ${a.y}`;
  return `${left} – ${b.d} ${MON[b.m - 1]} ${b.y}`;
}

/** The filter-line and export form: `Issued in last 15 days (11 Sep 2026 – 25 Sep 2026)`. */
export function windowFilterLine(kind: WindowKind, days: WindowDays, today: Ymd): string {
  const [a, b] = windowRange(kind, days, today);
  return `${windowSummary(kind, days)} (${shortDate(a, { ...today, y: 0 })} – ${shortDate(b, { ...today, y: 0 })})`;
}

// ------------------------------------------------------------------ risk strip

/** Two tiles are filters of their own; the other two apply a chip (§3.3). */
export type RiskTile = "overdue" | "due3" | "ao" | "limitation60";
export const RISK_TILES: RiskTile[] = ["overdue", "due3", "ao", "limitation60"];
export const RISK_LABEL: Record<RiskTile, string> = {
  overdue: "Overdue", due3: "Due in 3 days", ao: "Reply not yet viewed by AO", limitation60: "Limitation within 60 days",
};
export const RISK_TONE: Record<RiskTile, "danger" | "warning" | "muted"> = {
  overdue: "danger", due3: "warning", ao: "muted", limitation60: "warning",
};

/** Tiles kept as a filter value; `nodate` is not on the strip but the
 *  Calendar's "without a due date" link still lands on it. */
export type TileFilter = "" | "overdue" | "due3" | "nodate" | "drafts";

export function inRiskTile(row: WorkItemRow, tile: RiskTile, today: Ymd): boolean {
  if (!isOpen(row)) return false;
  switch (tile) {
    case "overdue": { const d = daysToDue(row, today); return d !== null && d < 0; }
    case "due3": { const d = daysToDue(row, today); return d !== null && d >= 0 && d <= 3; }
    case "ao": return row.not_viewed_by_ao;
    case "limitation60": { const d = daysToLimitation(row, today); return row.is_assessment && d !== null && d <= 60; }
  }
}

export function inTileFilter(row: WorkItemRow, tile: TileFilter, today: Ymd): boolean {
  switch (tile) {
    case "": return true;
    case "nodate": return isOpen(row) && daysToDue(row, today) === null;
    case "drafts": return isOpen(row) && row.drafts_to_review > 0;
    default: return inRiskTile(row, tile, today);
  }
}

/** Limitation chip (§3.3): assessment rows whose clock ends within N days, past ones included. */
export function inLimitation(row: WorkItemRow, days: number, today: Ymd): boolean {
  if (!isOpen(row) || !row.is_assessment) return false;
  const d = daysToLimitation(row, today);
  return d !== null && d <= days;
}

export interface WindowCounts {
  issued: Record<WindowDays, number>;
  due: Record<WindowDays, number>;
  tiles: Record<RiskTile, number>;
}

export function countWindows(rows: WorkItemRow[], today: Ymd): WindowCounts {
  const out: WindowCounts = { issued: { 7: 0, 15: 0, 30: 0 }, due: { 7: 0, 15: 0, 30: 0 }, tiles: { overdue: 0, due3: 0, ao: 0, limitation60: 0 } };
  for (const r of rows) {
    for (const n of WINDOW_DAYS) {
      if (inWindow(r, "issued", n, today)) out.issued[n]++;
      if (inWindow(r, "due", n, today)) out.due[n]++;
    }
    for (const t of RISK_TILES) if (inRiskTile(r, t, today)) out.tiles[t]++;
  }
  return out;
}
