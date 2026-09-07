import type { NoticeRow } from "./types";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** Portal dates look like 17-Aug-2026; tolerate the few other shapes the
 * web tool accepted. Returns a local-midnight Date or null. */
export function parseDate(text: string | null | undefined): Date | null {
  if (!text) return null;
  const raw = text.trim();
  let m = raw.match(/^(\d{1,2})[-/](\w{3,9})[-/](\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return new Date(+m[3], mon, +m[1]);
  }
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  return null;
}

export type BucketKey =
  | "overdue" | "due_3" | "due_10" | "on_track" | "no_due_date" | "responded" | "closed";

export const BUCKETS: { key: BucketKey; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "due_3", label: "Due within 3 days" },
  { key: "due_10", label: "Due within 10 days" },
  { key: "on_track", label: "On track" },
  { key: "no_due_date", label: "No due date yet" },
  { key: "responded", label: "Responded" },
  { key: "closed", label: "Closed" },
];

export const TO_RESPOND: BucketKey[] = ["overdue", "due_3", "due_10", "on_track", "no_due_date"];

export function daysLeft(row: NoticeRow, today = new Date()): number | null {
  const due = parseDate(row.due_date);
  if (!due) return null;
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((due.getTime() - t0.getTime()) / 86_400_000);
}

export function isOpen(row: NoticeRow): boolean {
  return (row.status ?? "").trim().toLowerCase() !== "closed";
}

/** A filed reply outranks every deadline; a closed proceeding outranks that. */
export function bucketOf(row: NoticeRow, today = new Date()): BucketKey {
  if (!isOpen(row)) return "closed";
  if (row.responded) return "responded";
  const d = daysLeft(row, today);
  if (d === null) return "no_due_date";
  if (d < 0) return "overdue";
  if (d <= 3) return "due_3";
  if (d <= 10) return "due_10";
  return "on_track";
}

export interface Item extends NoticeRow {
  bucket: BucketKey;
  days: number | null;
}

export function classify(rows: NoticeRow[], today = new Date()): Item[] {
  return rows.map((r) => ({ ...r, bucket: bucketOf(r, today), days: daysLeft(r, today) }));
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
