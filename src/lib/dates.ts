/** Date-only values, day arithmetic in Asia/Kolkata (docs/02, docs/15).
 *
 *  Everything stored is `YYYY-MM-DD`. Portal shapes (`17-Aug-2026`,
 *  `17/08/2026`) are accepted on the way in and always read day-first. */

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export interface Ymd { y: number; m: number; d: number }

function valid(y: number, m: number, d: number): Ymd | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d ? { y, m, d } : null;
}

/** Parse a date. `null` for blank, `-`, `Not Available` and anything
 *  unreadable — never today, never a guess. */
export function parseDate(text: string | null | undefined): Ymd | null {
  if (!text) return null;
  const raw = text.trim();
  if (!raw || raw === "-" || raw.toLowerCase() === "not available") return null;
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = raw.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    return mon < 0 ? null : valid(+m[3], mon + 1, +m[1]);
  }
  m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return valid(+m[3], +m[2], +m[1]);   // day first, always
  return null;
}

export function toIso(d: Ymd): string {
  return `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}

/** Days since the epoch for a calendar date; the difference of two of
 *  these is a whole number of days with no time-zone in it. */
export function dayNumber(d: Ymd): number {
  return Math.round(Date.UTC(d.y, d.m - 1, d.d) / 86_400_000);
}

export function daysBetween(from: Ymd, to: Ymd): number {
  return dayNumber(to) - dayNumber(from);
}

/** Today's calendar date in Asia/Kolkata, whatever the machine's zone.
 *  UTC would be a day behind every evening after 17:30 UTC. */
export function todayIst(now: Date = new Date()): Ymd {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => +(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** `22 Sep`, or `22 Sep 2025` when the year is not this one. */
export function shortDate(d: Ymd, today: Ymd): string {
  const mon = MONTHS[d.m - 1];
  const label = `${d.d} ${mon[0].toUpperCase()}${mon.slice(1)}`;
  return d.y === today.y ? label : `${label} ${d.y}`;
}
