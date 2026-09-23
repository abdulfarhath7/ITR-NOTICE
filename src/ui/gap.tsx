/** A value the portal may not have stated: "Not stated", with the
 *  unverified marker when the column is gap-flagged (docs/09). */
export default function Gap({ value, gaps, column, mono = false }: { value: string | null | undefined; gaps: string[]; column: string; mono?: boolean }) {
  if (value) return <span className={mono ? "mono" : undefined}>{value}</span>;
  return <span className="muted">Not stated{gaps.includes(column) ? <span className="unverified">unverified</span> : null}</span>;
}
