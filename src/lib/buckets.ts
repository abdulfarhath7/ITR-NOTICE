/** The urgency rules, mirrored from app/report.py so a chip can filter rows
 *  already in memory without a round trip. The server still counts the
 *  numbers - these two must never disagree, so the rules are copied exactly.
 */
import type { BucketKey, Notice } from "@/lib/api";
import { dueInDays } from "@/lib/format";

export type LeafBucket = Exclude<BucketKey, "to_respond">;

/** "To respond" is a total of the five outstanding buckets (GROUPS in
 *  app/report.py), so filtering by it means "any of these". */
export const BUCKET_GROUPS: Partial<Record<BucketKey, LeafBucket[]>> = {
  to_respond: ["overdue", "due_3", "due_10", "on_track", "no_due_date"],
};

/** Chip tone per bucket. Colour only where it means something. */
export const BUCKET_TONE: Record<BucketKey, "late" | "soon" | "watch" | "ok" | "none" | "done"> = {
  to_respond: "watch",
  overdue: "late",
  due_3: "soon",
  due_10: "watch",
  on_track: "ok",
  no_due_date: "none",
  responded: "ok",
  closed: "done",
};

/** A filed reply outranks every deadline; a closed proceeding outranks both. */
export function bucketOf(notice: Notice): LeafBucket {
  if ((notice.status ?? "").trim().toLowerCase() === "closed") return "closed";
  if (notice.responded) return "responded";
  const days = dueInDays(notice.due_date);
  if (days === null) return "no_due_date";
  if (days < 0) return "overdue";
  if (days <= 3) return "due_3";
  if (days <= 10) return "due_10";
  return "on_track";
}

export function inBucket(notice: Notice, key: BucketKey | ""): boolean {
  if (!key) return true;
  const group = BUCKET_GROUPS[key];
  const bucket = bucketOf(notice);
  return group ? group.includes(bucket) : bucket === key;
}
