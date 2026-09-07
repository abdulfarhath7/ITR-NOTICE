/** The five metric cards and the one-line last-sync note.
 *
 * Counted over everything the account holds - never over the filtered view,
 * which would make the filters look like they changed the facts. */
import { dueInDays, relTime } from "../lib/format";
import type { LastRun } from "../lib/summary";
import type { NoticeRow } from "../lib/types";

function Stat({ tone, value, label }: { tone?: string; value: number | null; label: string }) {
  const zero = value === 0 ? " zero" : "";
  return (
    <div className={"stat" + (tone ? ` ${tone}` : "") + zero}>
      <div className="n">{value === null ? "—" : value}</div>
      <div className="k">{label}</div>
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
  const week = rows.filter((r) => {
    const d = dueInDays(r.due_date);
    return d !== null && d >= 0 && d <= 7;
  }).length;

  return (
    <section className="overview">
      <div className="stats">
        <Stat value={n(rows.length)} label="Total notices" />
        <Stat value={n(week)} label="Due this week" />
        <Stat tone="warn" value={n(rows.filter((r) => !r.due_date).length)} label="Missing date" />
        <Stat value={n(rows.filter((r) => r.has_pdf).length)} label="Docs saved" />
        <Stat tone="ok" value={n(rows.filter((r) => r.has_draft).length)} label="Drafts ready" />
      </div>
      <LastSync run={run} />
    </section>
  );
}
