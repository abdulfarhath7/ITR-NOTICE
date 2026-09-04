import { Chip } from "@/components/ui/chip";
import type { Notice } from "@/lib/api";
import { dueInDays, dueLabel } from "@/lib/format";

/** The countdown chip: red inside three days or already gone, amber to a
 *  fortnight, green beyond it. A date Claude read out of the PDF carries its
 *  own hue alongside, so a generated deadline never wears the portal's word. */
export function DueChip({ notice }: { notice: Notice }): JSX.Element {
  if (!notice.due_date) return <Chip tone="none">no date</Chip>;

  const days = dueInDays(notice.due_date);
  // A date this side cannot read is still worth showing verbatim, uncoloured.
  if (days === null) return <Chip tone="none">{notice.due_date}</Chip>;

  const tone = days < 3 ? "late" : days <= 14 ? "soon" : "ok";

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Chip tone={tone} title={notice.due_date}>
        {dueLabel(days)}
      </Chip>
      {notice.due_date_source === "claude" ? (
        <Chip tone="ai" title={notice.due_date_basis ?? "found by Claude"}>
          ✦ by Claude
        </Chip>
      ) : null}
    </span>
  );
}
