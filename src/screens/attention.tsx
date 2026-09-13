/** Screen 1 — Attention. One ranked list across the modules: the counts
 *  up top are the ranking's own buckets and double as the filter; the
 *  rows below are grouped by that same rank. */
import { useCallback, useMemo, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useRowNav, type RowNavProps } from "../hooks/use-row-nav";
import { useAttention, useWorkItems } from "../hooks/use-work-items";
import { RANKS, RANK_LABEL, RANK_TONE, type Rank, type RankedItem } from "../lib/attention";
import { MODULES, MODULE_LABEL, MODULE_NOUN, plural } from "../lib/labels";
import { href, navigate } from "../lib/router";
import { STATUSES, STATUS_LABEL, isSettled } from "../lib/status";
import type { Module } from "../lib/types";
import DueText from "../ui/due-text";
import EmptyState from "../ui/empty-state";
import ExportDialog from "../ui/export-dialog";
import Icon from "../ui/icons";
import { Page, PageBody, PageHead } from "../ui/page";
import { StatusPill } from "../ui/pill";

function Row({ item, nav }: { item: RankedItem; nav: RowNavProps }) {
  const r = item.row;
  const open = () => navigate({ name: "item", module: r.module, id: r.id });
  return (
    <tr className="row-link" onClick={open} {...nav}>
      <td className="wrap">
        {r.client_name}
        <div className="sub mono">{[r.client_code, r.pan_masked].filter(Boolean).join(" · ")}</div>
      </td>
      <td><span className="pill">{MODULE_NOUN[r.module]}</span></td>
      <td className="wrap">
        {r.title}
        <div className="sub">{r.type_label}{r.section ? ` · ${r.section}` : ""}</div>
      </td>
      <td className="num">{r.assessment_year ?? <span className="muted">Not stated</span>}</td>
      <td className="right">
        <DueText due={item.due} />
        {r.manual_due_date ? <div className="sub">manual{r.due_date ? ` · portal ${r.due_date}` : ""}</div> : null}
        {!item.effectiveDue && r.suggested_due_date ? <div className="sub suggested">suggested {r.suggested_due_date}</div> : null}
      </td>
      <td className="right"><DueText due={item.limitation} unverified={r.gap_flags.includes("limitation_date")} /></td>
      <td><StatusPill status={item.status} /></td>
      <td className="right">
        <a className="btn small" href={href({ name: "item", module: r.module, id: r.id })} onClick={(e) => e.stopPropagation()}>View</a>
      </td>
    </tr>
  );
}

export default function AttentionScreen() {
  const [clientId, setClientId] = useState("");
  const [ay, setAy] = useState("");
  const [module, setModule] = useState<"" | Module>("");
  const [status, setStatus] = useState("");
  const [rank, setRank] = useState<Rank | null>(null);
  const [exporting, setExporting] = useState(false);

  const clients = useClients("");
  const q = useWorkItems({ client_ids: clientId ? [clientId] : null, assessment_year: ay || null, module: module || null, status: status || null });
  const ranked = useAttention(q.data);
  const counts = useMemo(() => {
    const c: Record<Rank, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const i of ranked) c[i.rank]++;
    return c;
  }, [ranked]);
  const visible = useMemo(() => (rank ? ranked.filter((i) => i.rank === rank) : ranked), [ranked, rank]);
  const years = useMemo(
    () => [...new Set((q.data ?? []).map((r) => r.assessment_year).filter((y): y is string => !!y))].sort().reverse(),
    [q.data]);

  const filtered = !!(clientId || ay || module || status || rank);
  const clear = () => { setClientId(""); setAy(""); setModule(""); setStatus(""); setRank(null); };
  const openAt = useCallback((i: number) => {
    const it = visible[i];
    if (it) navigate({ name: "item", module: it.row.module, id: it.row.id });
  }, [visible]);
  const nav = useRowNav(visible.length, openAt);

  const groups = useMemo(() => {
    const out: { rank: Rank; items: { item: RankedItem; index: number }[] }[] = [];
    visible.forEach((item, index) => {
      const last = out[out.length - 1];
      if (last && last.rank === item.rank) last.items.push({ item, index });
      else out.push({ rank: item.rank, items: [{ item, index }] });
    });
    return out;
  }, [visible]);

  return (
    <Page>
      <PageHead title="Attention" meta={q.loading && !q.data ? "Loading" : plural(visible.length, "open item")}>
        <button className="btn" onClick={() => setExporting(true)}><Icon name="upload" /><span>Export</span></button>
      </PageHead>
      <PageBody>
        <div className="stats" role="group" aria-label="By urgency">
          {RANKS.map((r) => (
            <button key={r} type="button" className={`stat ${RANK_TONE[r]}`} aria-pressed={rank === r}
                    onClick={() => setRank(rank === r ? null : r)}>
              <span className="value">{counts[r]}</span>
              <span className="label">{RANK_LABEL[r]}</span>
            </button>
          ))}
        </div>

        <div className="toolbar">
          <select className="select" value={clientId} aria-label="Client" onChange={(e) => setClientId(e.target.value)}>
            <option value="">All clients</option>
            {(clients.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className="select" value={ay} onChange={(e) => setAy(e.target.value)} aria-label="Assessment year">
            <option value="">All years</option>
            {years.map((y) => <option key={y} value={y}>AY {y}</option>)}
          </select>
          <select className="select" value={module} onChange={(e) => setModule(e.target.value as "" | Module)} aria-label="Module">
            <option value="">All modules</option>
            {MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}</option>)}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Open statuses</option>
            {STATUSES.filter((s) => !isSettled(s)).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
          {filtered ? <button className="btn quiet" onClick={clear}><Icon name="x" /><span>Clear filters</span></button> : null}
          <span className="grow" />
          <span className="meta">↑ ↓ to move · Enter to open</span>
        </div>

        {q.error ? (
          <div className="banner danger" role="alert">{q.error}</div>
        ) : q.loading && !q.data ? (
          <div className="loading">Loading</div>
        ) : !visible.length ? (
          <div className="card">
            <EmptyState
              title={q.data?.length || filtered ? "Nothing open matches these filters." : "Nothing needs attention."}
              body={q.data?.length || filtered
                ? "Clear a filter to see the rest of the open items."
                : "Open proceedings, demands, returns and forms appear here once a sweep has run. Settled items stay in client detail and in exports."}
              action={q.data?.length || filtered
                ? <button className="btn" onClick={clear}>Clear filters</button>
                : <a className="btn" href={href({ name: "ingestion" })}>Go to ingestion</a>} />
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table" onKeyDown={nav.onKeyDown} aria-label="Items needing attention">
              <thead><tr>
                <th>Client</th><th>Module</th><th>What it is</th><th>AY</th>
                <th className="right">Due</th><th className="right">Limitation</th><th>Status</th><th className="right"><span className="sr-only">Actions</span></th>
              </tr></thead>
              {groups.map((g) => (
                <tbody key={g.rank}>
                  <tr className="group"><th colSpan={8} scope="rowgroup">
                    <span className={`dot ${RANK_TONE[g.rank]}`} />{RANK_LABEL[g.rank]}<span className="count">{g.items.length}</span>
                  </th></tr>
                  {g.items.map(({ item, index }) => <Row key={`${item.row.module}:${item.row.id}`} item={item} nav={nav.rowProps(index)} />)}
                </tbody>
              ))}
            </table>
          </div>
        )}
      </PageBody>
      {exporting ? (
        <ExportDialog onClose={() => setExporting(false)} choices={{
          view: { items: visible.map((i) => [i.row.module, i.row.id] as [string, string]), label: `attention list, ${plural(visible.length, "open item")}` },
        }} />
      ) : null}
    </Page>
  );
}
