/** Time windows for the Attention lanes and strip (docs/16 §1.2, §1.5).
 *  Pure: `today` is always a parameter, never read from the clock here.
 *
 *  Windows are exclusive (Q30): an item is in at most one Issued bucket
 *  and at most one Due bucket. A NULL date is in no bucket — never a
 *  guessed one. Only open items are counted. */
import { daysBetween, parseDate, type Ymd } from "./dates";
import { isSettled, parseStatus } from "./status";
import type { WorkItemRow } from "./types";

export type IssuedBucket = "last7" | "i8_15" | "i16_30";
export type DueBucket = "next7" | "d8_15" | "d16_30" | "later";
export type Tile = "overdue" | "due48" | "nodate" | "drafts";

export const ISSUED_BUCKETS: IssuedBucket[] = ["last7", "i8_15", "i16_30"];
export const DUE_BUCKETS: DueBucket[] = ["next7", "d8_15", "d16_30", "later"];
export const TILES: Tile[] = ["overdue", "due48", "nodate", "drafts"];

/** Labels exactly as docs/16 §11. */
export const BUCKET_LABEL: Record<IssuedBucket | DueBucket, string> = {
  last7: "Last 7 d", i8_15: "8–15 d", i16_30: "16–30 d",
  next7: "Next 7 d", d8_15: "8–15 d", d16_30: "16–30 d", later: "Later",
};
/** Long form for chips and the list's summary line. */
export const BUCKET_SUMMARY: Record<IssuedBucket | DueBucket, string> = {
  last7: "Issued last 7 days", i8_15: "Issued 8–15 days ago", i16_30: "Issued 16–30 days ago",
  next7: "Due next 7 days", d8_15: "Due in 8–15 days", d16_30: "Due in 16–30 days", later: "Due later",
};
export const TILE_LABEL: Record<Tile, string> = {
  overdue: "Overdue", due48: "Due in 48h", nodate: "No due date", drafts: "Drafts to review",
};
export const TILE_TONE: Record<Tile, "danger" | "warning" | "muted"> = {
  overdue: "danger", due48: "warning", nodate: "muted", drafts: "muted",
};

function isOpen(row: WorkItemRow): boolean {
  return !isSettled(parseStatus(row.status));
}

/** Manual when a person entered it, else the portal's (Q14). */
export function effectiveDue(row: WorkItemRow): string | null {
  return row.manual_due_date ?? row.due_date ?? null;
}

/** Whole days from today to the effective due date; null when none. */
export function daysToDue(row: WorkItemRow, today: Ymd): number | null {
  const d = parseDate(effectiveDue(row));
  return d ? daysBetween(today, d) : null;
}

/** Whole days since the issued date; null when none. */
export function daysSinceIssued(row: WorkItemRow, today: Ymd): number | null {
  const d = parseDate(row.issued_on);
  return d ? daysBetween(d, today) : null;
}

export function issuedBucket(row: WorkItemRow, today: Ymd): IssuedBucket | null {
  if (!isOpen(row)) return null;
  const d = daysSinceIssued(row, today);
  if (d === null || d < 0) return null;
  if (d <= 7) return "last7";
  if (d <= 15) return "i8_15";
  if (d <= 30) return "i16_30";
  return null;
}

export function dueBucket(row: WorkItemRow, today: Ymd): DueBucket | null {
  if (!isOpen(row)) return null;
  const d = daysToDue(row, today);
  if (d === null || d < 0) return null;
  if (d <= 7) return "next7";
  if (d <= 15) return "d8_15";
  if (d <= 30) return "d16_30";
  return "later";
}

/** Strip tiles are not exclusive: an overdue item with a draft waiting is
 *  in both Overdue and Drafts to review. */
export function inTile(row: WorkItemRow, tile: Tile, today: Ymd): boolean {
  if (!isOpen(row)) return false;
  const d = daysToDue(row, today);
  switch (tile) {
    case "overdue": return d !== null && d < 0;
    case "due48": return d !== null && d >= 0 && d <= 2;
    case "nodate": return d === null;
    case "drafts": return row.drafts_to_review > 0;
  }
}

export interface BucketCounts {
  issued: Record<IssuedBucket, number>;
  due: Record<DueBucket, number>;
  tiles: Record<Tile, number>;
}

export function countBuckets(rows: WorkItemRow[], today: Ymd): BucketCounts {
  const out: BucketCounts = {
    issued: { last7: 0, i8_15: 0, i16_30: 0 },
    due: { next7: 0, d8_15: 0, d16_30: 0, later: 0 },
    tiles: { overdue: 0, due48: 0, nodate: 0, drafts: 0 },
  };
  for (const r of rows) {
    const i = issuedBucket(r, today);
    if (i) out.issued[i]++;
    const d = dueBucket(r, today);
    if (d) out.due[d]++;
    for (const t of TILES) if (inTile(r, t, today)) out.tiles[t] += t === "drafts" ? r.drafts_to_review : 1;
  }
  return out;
}
