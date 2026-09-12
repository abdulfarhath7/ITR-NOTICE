/** Screen 2 — Clients. The client book. */
import { useState } from "react";
import { useClients } from "../hooks/use-clients";
import { href, navigate } from "../lib/router";
import EmptyState from "../ui/empty-state";
import { stamp } from "../ui/dates";
import ClientForm from "./client-form";
import ClientImport from "./client-import";

export default function ClientsScreen() {
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const q = useClients(search);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Clients</h1>
        <input className="input" placeholder="Search name, code or PAN" value={search}
               onChange={(e) => setSearch(e.target.value)} aria-label="Search clients" style={{ width: 240 }} />
        <button className="btn" onClick={() => setImporting(true)}>Import</button>
        <button className="btn accent" onClick={() => setAdding(true)}>Add</button>
      </div>
      <div className="page-body">
        {q.error ? <div className="banner danger">{q.error}</div>
        : q.loading && !q.data ? <div className="loading">Loading</div>
        : !q.data?.length ? (
          <div className="card">
            <EmptyState
              title={search ? "No client matches that." : "No clients in the book yet."}
              body={search ? "Try a different name, code or PAN fragment." : "Add a client by hand, or import the firm's list from a CSV."}
              action={search ? undefined : <button className="btn accent" onClick={() => setAdding(true)}>Add a client</button>} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Name</th><th>Code</th><th>PAN</th><th>Source</th>
                <th className="num">Open</th><th className="num">Overdue</th><th>Last sync</th><th>Status</th>
              </tr></thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id} className="row-link" tabIndex={0}
                      onClick={() => navigate({ name: "client", id: c.id })}
                      onKeyDown={(e) => { if (e.key === "Enter") navigate({ name: "client", id: c.id }); }}>
                    <td className="wrap">
                      <a href={href({ name: "client", id: c.id })} onClick={(e) => e.stopPropagation()}>{c.name}</a>
                      {c.client_group ? <div className="sub">{c.client_group}</div> : null}
                    </td>
                    <td className="mono">{c.client_code ?? <span className="faint">—</span>}</td>
                    <td className="mono">{c.pan_masked}</td>
                    <td><span className={`pill ${c.source === "eri" ? "accent" : ""}`}>{c.source === "eri" ? "ERI" : "portal"}</span>
                      {c.portal_login_ref ? <span className="sub mono">via {c.portal_login_ref}</span> : null}</td>
                    <td className="num">{c.open_count}</td>
                    <td className="num">{c.overdue_count ? <span className="due danger">{c.overdue_count}</span> : "0"}</td>
                    <td className="num">{stamp(c.last_sync_at)}</td>
                    <td>
                      {c.overdue_count ? <span className="pill danger">Overdue</span>
                        : c.last_sync_status === "credentials_parked" ? <span className="pill danger">Credentials need attention</span>
                        : c.last_sync_status === "failed" ? <span className="pill warning">Last sweep failed</span>
                        : !c.last_sync_at ? <span className="pill">Never swept</span>
                        : c.open_count ? <span className="pill normal">Open items</span>
                        : <span className="pill success">Clear</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {adding ? <ClientForm existing={null} onClose={() => setAdding(false)}
                            onSaved={(c) => { setAdding(false); navigate({ name: "client", id: c.id }); }} /> : null}
      {importing ? <ClientImport onClose={() => setImporting(false)} /> : null}
    </div>
  );
}
