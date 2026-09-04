import type { Notice } from "@/lib/api";
import { cn } from "@/lib/utils";

/** `null` is a third answer, not a missing second one. */
type Mark = { label: string; on: boolean | null; detail: string };

/** Four dots per row, so the table reads as the checklist it is: do we hold
 *  the document, do we know the deadline, is there a draft waiting, and has a
 *  reply been filed. Native titles rather than Radix tooltips - four of these
 *  per row across hundreds of rows is not worth the tree. */
export function StatusTicks({ notice }: { notice: Notice }): JSX.Element {
  // The portal does not always say whether a reply is on file; unknown is
  // drawn dashed rather than claiming "not yet".
  const replied = notice.responded === null ? null : notice.responded === 1;

  const marks: Mark[] = [
    {
      label: "PDF",
      on: notice.has_pdf === 1,
      detail: notice.has_pdf ? "PDF saved" : "no PDF stored yet",
    },
    {
      label: "date",
      on: Boolean(notice.due_date),
      detail: notice.due_date ? `due ${notice.due_date}` : "no due date on this notice",
    },
    {
      label: "draft",
      on: notice.has_draft === 1,
      detail: notice.has_draft ? "draft written" : "no draft yet",
    },
    {
      label: "responded on portal",
      on: replied,
      detail:
        replied === null
          ? "the portal did not say at the last sync"
          : replied
            ? "a reply is filed on the portal"
            : "no reply filed yet",
    },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {marks.map((mark) => (
        <span
          key={mark.label}
          role="img"
          title={`${mark.label}: ${mark.detail}`}
          aria-label={`${mark.label} ${mark.on === null ? "unknown" : mark.on ? "done" : "not yet"}`}
          className={cn(
            "block size-2.5 rounded-full border-2",
            mark.on === null
              ? "border-dashed border-faint"
              : mark.on
                ? "border-ok bg-ok"
                : "border-divider",
          )}
        />
      ))}
    </div>
  );
}
