/** Screen 4 — Work item detail. Metadata left, documents right, the
 *  communication and response thread below (docs/09). Every action comes
 *  from the matrix; every gap renders "not stated". */
import { useState } from "react";
import { useDocuments } from "../hooks/use-documents";
import { useDraft } from "../hooks/use-draft";
import { useProceeding } from "../hooks/use-proceeding";
import { api, describeError } from "../lib/api";
import { describeDue } from "../lib/due";
import { invalidate } from "../lib/query";
import { href } from "../lib/router";
import { actionsFor, parseStatus } from "../lib/status";
import { toast, toastError } from "../lib/toast";
import type { CommunicationView, Document, ProceedingDetail } from "../lib/types";
import { DateCell } from "../ui/dates";
import DocumentPreview from "../ui/document-preview";
import DraftDrawer from "../ui/draft-drawer";
import DueText from "../ui/due-text";
import EmptyState from "../ui/empty-state";
import { StatusPill } from "../ui/pill";

const PANEL_LABEL: Record<string, string> = {
  "self:action": "Self · for your action", "self:information": "Self · for your information",
  "other_pan:action": "Other PAN/TAN · for your action", "other_pan:information": "Other PAN/TAN · for your information",
  "auth_rep:action": "As AR · for your action", "auth_rep:information": "As AR · for your information",
};

function Gap({ value, gaps, column, mono = false }: { value: string | null | undefined; gaps: string[]; column: string; mono?: boolean }) {
  if (value) return <span className={mono ? "mono" : undefined}>{value}</span>;
  return <span className="muted">Not stated{gaps.includes(column) ? <span className="unverified">unverified</span> : null}</span>;
}

function DocRow({ doc, onView, onOpen, onSave }: { doc: Document; onView: () => void; onOpen: () => void; onSave: () => void }) {
  const stored = doc.state === "stored";
  return (
    <tr>
      <td className="wrap">
        {doc.filename ?? doc.doc_kind}
        <div className="sub">{doc.doc_kind}{doc.byte_size ? ` · ${Math.round(doc.byte_size / 1024)} KB` : ""}
          {doc.state === "pending" ? " · awaited" : doc.state === "failed" ? " · fetch failed" : ""}</div>
      </td>
      <td className="right">
        <div className="actions">
          <button className="btn small" disabled={!stored} onClick={onView}>View</button>
          <button className="btn small" disabled={!stored} onClick={onOpen}>Open</button>
          <button className="btn small" disabled={!stored} onClick={onSave}>Save</button>
        </div>
      </td>
    </tr>
  );
}

function ManualDueDate({ p, onSaved }: { p: ProceedingDetail; onSaved: () => void }) {
  const [value, setValue] = useState(p.manual_due_date ?? "");
  const can = actionsFor(p.status).editManualDueDate && !p.due_date;
  const save = async () => {
    try {
      await api.setManualDueDate(p.id, value || null);
      toast(value ? "Manual due date saved." : "Manual due date cleared.");
      onSaved();
    } catch (e) { toastError(describeError(e)); }
  };
  if (p.due_date) return <span className="muted">portal states a date; no manual override (Q14)</span>;
  if (!can) return <span className="muted">{p.manual_due_date ?? "not set"}</span>;
  return (
    <div className="row">
      <input className="input mono" type="date" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Manual due date" />
      {value !== (p.manual_due_date ?? "") ? <button className="btn small" onClick={() => { void save(); }}>Save</button> : null}
    </div>
  );
}

function Thread({ p, onDraft, docs }: {
  p: ProceedingDetail; onDraft: (c: CommunicationView) => void;
  docs: ReturnType<typeof useDocuments>;
}) {
  const entries: { when: string | null; node: React.ReactNode; key: string }[] = [];
  for (const c of p.communications) {
    const can = actionsFor(c.status === "response_submitted" ? "response_submitted" : p.status);
    const due = describeDue(c.response_due_date, c.status === "response_submitted" ? "response_submitted" : p.status);
    entries.push({
      when: c.issued_on, key: `c:${c.id}`,
      node: (
        <div className="msg">
          <div className="head">
            <span className="pill">{c.type_label}</span>
            <b>{c.description ?? "Communication"}</b>
            <StatusPill status={c.status} />
            <span className="when meta num">issued <DateCell iso={c.issued_on} gap={c.gaps.includes("issued_on")} /></span>
          </div>
          <dl className="kv">
            <dt>Reference</dt><dd className="mono">{c.reference_id}</dd>
            <dt>DIN</dt><dd><Gap value={c.din} gaps={c.gaps} column="din" mono /></dd>
            <dt>Section</dt><dd><Gap value={c.section_2025 && c.section_1961 ? `Sec ${c.section_2025} (old ${c.section_1961})` : (c.section_1961 ? `Sec ${c.section_1961}` : c.section_2025 ? `Sec ${c.section_2025}` : null)} gaps={c.gaps} column="section" /></dd>
            <dt>Served on</dt><dd><DateCell iso={c.served_on} gap={c.gaps.includes("served_on")} /></dd>
            <dt>Response due</dt><dd><DueText due={due} /></dd>
            <dt>Viewed by AO</dt><dd><DateCell iso={c.ao_viewed_on} /></dd>
          </dl>
          {c.documents.length ? (
            <table className="table"><tbody>
              {c.documents.map((d) => <DocRow key={d.id} doc={d} onView={() => { void docs.view(d); }}
                                             onOpen={() => { void docs.openExternal(d); }} onSave={() => { void docs.saveAs(d); }} />)}
            </tbody></table>
          ) : <span className="meta">No document fetched for this communication.</span>}
          {can.draft ? (
            <div className="row">
              <button className="btn small" onClick={() => onDraft(c)}>{c.has_draft ? "Open draft" : "Draft"}</button>
            </div>
          ) : null}
        </div>
      ),
    });
  }
  for (const r of p.responses) {
    entries.push({
      when: r.filed_on, key: `r:${r.id}`,
      node: (
        <div className="msg outbound">
          <div className="head">
            <span className="pill success">Response · {r.response_mode}</span>
            <span className="when meta num">filed <DateCell iso={r.filed_on} /></span>
          </div>
          <dl className="kv">
            <dt>Filed by</dt><dd>{r.filed_by ?? <span className="muted">Not stated</span>}</dd>
            <dt>Transaction</dt><dd className="mono">{r.transaction_id ?? <span className="muted">Not stated</span>}</dd>
            <dt>Remarks</dt><dd>{r.remarks ?? <span className="muted">none</span>}</dd>
          </dl>
        </div>
      ),
    });
  }
  for (const a of p.adjournments) {
    entries.push({
      when: a.filed_on, key: `a:${a.id}`,
      node: (
        <div className="msg outbound">
          <div className="head">
            <span className="pill warning">Adjournment sought</span>
            <span className="when meta num">filed <DateCell iso={a.filed_on} /></span>
          </div>
          <dl className="kv">
            <dt>Sought date</dt><dd><DateCell iso={a.sought_date} /></dd>
            <dt>Reason</dt><dd>{a.reason ?? <span className="muted">Not stated</span>}</dd>
            <dt>Outcome</dt><dd>{a.outcome ?? <span className="muted">Not stated</span>}</dd>
          </dl>
        </div>
      ),
    });
  }
  entries.sort((x, y) => (x.when ?? "9999").localeCompare(y.when ?? "9999"));
  if (!entries.length) return <EmptyState title="No communications yet." body="The thread fills as sweeps find notices and filed responses." />;
  return <div className="thread">{entries.map((e) => <div key={e.key}>{e.node}</div>)}</div>;
}

export default function WorkItemScreen({ module, id }: { module: string; id: string }) {
  const q = useProceeding(module === "proceedings" ? id : null);
  const docs = useDocuments();
  const draft = useDraft();

  if (module !== "proceedings") {
    return <div className="page"><div className="page-body"><div className="card">
      <EmptyState title="Not available yet." body="Demands, returns and forms arrive in a later phase of this build." /></div></div></div>;
  }
  if (q.error) return <div className="page"><div className="page-body"><div className="banner danger">{q.error}</div></div></div>;
  if (!q.data) return <div className="page"><div className="loading">Loading</div></div>;
  const p = q.data;
  const status = parseStatus(p.status);
  const due = describeDue(p.due_date ?? p.manual_due_date, status);
  const limitation = describeDue(p.limitation_date, status);
  const refresh = () => invalidate(`proceedings:${id}`);

  return (
    <div className="page">
      <div className="page-head">
        <a className="btn small quiet" href={href({ name: "client", id: p.client_id })}>{p.client_name}</a>
        <h1>{p.display_name ?? p.type_label}</h1>
        <StatusPill status={p.status} />
        {p.verified_flag ? <span className="pill success">Verified</span> : <span className="pill warning">Unverified</span>}
      </div>
      <div className="page-body">
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h2>Proceeding</h2><span className="meta">{p.type_label}</span></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Client</dt><dd>{p.client_name} <span className="mono muted">{p.pan_masked}</span></dd>
                <dt>Assessment year</dt><dd>{p.assessment_year ?? <span className="muted">Not stated<span className="unverified">unverified</span></span>}{p.financial_year ? <span className="muted"> · FY {p.financial_year}</span> : null}</dd>
                <dt>Assessee</dt><dd>{p.assessee_name ?? <span className="muted">Not stated</span>}</dd>
                <dt>Section</dt><dd><Gap value={p.section} gaps={p.gaps} column="section" /></dd>
                <dt>DIN</dt><dd><Gap value={p.din_reference} gaps={p.gaps} column="din_reference" mono /></dd>
                <dt>Authority</dt><dd><Gap value={p.authority} gaps={p.gaps} column="authority" /></dd>
                <dt>Initiated on</dt><dd><DateCell iso={p.initiated_on} gap={p.gaps.includes("initiated_on")} /></dd>
                <dt>Response due</dt><dd><DueText due={due} />{!p.due_date && p.manual_due_date ? <span className="meta"> · manual</span> : null}</dd>
                <dt>Manual due date</dt><dd><ManualDueDate p={p} onSaved={refresh} /></dd>
                <dt>Suggested due date</dt>
                <dd>{p.suggested_due_date
                  ? <><span className="suggested">{p.suggested_due_date}</span> <span className="pill warning">suggested</span></>
                  : <span className="muted">none</span>}</dd>
                <dt>Limitation date</dt><dd><DueText due={limitation} /></dd>
                <dt>Portal status</dt><dd>{p.portal_status ?? <span className="muted">Not stated</span>}</dd>
                <dt>Closure</dt><dd><DateCell iso={p.closure_date} />{p.closure_order ? <span className="muted"> · {p.closure_order}</span> : null}</dd>
                <dt>Panel</dt><dd>{PANEL_LABEL[p.source_panel] ?? p.source_panel}</dd>
                <dt>Created</dt><dd>{p.created_mode === "auto" ? "by sweep" : "by hand"}</dd>
                {p.appeal_number ? <><dt>Appeal number</dt><dd className="mono">{p.appeal_number}</dd></> : null}
                {p.order_appealed_against ? <><dt>Order appealed against</dt><dd>{p.order_appealed_against}</dd></> : null}
                <dt>Last seen</dt><dd className="num">{p.last_seen_at.slice(0, 10)}</dd>
              </dl>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>Documents</h2>
              <span className="meta num">{p.communications.reduce((n, c) => n + c.documents.length, 0) + p.documents.length}</span></div>
            {(() => {
              const all = [...p.documents, ...p.communications.flatMap((c) => c.documents)];
              return all.length ? (
                <table className="table"><tbody>
                  {all.map((d) => <DocRow key={d.id} doc={d} onView={() => { void docs.view(d); }}
                                         onOpen={() => { void docs.openExternal(d); }} onSave={() => { void docs.saveAs(d); }} />)}
                </tbody></table>
              ) : <div className="card-body muted">No documents fetched yet.</div>;
            })()}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Thread</h2></div>
          <div className="card-body">
            <Thread p={p} docs={docs} onDraft={(c) => { void draft.open(c.reference_id); }} />
          </div>
        </div>
      </div>

      {docs.preview ? <DocumentPreview preview={docs.preview} onClose={docs.closePreview}
                                       onOpen={() => { if (docs.preview) void docs.openExternal(docs.preview.doc); }}
                                       onSave={() => { if (docs.preview) void docs.saveAs(docs.preview.doc); }} /> : null}
      {draft.draft ? <DraftDrawer draft={draft.draft} busy={draft.busy} onClose={draft.close}
                                  onSave={(t) => { void draft.saveText(t); }}
                                  onRegenerate={() => { if (draft.draft) void draft.open(draft.draft.ref_id, true); }} /> : null}
    </div>
  );
}
