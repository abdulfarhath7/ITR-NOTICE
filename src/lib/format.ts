/** Small formatters shared by every screen. Nothing here talks to the API. */

/** Whole days from local midnight to a portal date string. `null` when the
 *  notice carries no date, or one this side cannot read. */
export function dueInDays(due: string | null | undefined): number | null {
  if (!due) return null;
  const at = Date.parse(due);
  if (Number.isNaN(at)) return null;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  return Math.round((at - midnight.getTime()) / 86_400_000);
}

/** SQLite stamps are `YYYY-MM-DD HH:MM:SS` in UTC with no zone marker. */
export function relTime(stamp: string | null | undefined): string {
  if (!stamp) return "";
  const at = Date.parse(`${stamp.replace(" ", "T")}Z`);
  if (Number.isNaN(at)) return stamp;
  const seconds = Math.max(0, (Date.now() - at) / 1000);
  if (seconds < 90) return "just now";
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** The countdown chip's words: "overdue 4d", "today", "12d". */
export function dueLabel(days: number): string {
  if (days < 0) return `overdue ${Math.abs(days)}d`;
  if (days === 0) return "today";
  return `${days}d`;
}

/** Three answers, not two - the portal does not always say. */
export function respondedLabel(value: 1 | 0 | null): string {
  if (value === null || value === undefined) return "Unknown";
  return value ? "Yes" : "No";
}

export const dash = "—";

export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return dash;
  return String(value);
}
