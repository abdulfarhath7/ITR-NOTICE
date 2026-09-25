/** Per-device calendar preferences (docs/19 §5): `lcc.calendar.prefs.v1`
 *  `{ mode, view, muted[], scope, noticesDate }`, read with the same
 *  tolerant parse as vcfo's `parseCalendarViewPrefs`. */

export type CalendarMode = "minimized" | "maximized";
export type CalendarView = "month" | "year" | "agenda";
export type CalendarScope = "all" | "applies" | "overdue";
export type NoticesDate = "due" | "issued";

export interface CalendarPrefs {
  mode: CalendarMode;
  view: CalendarView;
  muted: string[];
  scope: CalendarScope;
  noticesDate: NoticesDate;
}

const KEY = "lcc.calendar.prefs.v1";

export const DEFAULT_PREFS: CalendarPrefs = { mode: "minimized", view: "month", muted: [], scope: "all", noticesDate: "due" };

export function parseCalendarPrefs(raw: unknown): CalendarPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return DEFAULT_PREFS;
  const v = raw as Record<string, unknown>;
  return {
    mode: v.mode === "maximized" ? "maximized" : "minimized",
    view: v.view === "year" || v.view === "agenda" ? v.view : "month",
    muted: Array.isArray(v.muted) ? v.muted.filter((x): x is string => typeof x === "string") : [],
    scope: v.scope === "applies" || v.scope === "overdue" ? v.scope : "all",
    noticesDate: v.noticesDate === "issued" ? "issued" : "due",
  };
}

export function readCalendarPrefs(): CalendarPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? parseCalendarPrefs(JSON.parse(raw) as unknown) : DEFAULT_PREFS;
  } catch { return DEFAULT_PREFS; }
}

export function writeCalendarPrefs(patch: Partial<CalendarPrefs>): CalendarPrefs {
  const next = { ...readCalendarPrefs(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* a locked-down profile is fine */ }
  return next;
}
