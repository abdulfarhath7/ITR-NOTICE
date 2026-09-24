/** Screen 3 — Client detail. Years down the side, modules across
 *  (task 3.6). Credentials live in the keychain; this screen only knows
 *  whether one exists (task 3.3). */
import { useEffect, useMemo, useState } from "react";
import { useClient } from "../hooks/use-clients";
import { useWorkItems } from "../hooks/use-work-items";
import { api, describeError } from "../lib/api";
import { describeDue } from "../lib/due";
import { MODULES, MODULE_LABEL, plural } from "../lib/labels";
import { invalidate } from "../lib/query";
import { navigate } from "../lib/router";
import { isSettled, parseStatus } from "../lib/status";
import { toast, toastError } from "../lib/toast";
import type { Module, WorkItemRow } from "../lib/types";
import { stamp } from "../ui/dates";
import { Confirm, Dialog } from "../ui/dialog";
import DueText from "../ui/due-text";
import ExportDialog from "../ui/export-dialog";
import Field from "../ui/field";
import Icon from "../ui/icons";
import { ErrorPage, LoadingPage, Page, PageBody, PageHead } from "../ui/page";
import { StatusPill } from "../ui/pill";
import ClientForm from "./client-form";

function ModulePane({ module, rows }: { module: Module; rows: WorkItemRow[] }) {
  const open = rows.filter((r) => !isSettled(parseStatus(r.status))).length;
  return (
    <div className="card">
      <div className="card-head">
        <h2>{MODULE_LABEL[module]}</h2>
        <span className="meta num">{rows.length ? `${open} open of ${rows.length}` : "none"}</span>
      </div>
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
    <div className="card" id="credentials">
      <div className="card-head">
        <h2>Portal access</h2>
        {hasCredential ? <span className="pill success">Password in keychain</span> : <span className="pill warning">No password stored</span>}
      </div>
      <div className="card-body stack">
        <p className="muted">
          {ownLogin
            ? <>Logs in with the client's own credentials (<span className="mono">{loginRef}</span>).</>
            : <>Reached through the login <span className="mono">{loginRef}</span>; the password stored there is the one used.</>}
          {" "}Passwords go to the OS keychain only, never the database, never a log.
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

function Value({ v, mono = false, none = "Not set" }: { v: string | null | undefined; mono?: boolean; none?: string }) {
  return v ? <span className={mono ? "mono" : undefined}>{v}</span> : <span className="muted">{none}</span>;
}

export default function ClientDetailScreen({ id, tab }: { id: string; tab?: string }) {
  const q = useClient(id);
  // "Fix" on a parked sync lands here with the credentials card in view.
  useEffect(() => {
    if (tab === "credentials" && q.data) document.getElementById("credentials")?.scrollIntoView({ block: "center" });
  }, [tab, q.data]);
  const items = useWorkItems({ client_ids: [id] });
  const [year, setYear] = useState<string | null | undefined>(undefined);   // undefined = not chosen yet
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileNo, setFileNo] = useState<string | null>(null);

  const years = q.data?.years ?? [];
  const selectedYear = year === undefined ? (years[0]?.id ?? null) : year;
  const openByYear = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of items.data ?? []) if (!isSettled(parseStatus(r.status))) m.set(r.year_context_id, (m.get(r.year_context_id) ?? 0) + 1);
    return m;
  }, [items.data]);
  const byYear = useMemo(() => {
    const rows = (items.data ?? []).filter((r) => r.year_context_id === selectedYear);
    return Object.fromEntries(MODULES.map((m) => [m, rows.filter((r) => r.module === m)])) as Record<Module, WorkItemRow[]>;
  }, [items.data, selectedYear]);
  const totals = useMemo(() => {
    const all = items.data ?? [];
    const open = all.filter((r) => !isSettled(parseStatus(r.status)));
    const overdue = open.filter((r) => { const d = describeDue(r.manual_due_date ?? r.due_date, r.status).days; return d !== null && d < 0; });
    return { open: open.length, overdue: overdue.length };
  }, [items.data]);

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

  if (q.error) return <ErrorPage message={q.error} />;
  if (!q.data) return <LoadingPage />;
  const c = q.data;

  return (
    <Page>
      <PageHead title={c.name} back={{ route: { name: "clients" }, label: "Clients" }}
                meta={<span className="row">
                  <span className="mono">{c.pan_masked}</span>
                  {totals.overdue ? <span className="pill danger">{plural(totals.overdue, "overdue item")}</span>
                    : totals.open ? <span className="pill normal">{plural(totals.open, "open item")}</span>
                    : items.data ? <span className="pill success">Clear</span> : null}
                </span>}>
        {c.source === "portal" ? <button className="btn" onClick={() => { void refreshNow(); }}><Icon name="refresh" /><span>Refresh from portal</span></button> : null}
        <button className="btn" onClick={() => setExporting(true)}><Icon name="upload" /><span>Export</span></button>
        <button className="btn" onClick={() => setEditing(true)}>Edit</button>
      </PageHead>
      <PageBody>
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h2>Client</h2><span className={`pill ${c.source === "eri" ? "accent" : ""}`}>{c.source === "eri" ? "ERI" : "portal"}</span></div>
            <div className="card-body">
              <dl className="kv">
                <dt>Client code</dt><dd><Value v={c.client_code} mono /></dd>
                <dt>Entity</dt><dd>{c.entity_type}</dd>
                <dt>GSTIN</dt><dd><Value v={c.gstin} mono /></dd>
                <dt>Group</dt><dd><Value v={c.client_group} none="None" /></dd>
                <dt>Phone</dt><dd className="num"><Value v={c.phone ? `${c.phone_cc} ${c.phone}` : null} /></dd>
                <dt>Email</dt><dd><Value v={c.email} /></dd>
                <dt>Tags</dt><dd><Value v={c.tags} none="None" /></dd>
                <dt>Client file no.</dt>
                <dd>
                  <div className="row">
                    <input className="input short" value={fileNo ?? c.client_file_no ?? ""}
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
            {years.length ? years.map((y) => {
              const n = openByYear.get(y.id) ?? 0;
              return (
                <button key={y.id} role="tab" aria-selected={y.id === selectedYear} aria-current={y.id === selectedYear}
                        onClick={() => setYear(y.id)}>
                  <span>{y.assessment_year ? `AY ${y.assessment_year}` : "Year not stated"}</span>
                  {n ? <span className="count">{n}</span> : null}
                </button>
              );
            }) : <span className="meta">No years yet. A sweep creates them.</span>}
          </div>
          <div className="grid-2">
            {MODULES.map((m) => <ModulePane key={m} module={m} rows={byYear[m] ?? []} />)}
          </div>
        </div>
      </PageBody>
      {editing ? <ClientForm existing={c} onClose={() => setEditing(false)}
                             onSaved={() => { setEditing(false); invalidate(`clients:${id}`); }} /> : null}
      {exporting ? <ExportDialog choices={{ client: { id: c.id, name: c.name } }} onClose={() => setExporting(false)} /> : null}
    </Page>
  );
}
