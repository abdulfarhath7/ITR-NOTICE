/** Screen 1 — Attention. One ranked list across the modules. */
import { useMemo, useState } from "react";
import { useAttention, useWorkItems } from "../hooks/use-work-items";
import { useClients } from "../hooks/use-clients";
import { RANK_LABEL, inDueWindow, type DueWindow, type Rank } from "../lib/attention";
import { href, navigate } from "../lib/router";
import { STATUSES, STATUS_LABEL } from "../lib/status";
import type { Module } from "../lib/types";
import DueText from "../ui/due-text";
import EmptyState from "../ui/empty-state";
import { StatusPill } from "../ui/pill";
import ExportDialog from "../ui/export-dialog";

const MODULE_LABEL: Record<Module, string> = {
  proceedings: "Proceeding", demands: "Demand", returns: "Return", forms: "Form",
};

export default function AttentionScreen() {
  const [clientIds, setClientIds] = useState<string[]>([]);
  const [ay, setAy] = useState("");
  const [module, setModule] = useState<"" | Module>("");
  const [status, setStatus] = useState("");
  const [window, setWindow] = useState<DueWindow>("");
  const [exporting, setExporting] = useState(false);

  const clients = useClients("");
  const q = useWorkItems({
    client_ids: clientIds.length ? clientIds : null,
    assessment_year: ay || null,
    module: module || null,
    status: status || null,
  });
  const ranked = useAttention(q.data);
  const visible = useMemo(() => ranked.filter((i) => inDueWindow(i, window)), [ranked, window]);
  const years = useMemo(
    () => [...new Set((q.data ?? []).map((r) => r.assessment_year).filter((y): y is string => !!y))].sort().reverse(),
    [q.data]);

  const counts = useMemo(() => {
    const c: Record<Rank, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const i of visible) c[i.rank]++;
    return c;
  }, [visible]);

  return (
    <div className="page">
      <div className="page-head">
        <h1>Attention</h1>
        <span className="meta num">{q.loading ? "Loading" : `${visible.length} open item${visible.length === 1 ? "" : "s"}`}</span>
        <button className="btn" onClick={() => setExporting(true)}>Export</button>
      </div>
      <div className="page-body">
        <div className="filters">
          <select className="select" multiple={false} value={clientIds[0] ?? ""} aria-label="Client"
                  onChange={(e) => setClientIds(e.target.value ? [e.target.value] : [])}>
            <option value="">All clients</option>
            {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" value={ay} onChange={(e) => setAy(e.target.value)} aria-label="Assessment year">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>AY {y}</option>)}
          </select>
          <select className="select" value={module} onChange={(e) => setModule(e.target.value as "" | Module)} aria-label="Module">
            <option value="">All modules</option>
            {(Object.keys(MODULE_LABEL) as Module[]).map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}s</option>)}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Open statuses</option>
            {STATUSES.filter((s) => s !== "closed" && s !== "response_submitted")
              .map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          <select className="select" value={window} onChange={(e) => setWindow(e.target.value as DueWindow)} aria-label="Due window">
            <option value="">Any due date</option>
            <option value="overdue">Overdue</option>
            <option value="7">Due within 7 days</option>
            <option value="30">Due within 30 days</option>
            <option value="none">No date stated</option>
          </select>
        </div>

        <div className="row meta">
          {([1, 2, 3, 4, 5] as Rank[]).map((r) => (
            <span key={r} className="num">{RANK_LABEL[r]}: <b>{counts[r]}</b></span>
          ))}
        </div>

        {q.error ? (
          <div className="banner danger">{q.error}</div>
        ) : q.loading && !q.data ? (
          <div className="loading">Loading</div>
        ) : !visible.length ? (
          <div className="card">
            <EmptyState
              title={q.data?.length ? "Nothing open matches these filters." : "Nothing needs attention."}
              body={q.data?.length
                ? "Clear a filter to see the rest of the open items."
                : "Open proceedings, demands, returns and forms appear here once a sweep has run. Settled items stay in client detail and in exports."}
              action={q.data?.length ? undefined
                : <a className="btn" href={href({ name: "ingestion" })}>Go to ingestion</a>} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr>
                <th>Client</th><th>Module</th><th>What it is</th><th>AY</th>
                <th className="right">Due</th><th className="right">Limitation</th><th>Status</th><th className="right">Actions</th>
              </tr></thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={`${i.row.module}:${i.row.id}`} className="row-link" tabIndex={0}
                      onClick={() => navigate({ name: "item", module: i.row.module, id: i.row.id })}
                      onKeyDown={(e) => { if (e.key === "Enter") navigate({ name: "item", module: i.row.module, id: i.row.id }); }}>
                    <td className="wrap">
                      {i.row.client_name}
                      <div className="sub mono">{i.row.client_code ? `${i.row.client_code} · ` : ""}{i.row.pan_masked}</div>
                    </td>
                    <td><span className="pill">{MODULE_LABEL[i.row.module]}</span></td>
                    <td className="wrap">
                      {i.row.title}
                      <div className="sub">{i.row.type_label}{i.row.section ? ` · ${i.row.section}` : ""}</div>
                    </td>
                    <td className="num">{i.row.assessment_year ?? <span className="muted">Not stated</span>}</td>
                    <td className="right">
                      <DueText due={i.due} />
                      {i.row.manual_due_date ? <div className="sub">manual{i.row.due_date ? ` · portal: ${i.row.due_date}` : ""}</div> : null}
                      {!i.effectiveDue && i.row.suggested_due_date
                        ? <div className="sub suggested">suggested {i.row.suggested_due_date}</div> : null}
                    </td>
                    <td className="right"><DueText due={i.limitation} /></td>
                    <td><StatusPill status={i.status} /></td>
                    <td className="right">
                      <div className="actions">
                        <a className="btn small" href={href({ name: "item", module: i.row.module, id: i.row.id })}
                           onClick={(e) => e.stopPropagation()}>View</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {exporting ? (
        <ExportDialog onClose={() => setExporting(false)} choices={{
          view: { items: visible.map((i) => [i.row.module, i.row.id] as [string, string]),
                  label: `attention list, ${visible.length} open item${visible.length === 1 ? "" : "s"}` },
        }} />
      ) : null}
    </div>
  );
}
