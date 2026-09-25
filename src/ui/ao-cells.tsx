/** Viewed by AO and Limitation, rendered the same everywhere (docs/18
 *  §3.3). Both are meaningful only on assessment proceedings; every other
 *  row shows `—` in the muted colour — never blank, never "N/A". */
import { daysBetween, parseDate, shortDate, todayIst, type Ymd } from "../lib/dates";

/** `Yes · 22 Sep` (green) · `No` (grey) · `—` when not an assessment
 *  proceeding. `No` only means something once a reply is on record; before
 *  that the cell says `—` too (Q53). */
export function AoViewedPill({ isAssessment, aoViewedOn, responseFiled, today = todayIst() }: {
  isAssessment: boolean; aoViewedOn: string | null | undefined; responseFiled: boolean; today?: Ymd;
}) {
  if (!isAssessment) return <span className="muted ao-dash" title="Applies to assessment proceedings only">—</span>;
  const d = parseDate(aoViewedOn);
  if (d) return <span className="pill success ao-pill">Yes · {shortDate(d, today)}</span>;
  if (!responseFiled) return <span className="muted ao-dash" title="No reply on record yet">—</span>;
  return <span className="pill ao-pill">No</span>;
}

/** `31 Mar 2027 · 187d`, mono; red within 30 days (or past), amber within
 *  60. `—` when not an assessment proceeding; `Not stated` when it is but
 *  no date is known. */
export function LimitationCell({ isAssessment, date, today = todayIst(), unverified = false }: {
  isAssessment: boolean; date: string | null | undefined; today?: Ymd; unverified?: boolean;
}) {
  if (!isAssessment) return <span className="muted ao-dash" title="Applies to assessment proceedings only">—</span>;
  const d = parseDate(date);
  if (!d) {
    return <span className="muted">Not stated{unverified ? <span className="unverified" aria-label="unverified">unverified</span> : null}</span>;
  }
  const days = daysBetween(today, d);
  const tone = days <= 30 ? "danger" : days <= 60 ? "warning" : "normal";
  const text = days < 0 ? `${-days}d past` : `${days}d`;
  return <span className={`due ${tone} mono lim-cell`}>{shortDate(d, { ...today, y: 0 })} · {text}</span>;
}

/** Whole days to the limitation date, for the header's "days left". */
export function limitationDays(date: string | null | undefined, today: Ymd = todayIst()): number | null {
  const d = parseDate(date);
  return d ? daysBetween(today, d) : null;
}
