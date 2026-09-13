/** Work item detail for demands, returns and filed forms (docs/09 screen
 *  4). Same shape as the proceeding screen: metadata left, documents
 *  right; every gap reads "Not stated". */
import { useDocuments } from "../hooks/use-documents";
import { useDemand, useFiledForm, useReturn } from "../hooks/use-proceeding";
import { navigate } from "../lib/router";
import { DateCell } from "../ui/dates";
import { DocList, DocPreview } from "../ui/doc-list";
import { ErrorPage, LoadingPage, Page, PageBody, PageHead } from "../ui/page";
import { StatusPill } from "../ui/pill";

function money(v: number | null): React.ReactNode {
  if (v === null) return <span className="muted">Not stated</span>;
  return <span className="mono">{v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>;
}

function Gap({ value, mono = false }: { value: string | null | undefined; mono?: boolean }) {
  return value ? <span className={mono ? "mono" : undefined}>{value}</span> : <span className="muted">Not stated</span>;
}

function Frame({ title, client, status, verified, docs, children }: {
  title: string; client: { id: string; name: string }; status: string; verified: number;
  docs: ReturnType<typeof useDocuments>; children: React.ReactNode;
}) {
  return (
    <Page>
      <PageHead title={title} back={{ route: { name: "client", id: client.id }, label: client.name }}
                meta={<span className="row"><StatusPill status={status} />
                  {verified ? <span className="pill success">Verified</span> : <span className="pill warning">Unverified</span>}</span>} />
      <PageBody>{children}</PageBody>
      <DocPreview docs={docs} />
    </Page>
  );
}

export function DemandScreen({ id }: { id: string }) {
  const q = useDemand(id);
  const docs = useDocuments();
  if (q.error) return <ErrorPage message={q.error} />;
  if (!q.data) return <LoadingPage />;
  const d = q.data;
  const allDocs = [...d.documents, ...d.responses.flatMap((r) => r.documents)];
  return (
    <Frame title={`Demand ${d.demand_reference_number ?? ""}`.trim()} client={{ id: d.client_id, name: d.client_name }} status={d.status} verified={d.verified_flag} docs={docs}>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Demand</h2><span className="meta">{d.section_or_demand_type ?? ""}</span></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Client</dt><dd>{d.client_name} <span className="mono muted">{d.pan_masked}</span></dd>
              <dt>Assessment year</dt><dd><Gap value={d.assessment_year} /></dd>
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
          <DocList items={allDocs} docs={docs} />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>The firm's stance</h2></div>
        {d.responses.length ? (
          <table className="table">
            <thead><tr><th>Stance</th><th>Reason</th><th className="num">Disputed amount</th><th>Filed on</th><th>Transaction</th></tr></thead>
            <tbody>{d.responses.map((r) => (
              <tr key={r.id}>
                <td><Gap value={r.stance?.replace("_", " ")} /></td>
                <td className="wrap"><Gap value={r.reason_label} /></td>
                <td className="num">{money(r.disputed_amount)}</td>
                <td><DateCell iso={r.filed_on} /></td>
                <td><Gap value={r.transaction_id} mono /></td>
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
                <td><Gap value={p.cin} mono /></td>
                <td><Gap value={p.bsr_code} mono /></td>
                <td><DateCell iso={p.paid_on} /></td>
                <td className="num">{money(p.amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="card-body muted">No challan recorded.</div>}
      </div>
    </Frame>
  );
}

export function ReturnScreen({ id }: { id: string }) {
  const q = useReturn(id);
  const docs = useDocuments();
  if (q.error) return <ErrorPage message={q.error} />;
  if (!q.data) return <LoadingPage />;
  const r = q.data;
  return (
    <Frame title={`${r.return_type ?? "Return"} · ${r.acknowledgement_number}`} client={{ id: r.client_id, name: r.client_name }} status={r.status} verified={r.verified_flag} docs={docs}>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Return</h2><span className="meta">{r.filing_type ?? ""}</span></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Client</dt><dd>{r.client_name} <span className="mono muted">{r.pan_masked}</span></dd>
              <dt>Assessment year</dt><dd><Gap value={r.assessment_year} /></dd>
              <dt>Acknowledgement</dt><dd className="mono">{r.acknowledgement_number}</dd>
              <dt>Return type</dt><dd><Gap value={r.return_type} /></dd>
              <dt>Filing type</dt><dd><Gap value={r.filing_type} /></dd>
              <dt>Filed on</dt><dd><DateCell iso={r.filed_on} gap={r.gaps.includes("filed_on")} /></dd>
              <dt>Verification</dt><dd><Gap value={r.verification_status} /></dd>
              <dt>Processing</dt><dd><Gap value={r.processing_status} /></dd>
              <dt>Supersedes</dt><dd>{r.supersedes_ack ? <span className="mono">{r.supersedes_ack}</span> : <span className="muted">none (original)</span>}</dd>
              <dt>Superseded by</dt><dd>{r.superseded_by_ack ? <span className="mono">{r.superseded_by_ack}</span> : <span className="muted">none</span>}</dd>
              <dt>Last seen</dt><dd className="num">{r.last_seen_at.slice(0, 10)}</dd>
            </dl>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Form and receipt</h2><span className="meta">always two nodes</span></div>
          <DocList items={r.documents} docs={docs} />
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Filing thread</h2><span className="meta">original, revised, updated: one thread</span></div>
        <table className="table"><tbody>
          {r.chain.map((c, i) => (
            <tr key={c.id} className={c.id === r.id ? "" : "row-link"} tabIndex={c.id === r.id ? -1 : 0}
                onClick={() => { if (c.id !== r.id) navigate({ name: "item", module: "returns", id: c.id }); }}
                onKeyDown={(e) => { if (e.key === "Enter" && c.id !== r.id) navigate({ name: "item", module: "returns", id: c.id }); }}>
              <td className="num">{i + 1}</td>
              <td className="mono">{c.acknowledgement_number}{c.id === r.id ? <span className="sub">this one</span> : null}</td>
              <td><Gap value={c.filing_type} /></td>
              <td><DateCell iso={c.filed_on} /></td>
              <td><Gap value={c.verification_status} /></td>
              <td>{i === r.chain.length - 1 ? <span className="pill success">current</span> : <span className="pill">superseded</span>}</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </Frame>
  );
}

export function FiledFormScreen({ id }: { id: string }) {
  const q = useFiledForm(id);
  const docs = useDocuments();
  if (q.error) return <ErrorPage message={q.error} />;
  if (!q.data) return <LoadingPage />;
  const f = q.data;
  return (
    <Frame title={f.form_label ?? f.type_label} client={{ id: f.client_id, name: f.client_name }} status={f.status} verified={f.verified_flag} docs={docs}>
      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h2>Form</h2><span className="meta">{f.type_label}</span></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Client</dt><dd>{f.client_name} <span className="mono muted">{f.pan_masked}</span></dd>
              <dt>Assessment year</dt><dd><Gap value={f.assessment_year} /></dd>
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
          <DocList items={f.documents} docs={docs} />
        </div>
      </div>
    </Frame>
  );
}
