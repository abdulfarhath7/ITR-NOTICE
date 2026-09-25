/** Screen 2 — Clients. The client book: search, sortable columns, and a
 *  status pill that says the one thing worth knowing about each client. */
import { useCallback, useMemo, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useRowNav } from "../hooks/use-row-nav";
import { plural } from "../lib/labels";
import { href, navigate } from "../lib/router";
import type { ClientSummary } from "../lib/types";
import { stamp } from "../ui/dates";
import EmptyState from "../ui/empty-state";
import ExportDialog from "../ui/export-dialog";
import Icon from "../ui/icons";
import { Page, PageBody, PageHead } from "../ui/page";
import ClientForm from "./client-form";
import ClientImport from "./client-import";

type SortKey = "name" | "client_code" | "open_count" | "overdue_count" | "last_sync_at";
const DEFAULT_DIR: Record<SortKey, 1 | -1> = { name: 1, client_code: 1, open_count: -1, overdue_count: -1, last_sync_at: -1 };

function compare(a: ClientSummary, b: ClientSummary, key: SortKey): number {
  const x = a[key], y = b[key];
  if (x === y) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
}

type Sort = { key: SortKey; dir: 1 | -1 };

function Th({ k, sort, onSort, num = false, children }: { k: SortKey; sort: Sort; onSort: (k: SortKey) => void; num?: boolean; children: React.ReactNode }) {
  const on = sort.key === k;
  return (
    <th className={num ? "num" : undefined} aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="th-sort" onClick={() => onSort(k)}>
        {children}{on ? <Icon name="chevron-down" className={sort.dir === 1 ? "flip" : undefined} /> : null}
      </button>
    </th>
  );
}

function ClientStatus({ c }: { c: ClientSummary }) {
  if (c.overdue_count) return <span className="pill danger">{plural(c.overdue_count, "overdue item")}</span>;
  if (c.last_sync_status === "credentials_parked") return <span className="pill danger">Credentials need attention</span>;
  if (c.last_sync_status === "failed") return <span className="pill warning">Last sweep failed</span>;
  if (!c.last_sync_at) return <span className="pill">Never swept</span>;
  if (c.open_count) return <span className="pill normal">Open items</span>;
  return <span className="pill success">Clear</span>;
}

const HISTORY_TONE = { full: "success", partial: "accent", recent: "" } as const;

/** History depth, plus the dormant and paused facts (docs/17 §6.4). */
function HistoryCell({ c }: { c: ClientSummary }) {
  if (c.source === "eri") return <span className="faint">—</span>;
  return (
    <span className="client-history">
      <span className={`pill ${HISTORY_TONE[c.history_depth] ?? ""}`}>{c.history_depth}</span>
      {c.cadence_tier === "weekly" && !c.cadence_pinned
        ? <span className="pill" title="Dormant: swept once a week">weekly</span> : null}
      {!c.sync_enabled ? <span className="pill" title="Left out of sweeps">Paused</span> : null}
    </span>
  );
}

export default function ClientsScreen() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "name", dir: 1 });
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const q = useClients(search.trim());

  const rows = useMemo(() => {
    const list = [...(q.data ?? [])];
    list.sort((a, b) => sort.dir * compare(a, b, sort.key) || a.name.localeCompare(b.name));
    return list;
  }, [q.data, sort]);
  const summary = useMemo(() => {
    const all = q.data ?? [];
    return { total: all.length, overdue: all.filter((c) => c.overdue_count).length, never: all.filter((c) => !c.last_sync_at).length };
  }, [q.data]);

  const openAt = useCallback((i: number) => { const c = rows[i]; if (c) navigate({ name: "client", id: c.id }); }, [rows]);
  const nav = useRowNav(rows.length, openAt);
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: DEFAULT_DIR[key] }));

  return (
    <Page>
      <PageHead title="Clients" meta={q.data ? plural(summary.total, "client") : undefined}>
        <label className="search">
          <Icon name="search" />
          <input placeholder="Name, code or PAN" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" />
        </label>
        <button className="btn" onClick={() => setImporting(true)}><Icon name="download" /><span>Import</span></button>
        <button className="btn" onClick={() => setExporting(true)}><Icon name="upload" /><span>Export</span></button>
        <button className="btn accent" onClick={() => setAdding(true)}><Icon name="plus" /><span>Add</span></button>
      </PageHead>
      <PageBody>
        {q.data && !search && summary.total ? (
          <div className="row meta">
            {summary.overdue ? <span className="due danger">{plural(summary.overdue, "client")} with overdue items</span> : <span>No client has an overdue item</span>}
            {summary.never ? <span>· {plural(summary.never, "client")} never swept</span> : null}
          </div>
        ) : null}
        {q.error ? <div className="banner danger" role="alert">{q.error}</div>
        : q.loading && !q.data ? <div className="loading">Loading</div>
        : !rows.length ? (
          <div className="card">
            <EmptyState
              title={search ? "No client matches that." : "No clients in the book yet."}
              body={search ? "Try a different name, code or PAN fragment." : "Add a client by hand, or import the firm's list from a CSV."}
              action={search ? undefined : <button className="btn accent" onClick={() => setAdding(true)}>Add a client</button>} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" onKeyDown={nav.onKeyDown} aria-label="Clients">
              <thead><tr>
                <Th k="name" sort={sort} onSort={toggle}>Name</Th><Th k="client_code" sort={sort} onSort={toggle}>Code</Th><th>PAN</th><th>Source</th>
                <Th k="open_count" sort={sort} onSort={toggle} num>Open</Th><Th k="overdue_count" sort={sort} onSort={toggle} num>Overdue</Th>
                <Th k="last_sync_at" sort={sort} onSort={toggle} num>Last sync</Th><th>History</th><th>Status</th>
              </tr></thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.id} className="row-link" onClick={() => navigate({ name: "client", id: c.id })} {...nav.rowProps(i)}>
                    <td className="wrap">
                      <a href={href({ name: "client", id: c.id })} onClick={(e) => e.stopPropagation()} tabIndex={-1}>{c.name}</a>
                      {c.client_group ? <div className="sub">{c.client_group}</div> : null}
                    </td>
                    <td className="mono">{c.client_code ?? <span className="faint">—</span>}</td>
                    <td className="mono">{c.pan_masked}</td>
                    <td>
                      <span className={`pill ${c.source === "eri" ? "accent" : ""}`}>{c.source === "eri" ? "ERI" : "portal"}</span>
                      {c.portal_login_ref ? <div className="sub mono">via {c.portal_login_ref}</div> : null}
                    </td>
                    <td className="num">{c.open_count}</td>
                    <td className="num">{c.overdue_count ? <span className="due danger">{c.overdue_count}</span> : <span className="faint">0</span>}</td>
                    <td className="num">{stamp(c.last_sync_at)}</td>
                    <td><HistoryCell c={c} /></td>
                    <td><ClientStatus c={c} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageBody>
      {adding ? <ClientForm existing={null} onClose={() => setAdding(false)}
                            onSaved={(c) => { setAdding(false); navigate({ name: "client", id: c.id }); }} /> : null}
      {importing ? <ClientImport onClose={() => setImporting(false)} /> : null}
      {exporting ? <ExportDialog choices={{}} onClose={() => setExporting(false)} /> : null}
    </Page>
  );
}
