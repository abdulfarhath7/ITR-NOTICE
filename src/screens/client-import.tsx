/** CSV import with a dry run and a per-row error list (task 3.5). */
import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { api, describeError } from "../lib/api";
import { invalidate } from "../lib/query";
import { toast } from "../lib/toast";
import type { ImportPreview } from "../lib/types";
import { Dialog } from "../ui/dialog";

export default function ClientImport({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const chosen = await open({ multiple: false, filters: [{ name: "CSV", extensions: ["csv"] }] });
    if (typeof chosen !== "string") return;
    setPath(chosen); setPreview(null); setError(null); setBusy(true);
    try { setPreview(await api.importClientsCsv(chosen, true)); }
    catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  const commit = async () => {
    if (!path) return;
    setBusy(true); setError(null);
    try {
      const result = await api.importClientsCsv(path, false);
      invalidate("clients");
      toast(`${result.written} client${result.written === 1 ? "" : "s"} imported.`);
      onClose();
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title="Import clients from CSV" onClose={onClose} wide footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={!preview || !preview.ok.length || busy} onClick={() => { void commit(); }}>
          {preview ? `Import ${preview.ok.length} row${preview.ok.length === 1 ? "" : "s"}` : "Import"}
        </button>
      </>
    }>
      <p className="muted">
        Columns by header: name, pan or gstin (one is enough), client_code, entity_type, client_group,
        phone_cc, phone, email, portal_login_ref, source, client_file_no, tags. Nothing is written until
        you confirm; rows with a problem are listed and skipped.
      </p>
      <div className="row">
        <button className="btn" onClick={() => { void pick(); }} disabled={busy}>Choose file</button>
        <span className="meta mono">{path ?? "no file chosen"}</span>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}
      {preview ? (
        <>
          <div className="row meta">
            <span><b className="num">{preview.ok.length}</b> ready</span>
            <span><b className="num">{preview.errors.length}</b> with problems</span>
          </div>
          {preview.errors.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th className="num">Line</th><th>Name</th><th>Problem</th></tr></thead>
                <tbody>
                  {preview.errors.map((e) => (
                    <tr key={e.line}><td className="num">{e.line}</td><td className="wrap">{e.name ?? <span className="muted">—</span>}</td><td className="wrap">{e.reason}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {preview.ok.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th className="num">Line</th><th>Name</th><th>PAN</th><th>Code</th><th>Type</th><th>Source</th></tr></thead>
                <tbody>
                  {preview.ok.map((r) => (
                    <tr key={r.line}>
                      <td className="num">{r.line}</td>
                      <td className="wrap">{r.client.name}</td>
                      <td className="mono">{r.pan_masked}{r.derived_from_gstin ? <span className="sub">from GSTIN</span> : null}</td>
                      <td className="mono">{r.client.client_code ?? ""}</td>
                      <td>{r.client.entity_type}</td>
                      <td>{r.client.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </>
      ) : null}
    </Dialog>
  );
}
