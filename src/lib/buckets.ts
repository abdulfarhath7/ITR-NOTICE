/** Grouping rows into the report's buckets. Status first, then the date;
 *  the day count comes from `describeDue` and is used for ordering only. */
import { describeDue, type DueDescription } from "./due";
import { parseStatus, type Status } from "./status";
import type { NoticeRow } from "./types";
import { todayIst, type Ymd } from "./dates";

export type BucketKey =
  | "overdue" | "due_3" | "due_10" | "on_track" | "no_due_date" | "responded" | "closed";

export const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "due_3", label: "Due within 3 days" },
  { key: "due_10", label: "Due within 10 days" },
  { key: "on_track", label: "On track" },
  { key: "no_due_date", label: "No due date stated" },
  { key: "responded", label: "Response submitted" },
  { key: "closed", label: "Closed" },
];

export const TO_RESPOND: BucketKey[] = ["overdue", "due_3", "due_10", "on_track", "no_due_date"];

export interface Item extends NoticeRow {
  bucket: BucketKey;
  machineStatus: Status;
  due: DueDescription;
  /** sort key only - never rendered */
  days: number | null;
}

/** The proceeding's status, with the communication's own submission
 *  outranking it: a notice that has been answered is answered even while
 *  the proceeding stays open for the next one. */
export function statusOf(row: NoticeRow): Status {
  const proc = parseStatus(row.status);
  if (proc === "closed") return "closed";
  const comm = parseStatus(row.communication_status);
  if (comm === "response_submitted") return "response_submitted";
  return proc === "unknown" ? comm : proc;
}

export function bucketOf(row: NoticeRow, today: Ymd = todayIst()): BucketKey {
  const st = statusOf(row);
  if (st === "closed") return "closed";
  if (st === "response_submitted") return "responded";
  const d = describeDue(row.due_date, st, today).days;
  if (d === null) return "no_due_date";
  if (d < 0) return "overdue";
  if (d <= 3) return "due_3";
  if (d <= 10) return "due_10";
  return "on_track";
}

export function classify(rows: NoticeRow[], today: Ymd = todayIst()): Item[] {
  return rows.map((r) => {
    const machineStatus = statusOf(r);
    const due = describeDue(r.due_date, machineStatus, today);
    return { ...r, bucket: bucketOf(r, today), machineStatus, due, days: due.days };
  });
}

export function counts(items: Item[]): Record<BucketKey | "to_respond", number> {
  const c = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<BucketKey | "to_respond", number>;
  for (const i of items) c[i.bucket]++;
  c.to_respond = TO_RESPOND.reduce((n, k) => n + c[k], 0);
  return c;
}

export function describe(i: NoticeRow): string {
  return i.description || i.proceeding_name || i.ref_id;
}
