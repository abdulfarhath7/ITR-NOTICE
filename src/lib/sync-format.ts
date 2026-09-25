/** Pure formatting for the Sync screen (docs/17 §6.1). Every clock here is
 *  IST: India has no daylight saving, so a fixed +5:30 offset is exact. */
import type { SyncOverview, SyncRow } from "./types";

const IST_MS = 330 * 60_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAYS_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const pad = (n: number) => String(n).padStart(2, "0");

/** IST wall clock of an instant, read through UTC getters. */
function ist(ms: number): Date { return new Date(ms + IST_MS); }

function epoch(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** `≈ 42 min`, `≈ 1 h 10 min`; empty when there is nothing to estimate. */
export function estimateLabel(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `≈ ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `≈ ${h} h ${m} min` : `≈ ${h} h`;
}

/** `0:38`, `12:05`, `1:02:05`: a stopwatch. */
export function stopwatch(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Seconds from an ISO instant to now. */
export function secondsSince(iso: string | null | undefined, now: number): number {
  const t = epoch(iso);
  return t === null ? 0 : Math.max(0, (now - t) / 1000);
}

/** `02:47`: hours and minutes, zero-padded, for elapsed run time. */
export function elapsedHm(seconds: number): string {
  const min = Math.max(0, Math.floor(seconds / 60));
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/** `1:10`: hours and minutes left. */
export function leftHm(seconds: number): string {
  const min = Math.max(0, Math.ceil(seconds / 60));
  return `${Math.floor(min / 60)}:${pad(min % 60)}`;
}

/** `01:00` in IST. */
export function istClock(iso: string | null | undefined): string {
  const t = epoch(iso);
  if (t === null) return "—";
  const d = ist(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Seconds until the run window closes: the first `HH:MM` IST after the
 *  run started, so a 01:00–06:00 window started at 01:00 ends at 06:00 the
 *  same night. `null` when the end time is not readable. */
export function windowLeftSeconds(startedAt: string, windowEnd: string, now: number): number | null {
  const t = epoch(startedAt);
  const m = /^(\d{1,2}):(\d{2})$/.exec(windowEnd.trim());
  if (t === null || !m) return null;
  const d = ist(t);
  let end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), +m[1], +m[2]) - IST_MS;
  if (end <= t) end += 86_400_000;
  return Math.max(0, (end - now) / 1000);
}

/** `tonight 01:00`, `Monday 01:00`, or null when no run is scheduled.
 *  `next_run_at` is IST `YYYY-MM-DD HH:MM`. A small-hours run tomorrow is
 *  still "tonight" to the person reading it in the evening. */
export function nextRunPhrase(nextRunAt: string | null, now: number): string | null {
  if (!nextRunAt) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(nextRunAt);
  if (!m) return null;
  const runDay = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const today = ist(now);
  const todayDay = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = Math.round((runDay - todayDay) / 86_400_000);
  const hour = +m[4];
  const clock = `${m[4]}:${m[5]}`;
  if (days === 0 || (days === 1 && hour < 12)) return `tonight ${clock}`;
  const wd = (new Date(runDay).getUTCDay() + 6) % 7;
  return `${WEEKDAYS_LONG[wd]} ${clock}`;
}

/** The line under a finished run: "Next run tonight 01:00". */
export function nextRunLine(o: SyncOverview, now: number): string {
  const p = nextRunPhrase(o.next_run_at, now);
  return p ? `Next run ${p}` : "No scheduled run";
}

/** "tonight at 01:00", "on Monday at 01:00", for sentences. */
export function nextRunSentence(o: SyncOverview, now: number): string {
  const p = nextRunPhrase(o.next_run_at, now);
  if (!p) return "at the next run";
  const [day, clock] = p.split(" ");
  return day === "tonight" ? `tonight at ${clock}` : `on ${day} at ${clock}`;
}

/** 1 = Monday … 7 = Sunday, as the scheduler stores it. */
export function weekdayShort(n: number): string {
  return WEEKDAYS_SHORT[(Math.max(1, Math.min(7, n || 7)) - 1)];
}

/** `Deep · full`, `Deep · 2 AYs`, `Deep · since 1 Apr`. */
export function scopeLabel(row: SyncRow): string {
  if (row.scope === "item") return "Item";
  if (row.scope === "sweep") return "Sweep";
  const label = row.deep_label ?? "full";
  const since = /^since (\d{4})-(\d{2})-(\d{2})$/.exec(label);
  return since ? `Deep · since ${+since[3]} ${MONTHS[+since[2] - 1]}` : `Deep · ${label}`;
}

export function scopeTone(row: SyncRow): "success" | "accent" | "" {
  return row.scope === "sweep" ? "success" : row.scope === "deep" ? "accent" : "";
}

/** `6:12 am` today, `Yesterday` or `22 Sep` before, `22 Sep 2025` in another year. */
export function lastSweepShort(iso: string | null | undefined, now: number): string {
  const t = epoch(iso);
  if (t === null) return "—";
  const d = ist(t);
  const n = ist(now);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  if (day === today) {
    const h = d.getUTCHours();
    return `${h % 12 || 12}:${pad(d.getUTCMinutes())} ${h < 12 ? "am" : "pm"}`;
  }
  if (today - day === 86_400_000) return "Yesterday";
  const base = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === n.getUTCFullYear() ? base : `${base} ${d.getUTCFullYear()}`;
}

/** Full IST stamp for a tooltip. */
export function istStamp(iso: string | null | undefined): string | undefined {
  const t = epoch(iso);
  if (t === null) return undefined;
  const d = ist(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} IST`;
}

export type StatusTone = "accent" | "success" | "danger" | "warning" | "muted" | "normal";

/** The queue table's status text, exactly as docs/17 §6.1 words it. */
export function statusText(row: SyncRow, now: number): { text: string; tone: StatusTone } {
  const detail = row.detail?.trim() || null;
  switch (row.status) {
    case "running": return { text: `Running · ${stopwatch(secondsSince(row.started_at, now))}`, tone: "accent" };
    case "awaiting": {
      const what = detail ? (detail.toUpperCase() === "OTP" ? "OTP" : detail.toLowerCase()) : null;
      return { text: what ? `Awaiting you · ${what}` : "Awaiting you", tone: "warning" };
    }
    case "done": return { text: row.duration_s !== null ? `Done · ${stopwatch(row.duration_s)}` : "Done", tone: "normal" };
    case "skipped": return { text: "Skipped · unchanged", tone: "muted" };
    case "failed":
    case "parked": return { text: detail ? `Failed · ${detail}` : "Failed", tone: "danger" };
    case "incomplete": return { text: detail ? `Stopped · ${detail}` : "Stopped", tone: "warning" };
    case "queued": return { text: detail ? `Queued · ${detail}` : "Queued", tone: "muted" };
    case "dormant": return { text: "Dormant", tone: "muted" };
    case "paused": return { text: detail ? `Paused · ${detail}` : "Paused", tone: "muted" };
    default: return { text: "—", tone: "muted" };
  }
}

export function isFailed(row: SyncRow): boolean {
  return row.status === "failed" || row.status === "parked";
}
