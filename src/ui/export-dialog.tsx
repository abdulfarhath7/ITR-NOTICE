/** Excel export with the scope selector (docs/11): the current filtered
 *  view, all clients, or one client — with the row count shown before the
 *  user commits. */
import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, describeError } from "../lib/api";
import { exportFileName } from "../lib/export-name";
import { toast } from "../lib/toast";
import type { ExportScope } from "../lib/types";
import { Dialog } from "./dialog";

export interface ExportChoices {
  /** The rows the screen is showing, when it has a filtered view. */
  view?: { items: [string, string][]; label: string; sheet?: string } | null;
  /** The client on screen, when there is one. */
  client?: { id: string; name: string } | null;
}

export default function ExportDialog({ choices, onClose }: { choices: ExportChoices; onClose: () => void }) {
  const initial: ExportScope["kind"] = choices.view ? "view" : choices.client ? "client" : "all";
  const [kind, setKind] = useState<ExportScope["kind"]>(initial);
  const [counts, setCounts] = useState<[string, number][] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope = (): ExportScope => {
    if (kind === "view" && choices.view) return { kind: "view", items: choices.view.items, label: choices.view.label };
    if (kind === "client" && choices.client) return { kind: "client", client_id: choices.client.id };
    return { kind: "all" };
  };

  useEffect(() => {
    let live = true;
    api.exportPreview(scope()).then((c) => { if (live) setCounts(c); }).catch(() => { if (live) setCounts(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  const run = async () => {
    setError(null);
    const sheet = kind === "view" ? (choices.view?.sheet ?? "View") : kind === "client" ? (choices.client?.name ?? "Client") : "All";
    const path = await save({ defaultPath: exportFileName(sheet),
                              filters: [{ name: "Excel workbook", extensions: ["xlsx"] }] });
    if (!path) return;
    setBusy(true);
    try {
      const r = await api.exportExcel(scope(), path);
      toast(`Workbook written: ${r.proceedings} proceedings, ${r.demands} demands, ${r.returns} returns, ${r.forms} forms.`);
      onClose();
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  const total = counts?.reduce((n, [, c]) => n + c, 0) ?? null;

  return (
    <Dialog title="Export to Excel" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={busy || total === 0} onClick={() => { void run(); }}>
          Export{total !== null ? ` ${total.toLocaleString("en-IN")} row${total === 1 ? "" : "s"}` : ""}
        </button>
      </>
    }>
      <p className="muted">One workbook, one sheet per module. The proceedings sheet is the firm's 16-column format. Every status is exported; a field the portal did not state is an empty cell. Rows 1–3 stamp when and from what state it was made.</p>
      {error ? <div className="banner danger">{error}</div> : null}
      <div className="stack">
        {choices.view ? (
          <label className="check"><input type="radio" name="scope" checked={kind === "view"} onChange={() => setKind("view")} />
            Current view — {choices.view.label}</label>
        ) : null}
        <label className="check"><input type="radio" name="scope" checked={kind === "all"} onChange={() => setKind("all")} /> All clients</label>
        {choices.client ? (
          <label className="check"><input type="radio" name="scope" checked={kind === "client"} onChange={() => setKind("client")} />
            Only {choices.client.name}</label>
        ) : null}
      </div>
      {counts ? (
        <div className="row meta">
          {counts.map(([m, n]) => <span key={m}><b className="num">{n.toLocaleString("en-IN")}</b> {m}</span>)}
        </div>
      ) : null}
    </Dialog>
  );
}
