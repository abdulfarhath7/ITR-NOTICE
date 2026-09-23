/** The one due-date renderer (docs/09 "Due dates", docs/15 bug 1).
 *
 *  No screen prints a day count of its own. Every cell, chip and export
 *  column comes through `describeDue()`, which is why a raw negative number
 *  cannot appear anywhere. */
import { daysBetween, parseDate, shortDate, todayIst, type Ymd } from "./dates";
import { isSettled, parseStatus, type Status } from "./status";

export type Tone = "danger" | "warning" | "normal" | "muted";

export interface DueDescription {
  text: string;
  tone: Tone;
  /** `Not stated` carries the unverified marker; nothing else does. */
  unverified: boolean;
  /** Whole days from today, for sorting only. Never rendered. */
  days: number | null;
}

export function describeDue(
  due: string | null | undefined,
  status: Status | string | null | undefined,
  today: Ymd = todayIst(),
): DueDescription {
  const st = parseStatus(typeof status === "string" ? status : null);
  const date = parseDate(due);
  if (!date) {
    // Status still wins: a settled item with no date is simply settled,
    // not a gap to chase.
    if (isSettled(st)) return { text: st === "closed" ? "Closed" : "Submitted", tone: "muted", unverified: false, days: null };
    return { text: "Not stated", tone: "muted", unverified: true, days: null };
  }
  const days = daysBetween(today, date);
  // Status wins over the date: a settled item is never overdue.
  if (isSettled(st)) {
    const word = st === "closed" ? "Closed" : "Submitted";
    return { text: `${word} · was due ${shortDate(date, today)}`, tone: "muted", unverified: false, days };
  }
  if (days < 0) {
    const n = -days;
    return { text: `Overdue by ${n} ${n === 1 ? "day" : "days"}`, tone: "danger", unverified: false, days };
  }
  if (days === 0) return { text: "Due today", tone: "danger", unverified: false, days };
  if (days <= 7) {
    return { text: `Due in ${days} ${days === 1 ? "day" : "days"}`, tone: "warning", unverified: false, days };
  }
  return { text: `Due ${shortDate(date, today)}`, tone: "normal", unverified: false, days };
}

/** `2 Aug 2026` for a stated date, `Not stated` otherwise — for cells that
 *  show the date itself rather than the countdown. */
export function plainDate(iso: string | null | undefined): string {
  const d = parseDate(iso);
  return d ? `${shortDate(d, { y: 0, m: 1, d: 1 })}` : "Not stated";
}

/** `· 41 days ·` for the quiet stretch between two thread events. It is an
 *  interval between two past dates, never a countdown (QUESTIONS Q26). */
export function describeGap(days: number): string {
  return `· ${days} ${days === 1 ? "day" : "days"} ·`;
}
