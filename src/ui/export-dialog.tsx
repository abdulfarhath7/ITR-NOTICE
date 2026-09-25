/** Excel export (docs/11, docs/18 §4.1). Left: what will be exported in
 *  human form, then the column picker. Right: the sheet preview, built
 *  from the same header strings and cells the Rust side writes, so the
 *  dialog never re-implements the formatting. The scope selector from
 *  docs/11 stays: the current view, all clients, or one client. */
import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, describeError } from "../lib/api";
import { toast } from "../lib/toast";
import type { ExportPreview, ExportScope, Settings } from "../lib/types";
import { Dialog } from "./dialog";

export interface ExportSummary {
  /** `Issued in last 15 days (…)` or `All open items`, as the sheet's row 2 will carry it. */
  filter: string;
  /** `11 Sep – 25 Sep 2026` or `All dates`. */
  range: string;
  client: string;
  module: string;
  status: string;
}

export interface ExportChoices {
  /** The rows the screen is showing, when it has a filtered view. */
  view?: {
    items: [string, string][];
    /** The filter line (docs/18 §4.2); passed through unchanged as the scope label. */
    label: string;
    sheet?: string;
    /** `issued-15d` / `due-30d`, for the filename slug. */
    window?: string | null;
    summary?: ExportSummary;
  } | null;
  /** The client on screen, when there is one. */
  client?: { id: string; name: string } | null;
  /** Client 360: the client is fixed; "All clients" is not offered. */
  fixedClient?: boolean;
}

/** Ticked by default: everything but Note (docs/18 §4.1). */
function defaultColumns(all: string[]): string[] {
  return all.filter((c) => c !== "Note");
}

export default function ExportDialog({ choices, onClose }: { choices: ExportChoices; onClose: () => void }) {
  const initial: ExportScope["kind"] = choices.view ? "view" : choices.client ? "client" : "all";
  const [kind, setKind] = useState<ExportScope["kind"]>(initial);
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [preview, setPreview] = useState<ExportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope = useMemo((): ExportScope => {
    if (kind === "view" && choices.view) return { kind: "view", items: choices.view.items, label: choices.view.label };
    if (kind === "client" && choices.client) return { kind: "client", client_id: choices.client.id };
    return { kind: "all" };
  }, [kind, choices.view, choices.client]);
  const window = kind === "view" ? (choices.view?.window ?? null) : null;

  // Columns and the remembered choice (Q54: one settings key, read here).
  useEffect(() => {
    let live = true;
    Promise.all([api.exportColumns(), api.settings()]).then(([all, s]) => {
      if (!live) return;
      setAllColumns(all);
      setSettings(s);
      const remembered = s.export_columns?.filter((c) => all.includes(c));
      setColumns(remembered && remembered.length ? all.filter((c) => remembered.includes(c)) : defaultColumns(all));
    }).catch((e) => { if (live) setError(describeError(e)); });
    return () => { live = false; };
  }, []);

  const columnsKey = columns?.join("|") ?? "";
  useEffect(() => {
    if (!columns) return;
    let live = true;
    api.previewExportSheet(scope, { columns }, window).then((p) => { if (live) setPreview(p); })
      .catch((e) => { if (live) { setPreview(null); setError(describeError(e)); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, columnsKey, window]);

  const toggleColumn = (c: string) => {
    if (!columns) return;
    const next = columns.includes(c) ? columns.filter((x) => x !== c) : allColumns.filter((x) => x === c || columns.includes(x));
    setColumns(next);
    // Remembered per device, written as it changes; a failure only loses the memory.
    if (settings) void api.saveSettings({ ...settings, export_columns: next }).then(() => setSettings({ ...settings, export_columns: next })).catch(() => undefined);
  };

  const run = async () => {
    setError(null);
    const path = await save({ defaultPath: preview?.file_name ?? "LCC_export.xlsx",
                              filters: [{ name: "Excel workbook", extensions: ["xlsx"] }] });
    if (!path) return;
    setBusy(true);
    try {
      const r = await api.exportExcel(scope, path, { columns });
      toast(`Workbook written: ${r.proceedings} proceedings, ${r.demands} demands, ${r.returns} returns, ${r.forms} forms.`);
      onClose();
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  const summary: ExportSummary = kind === "view" && choices.view?.summary ? choices.view.summary
    : kind === "client" && choices.client ? { filter: `Client ${choices.client.name}, every status`, range: "All dates", client: choices.client.name, module: "All modules", status: "Every status" }
    : kind === "view" && choices.view ? { filter: choices.view.label, range: "All dates", client: choices.client?.name ?? "As shown", module: "As shown", status: "As shown" }
    : { filter: "All proceedings, every status", range: "All dates", client: "All clients", module: "All modules", status: "Every status" };
  const total = preview?.total_rows ?? null;

  return (
    <Dialog title="Export current view" onClose={onClose} footer={
      <>
        <span className="meta exp-foot">Every row in the result set is written, not only the page on screen. Rows 1–4 of each sheet say what filter made it. Portal passwords are never exported.</span>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={busy || total === 0 || !columns?.length} onClick={() => { void run(); }}>Export .xlsx</button>
      </>
    }>
      {error ? <div className="banner danger" role="alert">{error}</div> : null}
      <div className="exp-grid">
        <div className="exp-left">
          {!choices.fixedClient || choices.view ? (
            <div className="stack exp-scope" role="radiogroup" aria-label="Scope">
              {choices.view ? (
                <label className="check"><input type="radio" name="scope" checked={kind === "view"} onChange={() => setKind("view")} />
                  Current view</label>
              ) : null}
              {!choices.fixedClient ? (
                <label className="check"><input type="radio" name="scope" checked={kind === "all"} onChange={() => setKind("all")} /> All clients</label>
              ) : null}
              {choices.client ? (
                <label className="check"><input type="radio" name="scope" checked={kind === "client"} onChange={() => setKind("client")} />
                  Only {choices.client.name}</label>
              ) : null}
            </div>
          ) : null}
          <dl className="kv exp-summary">
            <dt>Filter</dt><dd>{summary.filter}</dd>
            <dt>Range</dt><dd>{summary.range}</dd>
            <dt>Client</dt><dd>{summary.client}</dd>
            <dt>Module</dt><dd>{summary.module}</dd>
            <dt>Status</dt><dd>{summary.status}</dd>
            <dt>Rows</dt><dd className="num">{total === null ? "…" : total.toLocaleString("en-IN")}{preview?.unverified ? <span className="muted"> · {preview.unverified} unverified</span> : null}</dd>
            <dt>File</dt><dd className="mono">{preview?.file_name ?? "…"}</dd>
          </dl>
          <fieldset className="exp-columns">
            <legend>Columns <span className="meta">proceedings sheet, in sheet order</span></legend>
            {allColumns.map((c) => (
              <label key={c} className="check">
                <input type="checkbox" checked={columns?.includes(c) ?? false} onChange={() => toggleColumn(c)} />{c}
              </label>
            ))}
          </fieldset>
        </div>
        <div className="exp-right">
          <div className="exp-sheet-title">Sheet preview · Proceedings</div>
          {preview ? (
            <table className="exp-sheet" aria-label="Sheet preview">
              <tbody>
                {preview.header.map((line, i) => (
                  <tr key={`h${i}`}><th className="exp-rowno">{i + 1}</th><td className={i === 0 ? "exp-title" : "exp-meta"} colSpan={Math.max(1, preview.columns.length)}>{line}</td></tr>
                ))}
                <tr><th className="exp-rowno">5</th><td colSpan={Math.max(1, preview.columns.length)} /></tr>
                <tr className="exp-head"><th className="exp-rowno">6</th>{preview.columns.map((c) => <td key={c}>{c}</td>)}</tr>
                {preview.rows.map((r, i) => (
                  <tr key={`r${i}`}><th className="exp-rowno">{7 + i}</th>{r.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                ))}
                {preview.total_rows > preview.rows.length ? (
                  <tr><th className="exp-rowno">…</th><td colSpan={Math.max(1, preview.columns.length)} className="muted">{preview.total_rows - preview.rows.length} more</td></tr>
                ) : null}
              </tbody>
            </table>
          ) : <div className="loading">Loading</div>}
        </div>
      </div>
    </Dialog>
  );
}
