import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Status chips. Colour carries meaning here and nowhere decorative:
 *  late = the date has gone, soon = inside a fortnight, ok = room to work,
 *  none = the notice states no date at all, ai = Claude wrote it. */
const chipVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium leading-4",
  {
    variants: {
      tone: {
        late: "bg-danger-soft text-danger-text",
        soon: "bg-warn-soft text-warn-text",
        watch: "bg-info-soft text-info-text",
        ok: "bg-ok-soft text-ok-text",
        none: "bg-raised text-muted",
        done: "bg-raised text-faint",
        ai: "bg-ai-soft text-ai",
      },
    },
    defaultVariants: { tone: "none" },
  },
);

export type ChipProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof chipVariants>;

export function Chip({ className, tone, ...props }: ChipProps) {
  return <span className={cn(chipVariants({ tone }), className)} {...props} />;
}

export { chipVariants };
