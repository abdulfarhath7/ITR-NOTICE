/** The due-date cell. Text comes from `describeDue`; this only picks the
 *  tone class and adds the unverified marker for "Not stated". */
import type { DueDescription } from "../lib/due";

export default function DueText({ due }: { due: DueDescription }) {
  return (
    <span className={`due ${due.tone}`} title={due.unverified ? "the portal did not state a date" : undefined}>
      {due.text}
      {due.unverified ? <span className="unverified" aria-label="unverified">unverified</span> : null}
    </span>
  );
}
