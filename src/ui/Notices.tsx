/** Filters + the notices table. Port of the last `.card` in
 *  `app/static/index.html`, including the row actions and both empty states. */
import { orDash } from "../lib/format";
import { actionsFor } from "../lib/status";
import type { Item } from "../lib/buckets";
import type { NoticeRow } from "../lib/types";
import DueText from "./DueText";

/** The one button that spends money, marked with the same ✦ as everything
 *  else Claude wrote on this page. */
export const DATE_BTN = "✦ Date";

/** The due chip, through the one renderer. A suggestion is shown as one -
 *  muted, marked - never as a deadline. */
function DueChip({ n }: { n: Item }) {
  return (
    <>
      <DueText due={n.due} chip />
      {!n.due_date && n.suggested_due_date
        ? <span className="ai-chip" title="suggested by Claude, not stated by the portal">✦ suggested {n.suggested_due_date}</span>
        : null}
    </>
  );
}

/** Four dots per row, so the table reads as the checklist it is: do we hold
 *  the document, do we know the deadline, is there a draft, was a reply filed.
 *  `responded` is the one tri-state - unknown is drawn dashed rather than
 *  claiming "not yet". */
function StatusCell({ n }: { n: NoticeRow }) {
  const replied = n.responded === null || n.responded === undefined ? null : !!n.responded;
  const marks: [string, boolean | null, string][] = [
    ["PDF", !!n.has_pdf, n.has_pdf ? "PDF saved" : "no PDF stored yet"],
    ["date", !!n.due_date, n.due_date ? `due ${n.due_date}` : "no due date on this notice"],
    ["draft", !!n.has_draft, n.has_draft ? "draft written" : "no draft yet"],
    ["responded on portal", replied, replied === null
      ? "the portal did not say at the last sync"
      : replied ? "a reply is filed on the portal" : "no reply filed yet"],
  ];
  return (
    <div className="ticks">
      {marks.map(([label, on, title]) => (
        <span key={label} className={"tick" + (on ? " on" : on === null ? " unknown" : "")}
              role="img" title={`${label}: ${title}`}
              aria-label={`${label} ${on === null ? "unknown" : on ? "done" : "not yet"}`} />
      ))}
    </div>
  );
}

const SKELETON_WIDTHS = ["58%", "70%", "40%", "34%", "52%", "46%"];

const EmptyIcon = () => (
  <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3v4a1 1 0 0 0 1 1h4" />
    <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    <path d="M9 13h6M9 17h4" />
  </svg>
);

const Spin = () => <span className="spin" />;

export interface NoticesProps {
  rows: NoticeRow[];            // everything held, for the year list and the count
  visible: Item[];              // what the filters left
  loading: boolean;
  years: string[];
  ay: string; onAy: (v: string) => void;
  name: string; onName: (v: string) => void;
  noDue: boolean; onNoDue: (v: boolean) => void;
  nameRef: React.RefObject<HTMLInputElement>;
  busy: Record<string, string>;      // ref_id -> the action running on that row
  noDateStated: Record<string, string>;  // ref_id -> Claude's reason there is none
  onView: (refId: string) => void;
  onSave: (refId: string) => void;
  onAskClaude: (refId: string) => void;
  onDraft: (refId: string) => void;
  onFirstSync: () => void;
}

export default function Notices(p: NoticesProps) {
  const count = p.loading ? ""
    : p.visible.length === p.rows.length
      ? `${p.rows.length} notice(s)`
      : `${p.visible.length} of ${p.rows.length}`;

  return (
    <div className="card">
      <div className="pad" style={{ paddingBottom: 0 }}>
        <p className="eyebrow">Register</p>
        <div className="sectionhead">
          <h2 className="title">Every notice held</h2>
          <span className="grow" />
          <span className="mut mono">{count}</span>
        </div>
      </div>
      <div className="filters">
        <label>Assessment year
          <select value={p.ay} onChange={(e) => p.onAy(e.target.value)}>
            <option value="">All</option>
            {p.years.map((y) => <option key={y}>{y}</option>)}
          </select>
        </label>
        <label>Proceeding
          <input ref={p.nameRef} type="text" placeholder="name contains…  (press /)"
                 value={p.name} onChange={(e) => p.onName(e.target.value)} />
        </label>
        <label>
          <input type="checkbox" checked={p.noDue} onChange={(e) => p.onNoDue(e.target.checked)} />
          {" "}Missing due date only
        </label>
      </div>

      <div className="tablewrap">
        <table>
          <thead><tr>
            <th>Notice</th><th>Proceeding</th><th>Issued</th><th>Due</th>
            <th>Status</th><th className="right">Actions</th>
          </tr></thead>
          <tbody>
            {p.loading ? (
              Array.from({ length: 5 }, (_, r) => (
                <tr key={r}>{SKELETON_WIDTHS.map((w, c) => (
                  <td key={c}><div className="skel" style={{ width: w }} /></td>
                ))}</tr>
              ))
            ) : !p.visible.length ? (
              <tr><td colSpan={6}>
                <div className="empty-state">
                  <EmptyIcon />
                  <div className="title">
                    {p.rows.length ? "Nothing matches these filters." : "No notices stored yet."}
                  </div>
                  <div className="desc">
                    {p.rows.length
                      ? "Clear the year, the name or the missing-date toggle to see the rest."
                      : "A sync logs into the portal, walks e-Proceedings and stores every notice PDF here."}
                  </div>
                  {p.rows.length ? null
                    : <button className="primary accent" onClick={p.onFirstSync}>Run first sync</button>}
                </div>
              </td></tr>
            ) : p.visible.map((n) => {
              const running = p.busy[n.ref_id];
              const noDate = p.noDateStated[n.ref_id];
              // The action matrix, in one place (docs/02). View and Save
              // are never withheld; Draft follows the status.
              const can = actionsFor(n.machineStatus);
              return (
                <tr key={n.ref_id}>
                  <td>
                    {orDash(n.notice_us)}
                    <div className="sub">{n.description || ""}</div>
                    <div><span className="idchip">{n.ref_id}</span></div>
                  </td>
                  <td>
                    {orDash(n.proceeding_name)}
                    <div className="sub mono">{n.pan || ""} · AY {orDash(n.assessment_year)}</div>
                  </td>
                  <td className="mono">{orDash(n.issued_on)}</td>
                  <td><DueChip n={n} /></td>
                  <td><StatusCell n={n} /></td>
                  <td className="right">
                    <div className="rowacts">
                      {can.view ? <button disabled={!n.has_pdf} title={n.has_pdf ? undefined : "no PDF stored yet"}
                                          onClick={() => p.onView(n.ref_id)}>View</button> : null}
                      {can.save ? <button disabled={!n.has_pdf} title={n.has_pdf ? undefined : "no PDF stored yet"}
                                          onClick={() => p.onSave(n.ref_id)}>Save</button> : null}
                      {can.draft && !n.due_date && !n.suggested_due_date && n.has_pdf ? (
                        // Plenty of letters genuinely set no deadline: say so quietly.
                        noDate !== undefined
                          ? <span className="mut" title={noDate}>no date stated</span>
                          : <button disabled={!!running} onClick={() => p.onAskClaude(n.ref_id)}>
                              {running === "date" ? <Spin /> : DATE_BTN}
                            </button>
                      ) : null}
                      {can.draft && n.has_pdf ? (
                        <button className="primary accent" disabled={!!running}
                                onClick={() => p.onDraft(n.ref_id)}>
                          {running === "draft" ? <Spin /> : "Draft"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
