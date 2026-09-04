import { useMemo } from "react";

import type { Notice, Run } from "@/lib/api";
import { dueInDays, relTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "plain" | "warn" | "ok";

const TONE: Record<Tone, string> = {
  plain: "text-text",
  warn: "text-warn",
  ok: "text-ok",
};

function Stat({ value, label, tone = "plain" }: { value: number; label: string; tone?: Tone }) {
  return (
    <div className="rounded-lg border border-hairline bg-panel px-3.5 py-2.5">
      {/* Zero of a thing is not a warning: only a count that asks for work is coloured. */}
      <div
        className={cn(
          "text-xl font-semibold leading-tight tracking-tight",
          value === 0 ? "text-faint" : TONE[tone],
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-2xs text-faint">{label}</div>
    </div>
  );
}

function Strong({ children }: { children: string | number }) {
  return <b className="font-semibold text-muted">{children}</b>;
}

/** One line, and it stays one line: a failed run's message is a whole sentence,
 *  so it lives in the tooltip rather than across the top of the page. */
function LastSync({ run }: { run: Run | null }) {
  const line = "truncate px-0.5 text-xs text-faint";
  if (!run) return <p className={line}>No sync has finished yet.</p>;

  const when = relTime(run.finished) || run.finished || "";
  if (run.status !== "done") {
    return (
      <p className={line}>
        Last sync <Strong>{when}</Strong>
        {" · "}
        <span
          className="cursor-help border-b border-dotted border-current text-danger-text"
          title={run.message ?? "no reason recorded"}
        >
          {run.status ?? "failed"}
        </span>
      </p>
    );
  }
  return (
    <p className={line}>
      Last sync <Strong>{when}</Strong>
      {" · "}
      <Strong>{run.notices_new ?? 0}</Strong> new
      {" · "}
      <Strong>{run.pdfs_saved ?? 0}</Strong> PDFs saved
      {" · "}
      <Strong>{run.skipped_cached ?? 0}</Strong> already held
    </p>
  );
}

/** Five numbers, counted over everything the account holds - never over the
 *  filtered view, which would make the filters look like they changed the facts. */
export function StatCards({
  notices,
  lastRun,
}: {
  notices: Notice[];
  lastRun: Run | null;
}): JSX.Element {
  const counts = useMemo(() => {
    let week = 0;
    let noDue = 0;
    let docs = 0;
    let drafts = 0;
    for (const notice of notices) {
      const days = dueInDays(notice.due_date);
      if (days !== null && days >= 0 && days <= 7) week += 1;
      if (!notice.due_date) noDue += 1;
      if (notice.has_pdf) docs += 1;
      if (notice.has_draft) drafts += 1;
    }
    return { total: notices.length, week, noDue, docs, drafts };
  }, [notices]);

  return (
    <section className="grid gap-2">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Stat value={counts.total} label="Total notices" />
        <Stat value={counts.week} label="Due this week" />
        <Stat value={counts.noDue} label="Missing date" tone="warn" />
        <Stat value={counts.docs} label="Docs saved" />
        <Stat value={counts.drafts} label="Drafts ready" tone="ok" />
      </div>
      <LastSync run={lastRun} />
    </section>
  );
}
