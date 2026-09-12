/** The due-date cell. Text comes from `describeDue`; this only picks the
 *  tone class and adds the unverified marker for "Not stated". */
import type { DueDescription } from "../lib/due";

const TONE_CLASS = { danger: "late", warning: "soon", normal: "ok", muted: "none" } as const;

export default function DueText({ due, chip = false }: { due: DueDescription; chip?: boolean }) {
  const cls = `${chip ? "chip " : "due "}${TONE_CLASS[due.tone]}`;
  return (
    <span className={cls} title={due.unverified ? "the portal did not state a date" : undefined}>
      {due.text}
      {due.unverified ? <span className="unverified" aria-label="unverified"> ?</span> : null}
    </span>
  );
}
