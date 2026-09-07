/** The report card's numbers, counted the way `app/report.py` counts them.
 *
 * The web tool built this server-side so the dashboard and the workbook could
 * never disagree. There is no server here, so the same rules run once, on the
 * rows already loaded, and both the report and `exportXlsx` read the result.
 */
import { BUCKETS, TO_RESPOND, type BucketKey, type Item } from "./buckets";

export type ChipKey = BucketKey | "to_respond";

/** report.py's own words, in report.py's own order. */
export const CHIPS: { key: ChipKey; label: string }[] = [
  { key: "to_respond", label: "To respond" },
  { key: "overdue", label: "Overdue" },
  { key: "due_3", label: "Due ≤3 days" },
  { key: "due_10", label: "Due ≤10 days" },
  { key: "on_track", label: "On track (>10d)" },
  { key: "no_due_date", label: "No due date yet" },
  { key: "responded", label: "Responded" },
  { key: "closed", label: "Closed" },
];

/** Which tint each chip wears - the old app.js BUCKET_CLASS table. */
export const CHIP_CLASS: Record<ChipKey, string> = {
  to_respond: "watch", overdue: "late", due_3: "soon", due_10: "watch",
  on_track: "ok", no_due_date: "none", responded: "ok", closed: "done",
};

/** "To respond" is a total of five buckets, so filtering by it means "any of
 *  these" - report.py's GROUPS, repeated on the rows already in the browser. */
export function inChip(item: Item, key: ChipKey): boolean {
  return key === "to_respond" ? TO_RESPOND.includes(item.bucket) : item.bucket === key;
}

/** What the last finished run did. The desktop core never writes the `runs`
 *  table, so this is remembered from the sidecar's own `sync_done` stats. */
export interface LastRun {
  finished: string | null;
  status: string;
  message?: string | null;
  notices_new: number;
  pdfs_saved: number;
  skipped_cached: number;
}

export interface Summary {
  chips: { key: ChipKey; label: string; count: number }[];
  attention: Item[];
  scanned: number;
}

export function buildSummary(items: Item[]): Summary {
  const tally = Object.fromEntries(BUCKETS.map((b) => [b.key, 0])) as Record<ChipKey, number>;
  for (const i of items) tally[i.bucket] += 1;
  tally.to_respond = TO_RESPOND.reduce((n, k) => n + tally[k], 0);

  // The dates that have gone, the ones about to, and the notices with no date
  // at all - which are the easiest to forget. Anything answered is out by
  // virtue of its bucket.
  const attention = items
    .filter((i) => i.bucket === "overdue" || i.bucket === "due_3" || i.bucket === "no_due_date")
    .sort((a, b) => {
      const an = a.days === null, bn = b.days === null;
      if (an !== bn) return an ? 1 : -1;
      return (a.days ?? 0) - (b.days ?? 0);
    });

  return {
    chips: CHIPS.map((c) => ({ ...c, count: tally[c.key] })),
    attention,
    scanned: items.length,
  };
}

/** localStorage, not the archive: a run summary is a convenience, and losing
 *  it costs a line of text. TODO: read the `runs` table once the Rust core
 *  actually writes one (docs/03-api-contract.md has no command for it). */
const RUN_KEY = "notice-desk.last-run";

export function loadLastRun(): LastRun | null {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    return raw ? (JSON.parse(raw) as LastRun) : null;
  } catch {
    return null;
  }
}

export function saveLastRun(run: LastRun): void {
  try {
    localStorage.setItem(RUN_KEY, JSON.stringify(run));
  } catch {
    /* a private window is not a reason to fail a sync */
  }
}

/** The shape relTime() reads: `YYYY-MM-DD HH:MM:SS`, UTC, no zone marker. */
export function stampNow(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}
