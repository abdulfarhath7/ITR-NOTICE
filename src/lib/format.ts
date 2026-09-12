/** Small formatters shared by every screen. Nothing here talks to the API. */

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

export const dash = "—";

export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return dash;
  return String(value);
}
