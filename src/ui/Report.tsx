/** "Position at a glance" - the firm's old Excel tracker, on the page.
 *  Port of `#report` in `app/static/index.html`. */
import { orDash, relTime, respondedLabel } from "../lib/format";
import { CHIP_CLASS, type ChipKey, type LastRun, type Summary } from "../lib/summary";
import type { Item } from "../lib/buckets";

/** Red once the date has gone, amber while it is inside three days. */
function DaysCell({ days }: { days: number | null }) {
  if (days === null) return <span className="mut">—</span>;
  return <span className={"days " + (days < 0 ? "late" : days <= 3 ? "soon" : "")}>{days}</span>;
}

function AttentionRow({ i }: { i: Item }) {
  const title = i.description || i.proceeding_name || i.ref_id || "—";
  return (
    <tr>
      <td>
        {title}
        {i.description && i.proceeding_name ? <div className="sub">{i.proceeding_name}</div> : null}
      </td>
      <td className="mono">{orDash(i.pan)}</td>
      <td className="mono">{orDash(i.assessment_year)}</td>
      <td>{orDash(i.notice_us)}</td>
      <td className="mono">{orDash(i.due_date)}</td>
      <td className="right"><DaysCell days={i.days} /></td>
      <td>{i.responded === null || i.responded === undefined
        ? <span className="mut">Unknown</span>
        : respondedLabel(i.responded as 1 | 0)}</td>
    </tr>
  );
}

export interface ReportProps {
  summary: Summary;
  run: LastRun | null;
  bucket: ChipKey | "";
  onBucket: (key: ChipKey | "") => void;
}

export default function Report(p: ReportProps) {
  const { summary: s, run } = p;
  const when = relTime(run?.finished) || run?.finished;

  return (
    <section className="card report">
      <div className="pad">
        <p className="eyebrow">Docket status</p>
        <h2 className="rtitle">Position at a glance</h2>
        <p className="mut runline">
          {run?.finished
            ? <>Run <b>{when}</b> · <b>{s.scanned}</b> notices scanned · <b>{run.notices_new}</b> new this run</>
            : <>No sync has finished yet · <b>{s.scanned}</b> notices held</>}
        </p>

        {/* One horizontal bar of chips. Each one filters the table below to
            exactly the notices it counts - no round trip, the rows are here. */}
        <div className="buckets">
          {s.chips.map((c) => (
            <button key={c.key}
                    className={`bchip ${CHIP_CLASS[c.key]}${c.count ? "" : " zero"}`}
                    aria-pressed={p.bucket === c.key}
                    title="Show only these in the table below"
                    onClick={() => p.onBucket(p.bucket === c.key ? "" : c.key)}>
              <span className="n">{c.count}</span><span>{c.label}</span>
            </button>
          ))}
        </div>

        <p className="h attn-h">Attention — overdue &amp; due within 3 days</p>
        <div className="tablewrap attnwrap">
          <table className="attn">
            <thead><tr>
              <th>Client / Description</th><th>PAN</th><th>AY</th><th>Section</th>
              <th>Due date</th><th className="right">Days left</th><th>Responded</th>
            </tr></thead>
            <tbody>
              {s.attention.length
                ? s.attention.map((i) => <AttentionRow key={i.ref_id} i={i} />)
                : <tr><td colSpan={7}>
                    {/* the old sheet's own words, kept exactly */}
                    <span className="allclear">Nothing overdue or critical.</span>
                  </td></tr>}
            </tbody>
          </table>
        </div>

        <p className="caution">Draft for review — verify every figure against the portal.</p>
      </div>
    </section>
  );
}
