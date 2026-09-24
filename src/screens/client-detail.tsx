/** Screen 3 — Client detail. Years down the side, modules across
 *  (task 3.6). Credentials live in the keychain; this screen only knows
 *  whether one exists (task 3.3). */
import { useEffect, useMemo, useState } from "react";
import { useClient } from "../hooks/use-clients";
import { useWorkItems } from "../hooks/use-work-items";
import { api, describeError } from "../lib/api";
import { describeDue } from "../lib/due";
import { MODULE_LABEL } from "../lib/labels";
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
import { Avatar } from "../ui/owner-select";
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
                  <td className="wrap">{r.title}<div className="sub">{r.type_label}{r.section ? ` · ${r.section}` : ""}{r.assessment_year ? ` · AY ${r.assessment_year}` : ""}</div></td>
                  <td className="right"><DueText due={due} /></td>
                  <td><StatusPill status={r.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="card-body muted">Nothing recorded here.</div>
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

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "returns", label: "Returns" },
  { key: "forms", label: "Forms" },
  { key: "demands", label: "Demands" },
  { key: "proceedings", label: "e-Proceedings" },
  { key: "notes", label: "Notes" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function tabOf(route: string | undefined): TabKey {
  if (route === "credentials") return "profile";
  return (TABS.find((t) => t.key === route)?.key) ?? "proceedings";
}

/** ₹1,23,456 — whole rupees in the Indian grouping. */
function rupees(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function Tile({ label, value, tone = "" }: { label: string; value: React.ReactNode; tone?: "" | "danger" }) {
  return (
    <div className={`c360-tile${tone ? ` ${tone}` : ""}`}>
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </div>
  );
}

function ClientNotes({ clientId, saved }: { clientId: string; saved: string }) {
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  const save = async () => {
    if (text === saved) return;
    try {
      await api.setClientNote(clientId, text);
      toast("Saved");
      invalidate(`clients:${clientId}`);
    } catch (e) { toastError(describeError(e)); }
  };
  return (
    <div className="card">
      <div className="card-head"><h2>Notes</h2><span className="meta">plain text · saves when you leave the box · synced to the firm</span></div>
      <div className="card-body">
        <textarea className="textarea notes" rows={8} value={text} aria-label="Client notes"
                  placeholder="Engagement terms, contacts, what the client prefers…"
                  onChange={(e) => setText(e.target.value)} onBlur={() => { void save(); }} />
      </div>
    </div>
  );
}

/** Client detail — Client 360 (docs/16 §7): header with the sync switch,
 *  five summary tiles, then tabs. The module tabs reuse the per-module
 *  list, filtered to the chosen year. */
export default function ClientDetailScreen({ id, tab: routeTab }: { id: string; tab?: string }) {
  const q = useClient(id);
  const items = useWorkItems({ client_ids: [id] });
  const [tab, setTab] = useState<TabKey>(() => tabOf(routeTab));
  useEffect(() => setTab(tabOf(routeTab)), [routeTab]);
  // "Fix" on a parked sync lands on Profile with the credentials card in view.
  useEffect(() => {
    if (routeTab === "credentials" && q.data) document.getElementById("credentials")?.scrollIntoView({ block: "center" });
  }, [routeTab, q.data]);
  const [year, setYear] = useState<string | null | undefined>(undefined);   // undefined = not chosen yet
  const [editing, setEditing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fileNo, setFileNo] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);

  const years = q.data?.years ?? [];
  const selectedYear = year === undefined ? null : year;   // null = every year
  const all = useMemo(() => items.data ?? [], [items.data]);
  const openByYear = useMemo(() => {
    const m = new Map<string, number>();
    const module = tab === "profile" || tab === "notes" ? null : tab;
    for (const r of all) if ((!module || r.module === module) && !isSettled(parseStatus(r.status))) m.set(r.year_context_id, (m.get(r.year_context_id) ?? 0) + 1);
    return m;
  }, [all, tab]);
  const tiles = useMemo(() => {
    const openNotices = all.filter((r) => r.module === "proceedings" && !isSettled(parseStatus(r.status)));
    const overdue = all.filter((r) => { const d = describeDue(r.manual_due_date ?? r.due_date, r.status).days; return !isSettled(parseStatus(r.status)) && d !== null && d < 0; });
    const demands = all.filter((r) => r.module === "demands" && !isSettled(parseStatus(r.status)));
    const demandTotal = demands.reduce((sum, r) => sum + (r.amount ?? 0), 0);
    const demandsUnstated = demands.some((r) => r.amount === null);
    const filedYears = new Set(all.filter((r) => r.module === "returns").map((r) => r.year_context_id)).size;
    return { open: openNotices.length, overdue: overdue.length, demandTotal, demandsUnstated, demandCount: demands.length, filedYears };
  }, [all]);

  const syncNow = async () => {
    try {
      await api.refreshClient(id);
      toast("Sync queued for this client. Watch it on the Ingestion screen.");
    } catch (e) { toastError(describeError(e)); }
  };
  const toggleSync = async (on: boolean) => {
    setSyncBusy(true);
    try {
      await api.setClientSyncEnabled(id, on);
      toast(on ? "Included in sweeps again." : "Left out of whole-book and scheduled sweeps. Sync now still works.");
      invalidate(`clients:${id}`);
    } catch (e) { toastError(describeError(e)); }
    finally { setSyncBusy(false); }
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
  const syncOn = c.sync_enabled !== 0;
  const pick = (t: TabKey) => { setTab(t); navigate({ name: "client", id, tab: t }); };
  const moduleRows = (m: Module) => all.filter((r) => r.module === m && (selectedYear === null || r.year_context_id === selectedYear));

  return (
    <Page>
      <PageHead title={c.name} back={{ route: { name: "clients" }, label: "Clients" }}>
        <button className="btn" onClick={() => setExporting(true)}><Icon name="upload" /><span>Export</span></button>
      </PageHead>
      <PageBody>
        <div className="c360-head">
          <Avatar name={c.name} size={38} />
          <div className="c360-id">
            <span className="c360-name">{c.name}</span>
            <span className="c360-line">{[<span key="p" className="mono">{c.pan_masked}</span>, c.gstin ? <span key="g" className="mono">{c.gstin}</span> : null,
              c.phone ? <span key="ph" className="num">{`${c.phone_cc} ${c.phone}`}</span> : null].filter(Boolean).reduce<React.ReactNode[]>((acc, x, i) => (i ? [...acc, " · ", x] : [x]), [])}</span>
          </div>
          <span className="grow" />
          {c.source === "portal" ? (
            <>
              <label className="c360-sync" title="Off: whole-book and scheduled sweeps skip this client">
                <span>Sync</span>
                <span className="switch"><input type="checkbox" checked={syncOn} disabled={syncBusy} onChange={(e) => { void toggleSync(e.target.checked); }} aria-label="Include in sweeps" /><span className="track" /></span>
              </label>
              <button className="btn" onClick={() => { void syncNow(); }}><Icon name="refresh" /><span>Sync now</span></button>
            </>
          ) : <span className="pill accent">ERI</span>}
        </div>

        <div className="c360-tiles">
          <Tile label="Open notices" value={items.data ? tiles.open : "—"} />
          <Tile label="Overdue" value={items.data ? tiles.overdue : "—"} tone={tiles.overdue ? "danger" : ""} />
          <Tile label="Demands total" value={!items.data ? "—" : tiles.demandCount ? <>{rupees(tiles.demandTotal)}{tiles.demandsUnstated ? <span className="unverified" title="some demands state no amount">+ unstated</span> : null}</> : "None"} />
          <Tile label="Returns filed" value={<span className="num">{tiles.filedYears} / {years.length}</span>} />
          <Tile label="Last synced" value={<span className="c360-small">{c.last_sync_at ? stamp(c.last_sync_at) : "Never"}</span>} />
        </div>

        <div className="tabs" role="tablist" aria-label="Client sections">
          {TABS.map((t) => <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => pick(t.key)}>{t.label}</button>)}
        </div>

        {tab === "profile" ? (
          <div className="grid-2">
            <div className="card">
              <div className="card-head">
                <h2>Profile</h2>
                <span className={`pill ${c.source === "eri" ? "accent" : ""}`}>{c.source === "eri" ? "ERI" : "portal"}</span>
                <button className="btn small" onClick={() => setEditing(true)}>Edit</button>
              </div>
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
        ) : tab === "notes" ? (
          <ClientNotes clientId={c.id} saved={c.note ?? ""} />
        ) : (
          <div className="split">
            <div className="side-list" role="tablist" aria-label="Assessment years">
              <button role="tab" aria-selected={selectedYear === null} aria-current={selectedYear === null} onClick={() => setYear(null)}>
                <span>All years</span>
              </button>
              {years.map((y) => {
                const n = openByYear.get(y.id) ?? 0;
                return (
                  <button key={y.id} role="tab" aria-selected={y.id === selectedYear} aria-current={y.id === selectedYear}
                          onClick={() => setYear(y.id)}>
                    <span>{y.assessment_year ? `AY ${y.assessment_year}` : "Year not stated"}</span>
                    {n ? <span className="count">{n}</span> : null}
                  </button>
                );
              })}
              {!years.length ? <span className="meta">No years yet. A sweep creates them.</span> : null}
            </div>
            <ModulePane module={tab} rows={moduleRows(tab)} />
          </div>
        )}
      </PageBody>
      {editing ? <ClientForm existing={c} onClose={() => setEditing(false)}
                             onSaved={() => { setEditing(false); invalidate(`clients:${id}`); }} /> : null}
      {exporting ? <ExportDialog onClose={() => setExporting(false)} choices={{
        client: { id: c.id, name: c.name },
        // On a module tab, the rows on screen (that module, the chosen year).
        view: tab !== "profile" && tab !== "notes" ? {
          items: moduleRows(tab).map((r) => [r.module, r.id] as [string, string]),
          label: `${c.name} · ${MODULE_LABEL[tab]} · ${selectedYear ? `AY ${years.find((y) => y.id === selectedYear)?.assessment_year ?? "not stated"}` : "all years"}`,
          sheet: `${c.name}-${MODULE_LABEL[tab]}`,
        } : null,
      }} /> : null}
    </Page>
  );
}
