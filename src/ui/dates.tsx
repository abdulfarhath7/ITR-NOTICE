/** Date cells. A NULL date is "Not stated", never blank (docs/09). */
import { plainDate } from "../lib/due";

export function DateCell({ iso, gap = false }: { iso: string | null | undefined; gap?: boolean }) {
  if (!iso) {
    return <span className="muted">Not stated{gap ? <span className="unverified">unverified</span> : null}</span>;
  }
  return <span className="num">{plainDate(iso)}</span>;
}

/** `2026-09-12T14:03:22.117Z` -> `12 Sep, 14:03` in the local zone. */
export function stamp(iso: string | null | undefined): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
