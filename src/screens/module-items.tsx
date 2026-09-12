/** Work item detail for demands, returns and filed forms (docs/09 screen
 *  4). Same shape as the proceeding screen: metadata left, documents
 *  right; every gap reads "Not stated". */
import { useDocuments } from "../hooks/use-documents";
import { useDemand, useFiledForm, useReturn } from "../hooks/use-proceeding";
import { href } from "../lib/router";
import type { Document } from "../lib/types";
import { DateCell } from "../ui/dates";
import DocumentPreview from "../ui/document-preview";
import { StatusPill } from "../ui/pill";

function money(v: number | null): React.ReactNode {
  if (v === null) return <span className="muted">Not stated</span>;
  return <span className="mono">{v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

function Gap({ value, mono = false }: { value: string | null | undefined; mono?: boolean }) {
  return value ? <span className={mono ? "mono" : undefined}>{value}</span> : <span className="muted">Not stated</span>;
}

function Docs({ docs, d }: { docs: Document[]; d: ReturnType<typeof useDocuments> }) {
  if (!docs.length) return <div className="card-body muted">No documents fetched yet.</div>;
  return (
    <table className="table"><tbody>
      {docs.map((doc) => {
        const stored = doc.state === "stored";
        return (
          <tr key={doc.id}>
            <td className="wrap">{doc.filename ?? doc.doc_kind}
              <div className="sub">{doc.doc_kind}{doc.state === "pending" ? " · awaited" : doc.state === "failed" ? " · fetch failed" : ""}</div></td>
            <td className="right"><div className="actions">
              <button className="btn small" disabled={!stored} onClick={() => { void d.view(doc); }}>View</button>
              <button className="btn small" disabled={!stored} onClick={() => { void d.openExternal(doc); }}>Open</button>
              <button className="btn small" disabled={!stored} onClick={() => { void d.saveAs(doc); }}>Save</button>
            </div></td>
          </tr>
        );
      })}
    </tbody></table>
  );
}

function Frame({ title, client, status, verified, children }: {
  title: string; client: { id: string; name: string }; status: string; verified: number; children: React.ReactNode;
}) {
  return (
    <div className="page">
      <div className="page-head">
        <a className="btn small quiet" href={href({ name: "client", id: client.id })}>{client.name}</a>
        <h1>{title}</h1>
        <StatusPill status={status} />
        {verified ? <span className="pill success">Verified</span> : <span className="pill warning">Unverified</span>}
      </div>
      <div className="page-body">{children}</div>
    </div>
  );
}

export function DemandScreen({ id }: { id: string }) {
  const q = useDemand(id);
  const docs = useDocuments();
  if (q.error) return <div className="page"><div className="page-body"><div className="banner danger">{q.error}</div></div></div>;
  if (!q.data) return <div className="page"><div className="loading">Loading</div></div>;
  const d = q.data;
  const allDocs = [...d.documents, ...d.responses.flatMap((r) => r.documents)];
  return (
    <Frame title={`Demand ${d.demand_reference_number ?? ""}`.trim()} client={{ id: d.client_id, name: d.client_name }} status={d.status} verified={d.verified_flag}>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Demand</h2><span className="meta">{d.section_or_demand_type ?? ""}</span></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Client</dt><dd>{d.client_name} <span className="mono muted">{d.pan_masked}</span></dd>
              <dt>Assessment year</dt><dd>{d.assessment_year ?? <span className="muted">Not stated</span>}</dd>
              <dt>Reference</dt><dd><Gap value={d.demand_reference_number} mono /></dd>
              <dt>Section / type</dt><dd><Gap value={d.section_or_demand_type} /></dd>
              <dt>Raised on</dt><dd><DateCell iso={d.raised_on} gap={d.gaps.includes("raised_on")} /></dd>
              <dt>Demand amount</dt><dd>{money(d.demand_amount)}</dd>
              <dt>Current outstanding</dt><dd>{money(d.current_outstanding)}</dd>
              <dt>Uploaded by</dt><dd><Gap value={d.uploaded_by} /></dd>
              <dt>Rectification rights</dt><dd><Gap value={d.rectification_rights} /></dd>
              <dt>Portal status</dt><dd><Gap value={d.portal_status} /></dd>
              <dt>Last seen</dt><dd className="num">{d.last_seen_at.slice(0, 10)}</dd>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Documents</h2><span className="meta num">{allDocs.length}</span></div>
          <Docs docs={allDocs} d={docs} />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>The firm's stance</h2></div>
        {d.responses.length ? (
          <table className="table">
            <thead><tr><th>Stance</th><th>Reason</th><th className="num">Disputed amount</th><th>Filed on</th><th>Transaction</th></tr></thead>
            <tbody>{d.responses.map((r) => (
              <tr key={r.id}>
                <td>{r.stance ? r.stance.replace("_", " ") : <span className="muted">Not stated</span>}</td>
                <td className="wrap">{r.reason_label ?? <span className="muted">Not stated</span>}</td>
                <td className="num">{money(r.disputed_amount)}</td>
                <td><DateCell iso={r.filed_on} /></td>
                <td className="mono">{r.transaction_id ?? <span className="muted">Not stated</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="card-body muted">No response recorded on the portal.</div>}
      </div>
      <div className="card">
        <div className="card-head"><h2>Payments</h2><span className="meta">challans for this year</span></div>
        {d.payments.length ? (
          <table className="table">
            <thead><tr><th>Purpose</th><th>CIN</th><th>BSR</th><th>Paid on</th><th className="num">Amount</th></tr></thead>
            <tbody>{d.payments.map((p) => (
              <tr key={p.id}>
                <td>{p.purpose.replace("_", " ")}</td>
                <td className="mono">{p.cin ?? <span className="muted">Not stated</span>}</td>
                <td className="mono">{p.bsr_code ?? <span className="muted">Not stated</span>}</td>
                <td><DateCell iso={p.paid_on} /></td>
                <td className="num">{money(p.amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="card-body muted">No challan recorded.</div>}
      </div>
      {docs.preview ? <DocumentPreview preview={docs.preview} onClose={docs.closePreview}
        onOpen={() => { if (docs.preview) void docs.openExternal(docs.preview.doc); }}
        onSave={() => { if (docs.preview) void docs.saveAs(docs.preview.doc); }} /> : null}
    </Frame>
  );
}

export function ReturnScreen({ id }: { id: string }) {
  const q = useReturn(id);
  const docs = useDocuments();
  if (q.error) return <div className="page"><div className="page-body"><div className="banner danger">{q.error}</div></div></div>;
  if (!q.data) return <div className="page"><div className="loading">Loading</div></div>;
  const r = q.data;
  return (
    <Frame title={`${r.return_type ?? "Return"} · ${r.acknowledgement_number}`} client={{ id: r.client_id, name: r.client_name }} status={r.status} verified={r.verified_flag}>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Return</h2><span className="meta">{r.filing_type ?? ""}</span></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Client</dt><dd>{r.client_name} <span className="mono muted">{r.pan_masked}</span></dd>
              <dt>Assessment year</dt><dd>{r.assessment_year ?? <span className="muted">Not stated</span>}</dd>
              <dt>Acknowledgement</dt><dd className="mono">{r.acknowledgement_number}</dd>
              <dt>Return type</dt><dd><Gap value={r.return_type} /></dd>
              <dt>Filing type</dt><dd><Gap value={r.filing_type} /></dd>
              <dt>Filed on</dt><dd><DateCell iso={r.filed_on} gap={r.gaps.includes("filed_on")} /></dd>
              <dt>Verification</dt><dd><Gap value={r.verification_status} /></dd>
              <dt>Processing</dt><dd><Gap value={r.processing_status} /></dd>
              <dt>Supersedes</dt><dd>{r.supersedes_ack ? <span className="mono">{r.supersedes_ack}</span> : <span className="muted">— (original)</span>}</dd>
              <dt>Superseded by</dt><dd>{r.superseded_by_ack ? <span className="mono">{r.superseded_by_ack}</span> : <span className="muted">—</span>}</dd>
              <dt>Last seen</dt><dd className="num">{r.last_seen_at.slice(0, 10)}</dd>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Form and receipt</h2><span className="meta">always two nodes</span></div>
          <Docs docs={r.documents} d={docs} />
        </div>
      </div>
      {docs.preview ? <DocumentPreview preview={docs.preview} onClose={docs.closePreview}
        onOpen={() => { if (docs.preview) void docs.openExternal(docs.preview.doc); }}
        onSave={() => { if (docs.preview) void docs.saveAs(docs.preview.doc); }} /> : null}
    </Frame>
  );
}

export function FiledFormScreen({ id }: { id: string }) {
  const q = useFiledForm(id);
  const docs = useDocuments();
  if (q.error) return <div className="page"><div className="page-body"><div className="banner danger">{q.error}</div></div></div>;
  if (!q.data) return <div className="page"><div className="loading">Loading</div></div>;
  const f = q.data;
  return (
    <Frame title={f.form_label ?? f.type_label} client={{ id: f.client_id, name: f.client_name }} status={f.status} verified={f.verified_flag}>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Form</h2><span className="meta">{f.type_label}</span></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Client</dt><dd>{f.client_name} <span className="mono muted">{f.pan_masked}</span></dd>
              <dt>Assessment year</dt><dd>{f.assessment_year ?? <span className="muted">Not stated</span>}</dd>
              <dt>Acknowledgement</dt><dd className="mono">{f.acknowledgement_number}</dd>
              <dt>Filed on</dt><dd><DateCell iso={f.filed_on} gap={f.gaps.includes("filed_on")} /></dd>
              <dt>Filing type</dt><dd><Gap value={f.filing_type} /></dd>
              <dt>Portal status</dt><dd><Gap value={f.portal_status} /></dd>
              <dt>Filed by</dt><dd><Gap value={f.filed_by} /></dd>
              <dt>Last seen</dt><dd className="num">{f.last_seen_at.slice(0, 10)}</dd>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Form and receipt</h2><span className="meta">always two nodes</span></div>
          <Docs docs={f.documents} d={docs} />
        </div>
      </div>
      {docs.preview ? <DocumentPreview preview={docs.preview} onClose={docs.closePreview}
        onOpen={() => { if (docs.preview) void docs.openExternal(docs.preview.doc); }}
        onSave={() => { if (docs.preview) void docs.saveAs(docs.preview.doc); }} /> : null}
    </Frame>
  );
}
