/** Screen 3 — Client detail. Years down the side, modules across
 *  (task 3.6). Credentials live in the keychain; this screen only knows
 *  whether one exists (task 3.3). */
import { useMemo, useState } from "react";
import { useClient } from "../hooks/use-clients";
import { useWorkItems } from "../hooks/use-work-items";
import { api, describeError } from "../lib/api";
import { describeDue } from "../lib/due";
import { invalidate } from "../lib/query";
import { href, navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import type { Module, WorkItemRow } from "../lib/types";
import { Confirm, Dialog } from "../ui/dialog";
import DueText from "../ui/due-text";
import Field from "../ui/field";
import { StatusPill } from "../ui/pill";
import { stamp } from "../ui/dates";
import ClientForm from "./client-form";
import ExportDialog from "../ui/export-dialog";

const MODULES: { key: Module; label: string }[] = [
  { key: "proceedings", label: "e-Proceedings" },
  { key: "demands", label: "Outstanding demands" },
  { key: "returns", label: "e-Returns filed" },
  { key: "forms", label: "e-Forms filed" },
];

function ModulePane({ module, rows }: { module: Module; rows: WorkItemRow[] }) {
  const label = MODULES.find((m) => m.key === module)?.label ?? module;
  return (
    <div className="card">
      <div className="card-head"><h2>{label}</h2><span className="meta num">{rows.length}</span></div>
      {rows.length ? (
        <table className="table">
          <tbody>
            {rows.map((r) => {
              const due = describeDue(r.manual_due_date ?? r.due_date, r.status);
              return (
                <tr key={r.id} className="row-link" tabIndex={0}
                    onClick={() => navigate({ name: "item", module: r.module, id: r.id })}
                    onKeyDown={(e) => { if (e.key === "Enter") navigate({ name: "item", module: r.module, id: r.id }); }}>
                  <td className="wrap">{r.title}<div className="sub">{r.type_label}{r.section ? ` · ${r.section}` : ""}</div></td>
                  <td className="right"><DueText due={due} /></td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="card-body muted">Nothing recorded for this year.</div>
      )}
    </div>
  );
}

function CredentialCard({ clientId, hasCredential, loginRef, ownLogin }: {
  clientId: string; hasCredential: boolean; loginRef: string; ownLogin: boolean;
}) {
  const [setting, setSetting] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      await api.setClientCredential(clientId, password);
      setPassword("");            // never leave it in the DOM
      setSetting(false);
      invalidate(`clients:${clientId}`);
      toast("Password stored in the OS keychain.");
    } catch (e) { toastError(describeError(e)); }
    finally { setBusy(false); }
  };
  const forget = async () => {
    try {
      await api.forgetClientCredential(clientId);
      setForgetting(false);
      invalidate(`clients:${clientId}`);
      toast("Password removed from the keychain.");
    } catch (e) { toastError(describeError(e)); }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h2>Portal access</h2>
        {hasCredential ? <span className="pill success">Password in keychain</span> : <span className="pill warning">No password stored</span>}
      </div>
      <div className="card-body stack">
        <p className="muted">
          {ownLogin
            ? <>Logs in with the client's own credentials (<span className="mono">{loginRef}</span>).</>
            : <>Reached through the login <span className="mono">{loginRef}</span>; the password stored there is the one used.</>}
          {" "}Passwords go to the OS keychain only — never the database, never a log.
        </p>
        <div className="row">
          <button className="btn" onClick={() => setSetting(true)}>{hasCredential ? "Replace password" : "Store password"}</button>
          {hasCredential ? <button className="btn danger" onClick={() => setForgetting(true)}>Forget</button> : null}
        </div>
      </div>
      {setting ? (
        <Dialog title={`Password for ${loginRef}`} onClose={() => { setPassword(""); setSetting(false); }} footer={
          <>
            <button className="btn" onClick={() => { setPassword(""); setSetting(false); }}>Cancel</button>
            <button className="btn accent" disabled={!password || busy} onClick={() => { void save(); }}>Store</button>
          </>
        }>
          <Field label="Portal password" hint="stored under the OS account; anyone using this Windows or macOS login can use it">
            <input className="input" type="password" autoComplete="new-password" value={password}
                   onChange={(e) => setPassword(e.target.value)} />
          </Field>
        </Dialog>
      ) : null}
      {forgetting ? (
        <Confirm title="Forget this password?" body={`The keychain entry for ${loginRef} is deleted. The next sweep will ask for it.`}
                 confirmLabel="Forget" danger onConfirm={() => { void forget(); }} onClose={() => setForgetting(false)} />
      ) : null}
    </div>
  );
}

export default function ClientDetailScreen({ id }: { id: string }) {
  const q = useClient(id);
  const items = useWorkItems({ client_ids: [id] });
  const [year, setYear] = useState<string | null | undefined>(undefined);   // undefined = not chosen yet
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileNo, setFileNo] = useState<string | null>(null);

  const years = q.data?.years ?? [];
  const selectedYear = year === undefined ? (years[0]?.id ?? null) : year;
  const byYear = useMemo(() => {
    const rows = (items.data ?? []).filter((r) => r.year_context_id === selectedYear);
    return Object.fromEntries(MODULES.map((m) => [m.key, rows.filter((r) => r.module === m.key)])) as Record<Module, WorkItemRow[]>;
  }, [items.data, selectedYear]);

  const refreshNow = async () => {
    try {
      await api.refreshClient(id);
      toast("Refresh queued. Watch it on the Ingestion screen.");
      navigate({ name: "ingestion" });
    } catch (e) { toastError(describeError(e)); }
  };

  const saveFileNo = async () => {
    if (fileNo === null) return;
    try {
      await api.setClientFileNo(id, fileNo);
      setFileNo(null);
      invalidate(`clients:${id}`);
      toast("File number saved.");
    } catch (e) { toastError(describeError(e)); }
  };

  if (q.error) return <div className="page"><div className="page-body"><div className="banner danger">{q.error}</div></div></div>;
  if (!q.data) return <div className="page"><div className="loading">Loading</div></div>;
  const c = q.data;

  return (
    <div className="page">
      <div className="page-head">
        <a className="btn small quiet" href={href({ name: "clients" })}>Clients</a>
        <h1>{c.name}</h1>
        <span className="meta mono">{c.pan_masked}</span>
        {c.source === "portal" ? <button className="btn" onClick={() => { void refreshNow(); }}>Refresh from portal</button> : null}
        <button className="btn" onClick={() => setExporting(true)}>Export</button>
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
      </div>
      <div className="page-body">
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h2>Client</h2><span className={`pill ${c.source === "eri" ? "accent" : ""}`}>{c.source === "eri" ? "ERI" : "portal"}</span></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Client code</dt><dd className="mono">{c.client_code ?? <span className="muted">Not set</span>}</dd>
                <dt>Entity</dt><dd>{c.entity_type}</dd>
                <dt>GSTIN</dt><dd className="mono">{c.gstin ?? <span className="muted">Not set</span>}</dd>
                <dt>Group</dt><dd>{c.client_group ?? <span className="muted">None</span>}</dd>
                <dt>Phone</dt><dd className="num">{c.phone ? `${c.phone_cc} ${c.phone}` : <span className="muted">Not set</span>}</dd>
                <dt>Email</dt><dd>{c.email ?? <span className="muted">Not set</span>}</dd>
                <dt>Tags</dt><dd>{c.tags ?? <span className="muted">None</span>}</dd>
                <dt>Client file no.</dt>
                <dd>
                  <div className="row">
                    <input className="input" style={{ maxWidth: 220 }} value={fileNo ?? c.client_file_no ?? ""}
                           onChange={(e) => setFileNo(e.target.value)} aria-label="Client file number" />
                    {fileNo !== null && fileNo !== (c.client_file_no ?? "")
                      ? <button className="btn small" onClick={() => { void saveFileNo(); }}>Save</button> : null}
                  </div>
                </dd>
                <dt>Added</dt><dd className="num">{stamp(c.created_at)}</dd>
              </dl>
            </div>
          </div>
          <CredentialCard clientId={c.id} hasCredential={c.has_credential}
                          loginRef={c.login_ref_effective} ownLogin={!c.portal_login_ref} />
        </div>

        <div className="split">
          <div className="side-list" role="tablist" aria-label="Assessment years">
            {years.length ? years.map((y) => (
              <button key={y.id} role="tab" aria-current={y.id === selectedYear}
                      onClick={() => setYear(y.id)}>
                {y.assessment_year ? `AY ${y.assessment_year}` : "Year not stated"}
              </button>
            )) : <span className="meta">No years yet — a sweep creates them.</span>}
          </div>
          <div className="grid-2">
            {MODULES.map((m) => <ModulePane key={m.key} module={m.key} rows={byYear[m.key] ?? []} />)}
          </div>
        </div>
      </div>
      {editing ? <ClientForm existing={c} onClose={() => setEditing(false)}
                             onSaved={() => { setEditing(false); invalidate(`clients:${id}`); }} /> : null}
      {exporting ? <ExportDialog choices={{ client: { id: c.id, name: c.name } }} onClose={() => setExporting(false)} /> : null}
    </div>
  );
}
