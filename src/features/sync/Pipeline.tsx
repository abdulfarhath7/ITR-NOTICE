import { Check } from "lucide-react";

import { useHub } from "@/hooks/useHub";
import { cn } from "@/lib/utils";
import type { StageCounts } from "@/lib/ws";

const STAGES = [
  { key: "login", label: "Log in" },
  { key: "list", label: "Open list" },
  { key: "walk", label: "Walk proceedings" },
  { key: "download", label: "Download PDFs" },
  { key: "done", label: "Done" },
] as const;

/** The server sends raw counts; this is what a person would say out loud.
 *  Anything unrecognised still shows, as "key value", rather than vanishing. */
function countText(stage: string, counts: StageCounts): string {
  const has = (key: string): boolean => {
    const value = counts[key];
    return value !== null && value !== undefined && value !== "";
  };

  const parts: string[] = [];
  // Deliberately terse: the step is the headline and the log underneath
  // carries the detail. Naming the tab, the sub-tab and the proceeding here
  // would turn the stepper into a wall of text.
  if (stage === "download" && has("notice") && has("of")) {
    parts.push(`${counts.notice}/${counts.of}`);
  } else if (stage === "walk") {
    if (has("card") && has("of")) parts.push(`${counts.card}/${counts.of}`);
    else if (has("items")) parts.push(`${counts.items}`);
  } else if (stage === "done") {
    if (has("notices")) parts.push(`${counts.notices} notices`);
    if (has("downloaded")) parts.push(`${counts.downloaded} new`);
  }
  if (parts.length) return parts.join(" · ");

  return Object.entries(counts)
    .filter(([, value]) => value !== null && value !== undefined && value !== "" && value !== false)
    .map(([key, value]) => `${key} ${value}`)
    .join(" · ");
}

export function Pipeline(): JSX.Element {
  const { stage, counts } = useHub();
  // A stage this build has never heard of leaves every step neutral rather
  // than snapping the stepper back to the first one.
  const at = STAGES.findIndex((step) => step.key === stage);

  return (
    <ol className="flex flex-wrap items-center gap-y-1" aria-label="Sync pipeline">
      {STAGES.map((step, index) => {
        const done = at >= 0 && index < at;
        const active = at >= 0 && index === at;
        const count = active && stage ? countText(stage, counts) : "";

        return (
          <li key={step.key} className="flex items-center">
            <span
              aria-current={active ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 text-xs",
                done ? "text-muted" : active ? "text-text" : "text-faint",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-2xs font-medium",
                  done
                    ? "bg-raised text-muted"
                    : active
                      ? "bg-action text-white"
                      : "bg-raised text-faint",
                )}
              >
                {done ? <Check className="size-3" aria-hidden="true" /> : index + 1}
              </span>
              <span className={active ? "font-medium" : undefined}>{step.label}</span>
              {count ? (
                <span className="rounded-full bg-raised px-1.5 py-0.5 text-2xs text-muted">
                  {count}
                </span>
              ) : null}
            </span>
            {index < STAGES.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn("mx-2 h-px w-5 shrink-0", done ? "bg-divider" : "bg-hairline")}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
