/** Export and import of `.lcc` bundles (tasks 6.6–6.8). Credentials
 *  are off by default; turning them on asks twice and demands a strong
 *  passphrase. Import always previews the manifest before merging. */
import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { api, describeError } from "../lib/api";
import { BUNDLE_EXTENSION } from "../lib/product";
import { invalidate } from "../lib/query";
import { toast } from "../lib/toast";
import type { BundleManifest, ImportSummary } from "../lib/types";
import { stamp } from "../ui/dates";
import { Confirm, Dialog } from "../ui/dialog";
import Field from "../ui/field";

export function ExportBundle({ onClose }: { onClose: () => void }) {
  const [passphrase, setPassphrase] = useState("");
  const [again, setAgain] = useState("");
  const [documents, setDocuments] = useState(true);
  const [credentials, setCredentials] = useState(false);
  const [confirmCreds, setConfirmCreds] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    if (passphrase !== again) { setError("The two passphrases differ."); return; }
    if (credentials) {
      try { await api.checkPassphrase(passphrase); } catch (e) { setError(describeError(e)); return; }
    }
    const path = await save({ defaultPath: `lcc-${new Date().toISOString().slice(0, 10)}.${BUNDLE_EXTENSION}`,
                              filters: [{ name: "LCC bundle", extensions: [BUNDLE_EXTENSION] }] });
    if (!path) return;
    setBusy(true);
    try {
      const s = await api.exportBundle(path, passphrase, credentials, documents);
      toast(`Bundle written: ${s.rows} rows, ${s.documents} documents${s.credentials ? `, ${s.credentials} credentials` : ""}.`);
      invalidate("device");
      onClose();
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title="Export a bundle" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={!passphrase || busy} onClick={() => { void run(); }}>Choose where to save</button>
      </>
    }>
      <p className="muted">The whole book — every synced table and, by default, every document — sealed with AES-256-GCM under a passphrase. Move it by email or USB; import it on the other device.</p>
      {error ? <div className="banner danger">{error}</div> : null}
      <Field label="Passphrase" hint={credentials ? "12+ characters with letters, digits and a symbol" : "anything memorable; the other device needs it"}>
        <input className="input" type="password" autoComplete="new-password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </Field>
      <Field label="Passphrase again">
        <input className="input" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
      </Field>
      <label className="check"><input type="checkbox" checked={documents} onChange={(e) => setDocuments(e.target.checked)} /> Include documents (PDFs)</label>
      <label className="check">
        <input type="checkbox" checked={credentials} onChange={(e) => { if (e.target.checked) setConfirmCreds(true); else setCredentials(false); }} />
        Include portal passwords
      </label>
      {credentials ? <div className="banner warning">This file will contain every stored portal password. Anyone with the file and the passphrase can log in as your clients.</div> : null}
      {confirmCreds ? (
        <Confirm title="Include portal passwords?" danger confirmLabel="Include them"
                 body="The bundle will carry the portal password of every client in the book. Handle the file as you would the passwords themselves: send it only over a channel you trust, and delete it once imported."
                 onConfirm={() => { setCredentials(true); setConfirmCreds(false); }} onClose={() => setConfirmCreds(false)} />
      ) : null}
    </Dialog>
  );
}

export function ImportBundle({ onClose }: { onClose: () => void }) {
  const [path, setPath] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [manifest, setManifest] = useState<BundleManifest | null>(null);
  const [writeCreds, setWriteCreds] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    const chosen = await open({ multiple: false, filters: [{ name: "LCC bundle", extensions: [BUNDLE_EXTENSION] }] });
    if (typeof chosen === "string") { setPath(chosen); setManifest(null); setResult(null); }
  };
  const peek = async () => {
    if (!path) return;
    setBusy(true); setError(null);
    try { setManifest(await api.peekBundle(path, passphrase)); }
    catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };
  const merge = async () => {
    if (!path) return;
    setBusy(true); setError(null);
    try {
      const r = await api.importBundle(path, passphrase, writeCreds);
      setResult(r);
      invalidate("clients"); invalidate("work_items"); invalidate("proceedings"); invalidate("device");
      toast(`Merged: ${r.rows_written} rows written, ${r.rows_kept_local} kept local, ${r.documents_added} documents added.`);
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title="Import a bundle" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>{result ? "Done" : "Cancel"}</button>
        {manifest && !result
          ? <button className="btn accent" disabled={busy} onClick={() => { void merge(); }}>Merge into this book</button>
          : <button className="btn accent" disabled={!path || !passphrase || busy} onClick={() => { void peek(); }}>Read the bundle</button>}
      </>
    }>
      <p className="muted">A merge, never an overwrite: clients match on PAN, the newer version of each row wins, documents are deduplicated by hash, and nothing is deleted for being absent.</p>
      <div className="row">
        <button className="btn" onClick={() => { void pick(); }} disabled={busy}>Choose file</button>
        <span className="meta mono">{path ?? "no file chosen"}</span>
      </div>
      <Field label="Passphrase">
        <input className="input" type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
      </Field>
      {error ? <div className="banner danger">{error}</div> : null}
      {manifest ? (
        <div className="card"><div className="card-body stack">
          <dl className="kv">
            <dt>From device</dt><dd className="mono">{manifest.device_id}</dd>
            <dt>Created</dt><dd className="num">{stamp(manifest.created_at)}</dd>
            <dt>Rows</dt><dd className="num">{Object.values(manifest.counts).reduce((a, b) => a + b, 0)}</dd>
            <dt>Documents</dt><dd>{manifest.includes_documents ? "included" : "not included"}</dd>
            <dt>Passwords</dt><dd>{manifest.includes_credentials ? "included" : "not included"}</dd>
          </dl>
          {manifest.includes_credentials ? (
            <label className="check">
              <input type="checkbox" checked={writeCreds} onChange={(e) => setWriteCreds(e.target.checked)} />
              Store the bundled portal passwords in this device's keychain
            </label>
          ) : null}
        </div></div>
      ) : null}
      {result ? (
        <div className="card"><div className="card-body">
          <dl className="kv">
            <dt>Rows written</dt><dd className="num">{result.rows_written}</dd>
            <dt>Kept local (newer here)</dt><dd className="num">{result.rows_kept_local}</dd>
            <dt>Ledger entries applied</dt><dd className="num">{result.ledger_applied}</dd>
            <dt>Documents added</dt><dd className="num">{result.documents_added} ({result.documents_already_held} already held)</dd>
            <dt>Passwords stored</dt><dd className="num">{result.credentials_written}</dd>
          </dl>
          {result.errors.length ? <div className="banner warning">{result.errors.length} row(s) could not be merged: {result.errors.slice(0, 3).join("; ")}</div> : null}
        </div></div>
      ) : null}
    </Dialog>
  );
}
