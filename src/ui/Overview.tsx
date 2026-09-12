/** The situation rail: five counters and the one-line last-sync note.
 *
 * Counted over everything the account holds - never over the filtered view,
 * which would make the filters look like they changed the facts. */
import type { ReactNode } from "react";
import { relTime } from "../lib/format";
import { classify } from "../lib/buckets";
import type { LastRun } from "../lib/summary";
import type { NoticeRow } from "../lib/types";

/** 16px line icons, one per counter. They are decoration for the number, so
 *  they carry no label of their own. */
const I = {
  stack: <><path d="M3 7l9-4 9 4-9 4-9-4Z" /><path d="M3 12l9 4 9-4" /><path d="M3 17l9 4 9-4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.2 9.3a2.9 2.9 0 1 1 3.6 3.4v1.4" /><path d="M12.8 17.4h-.01" /></>,
  file: <><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" /></>,
  pen: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" /></>,
};

function Stat({ tone, value, label, icon }: {
  tone?: string; value: number | null; label: string; icon: ReactNode;
}) {
  const zero = value === 0 ? " zero" : "";
  return (
    <div className={"stat" + (tone ? ` ${tone}` : "") + zero}>
      <span className="ico" aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
      </span>
      <div className="n">{value === null ? "—" : value}</div>
      <div className="k">{label}</div>
      <span className="bar" aria-hidden="true" />
    </div>
  );
}

function LastSync({ run }: { run: LastRun | null }) {
  if (!run) return <p className="lastsync">No sync has finished yet.</p>;
  const when = relTime(run.finished) || run.finished || "";
  if (run.status !== "done") {
    return (
      <p className="lastsync">
        Last sync <b>{when}</b> ·{" "}
        <span className="bad" title={run.message || "no reason recorded"}>{run.status || "failed"}</span>
      </p>
    );
  }
  return (
    <p className="lastsync">
      Last sync <b>{when}</b> · <b>{run.notices_new}</b> new
      {" · "}<b>{run.pdfs_saved}</b> PDFs saved
      {" · "}<b>{run.skipped_cached}</b> already held
    </p>
  );
}

export default function Overview({ rows, loading, run }: {
  rows: NoticeRow[]; loading: boolean; run: LastRun | null;
}) {
  const n = (v: number) => (loading ? null : v);
  // Through the one renderer, so a settled item is never "due this week".
  const items = classify(rows);
  const week = items.filter((i) => i.days !== null && i.days >= 0 && i.days <= 7
    && i.bucket !== "closed" && i.bucket !== "responded").length;
  const missing = items.filter((i) => i.bucket === "no_due_date").length;

  return (
    <section className="overview">
      <div className="railhead">
        <span className="eyebrow">Situation</span>
        <span className="rule" aria-hidden="true" />
        <LastSync run={run} />
      </div>
      <div className="stats">
        <Stat value={n(rows.length)} label="Total notices" icon={I.stack} />
        <Stat value={n(week)} label="Due this week" icon={I.clock} />
        <Stat tone="warn" value={n(missing)} label="Open, no date stated" icon={I.help} />
        <Stat value={n(rows.filter((r) => r.has_pdf).length)} label="Docs saved" icon={I.file} />
        <Stat tone="ok" value={n(rows.filter((r) => r.has_draft).length)}
              label="Drafts ready" icon={I.pen} />
      </div>
    </section>
  );
}
