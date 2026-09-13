/** The due-date cell. Text comes from `describeDue`; this only picks the
 *  tone class and adds the unverified marker for "Not stated". A caller
 *  that knows the gap flags can say whether the absence is a gap (the
 *  portal should have stated it) or simply nothing to state. */
import type { DueDescription } from "../lib/due";

export default function DueText({ due, unverified }: { due: DueDescription; unverified?: boolean }) {
  const marked = due.unverified && unverified !== false;
  return (
    <span className={`due ${due.tone}`} title={marked ? "the portal did not state a date" : undefined}>
      {due.text}
      {marked ? <span className="unverified" aria-label="unverified">unverified</span> : null}
    </span>
  );
}
