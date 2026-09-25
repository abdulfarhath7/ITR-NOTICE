/** Add or edit a client (task 3.2). Typing a GSTIN derives PAN and state;
 *  both stay editable. */
import { useEffect, useState } from "react";
import { api, describeError } from "../lib/api";
import { invalidate } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { ClientDetail, ClientInput } from "../lib/types";
import { Dialog } from "../ui/dialog";
import Field from "../ui/field";

const ENTITY_TYPES = ["individual", "company", "firm", "huf", "trust", "aop", "other"];
const ENTITY_LABEL: Record<string, string> = {
  individual: "Individual", company: "Company", firm: "Firm", huf: "HUF", trust: "Trust", aop: "AOP", other: "Other",
};

function blank(): ClientInput {
  return { name: "", pan: "", gstin: "", client_code: "", entity_type: "", client_group: "",
           phone_cc: "+91", phone: "", email: "", portal_login_ref: "", source: "portal",
           client_file_no: "", tags: "" };
}

export default function ClientForm({ existing, onClose, onSaved }: {
  existing: ClientDetail | null;
  onClose: () => void;
  onSaved: (c: ClientDetail) => void;
}) {
  const [form, setForm] = useState<ClientInput>(() => existing ? {
    name: existing.name, pan: existing.pan, gstin: existing.gstin ?? "", client_code: existing.client_code ?? "",
    entity_type: existing.entity_type, client_group: existing.client_group ?? "", phone_cc: existing.phone_cc,
    phone: existing.phone ?? "", email: existing.email ?? "", portal_login_ref: existing.portal_login_ref ?? "",
    source: existing.source, client_file_no: existing.client_file_no ?? "", tags: existing.tags ?? "",
  } : blank());
  const [state, setState] = useState("");
  const [gstinNote, setGstinNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fetchHistory, setFetchHistory] = useState(false);
  // Add only. Goes straight to the OS keychain after the client exists;
  // it is never part of the client record.
  const [password, setPassword] = useState("");
  const set = (k: keyof ClientInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

  // Derive as the GSTIN is typed; the derived fields stay editable.
  useEffect(() => {
    const g = (form.gstin ?? "").trim();
    if (g.length !== 15) { setGstinNote(null); return; }
    let live = true;
    api.deriveFromGstin(g).then((d) => {
      if (!live) return;
      setForm((f) => ({ ...f, pan: f.pan?.trim() ? f.pan : d.pan }));
      setState(d.state_name ? `${d.state_name} (${d.state_code})` : `state code ${d.state_code}`);
      setGstinNote(`PAN ${d.pan} derived from characters 3 to 12`);
    }).catch((e) => { if (live) { setGstinNote(describeError(e)); setState(""); } });
    return () => { live = false; };
  }, [form.gstin]);

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const saved = existing ? await api.updateClient(existing.id, form) : await api.createClient({ ...form, fetch_history_tonight: fetchHistory });
      let stored = false;
      if (!existing && password && (form.source ?? "portal") === "portal") {
        try {
          await api.setClientCredential(saved.id, password);
          stored = true;
        } catch (e) {
          toastError(`Client added, but the password was not stored: ${describeError(e)}. Set it from the client's Profile.`);
        }
        setPassword("");            // never leave it in the DOM
      }
      invalidate("clients");
      invalidate("work_items");
      toast(existing ? "Client updated." : stored ? "Client added. Password stored in the OS keychain." : "Client added.");
      onSaved(stored ? await api.client(saved.id) : saved);
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  return (
    <Dialog title={existing ? "Edit client" : "Add client"} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" onClick={() => { void submit(); }} disabled={busy}>{existing ? "Save" : "Add"}</button>
      </>
    }>
      {error ? <div className="banner danger">{error}</div> : null}
      <div className="form-grid">
        <Field label="GSTIN" hint={gstinNote ?? "15 characters; PAN and state derive from it"}>
          <input className="input mono" value={form.gstin ?? ""} maxLength={15} autoCapitalize="characters"
                 onChange={(e) => set("gstin", e.target.value.toUpperCase())} />
        </Field>
        <Field label="State" hint="from the first two GSTIN characters; editable">
          <input className="input" value={state} onChange={(e) => setState(e.target.value)} />
        </Field>
        <Field label="PAN" hint="5 letters, 4 digits, 1 letter">
          <input className="input mono" value={form.pan} maxLength={10} required
                 onChange={(e) => set("pan", e.target.value.toUpperCase())} />
        </Field>
        <Field label="Legal name">
          <input className="input" value={form.name} required onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Client code" hint="the firm's own reference; unique">
          <input className="input mono" value={form.client_code ?? ""} onChange={(e) => set("client_code", e.target.value)} />
        </Field>
        <Field label="Entity type" hint="derived from the PAN's fourth letter when blank">
          <select className="select" value={form.entity_type ?? ""} onChange={(e) => set("entity_type", e.target.value)}>
            <option value="">From PAN</option>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{ENTITY_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Group">
          <input className="input" value={form.client_group ?? ""} onChange={(e) => set("client_group", e.target.value)} />
        </Field>
        <Field label="Source" hint="per client, not global; mixed books are expected">
          <select className="select" value={form.source ?? "portal"} onChange={(e) => set("source", e.target.value)}>
            <option value="portal">Portal (scraper)</option>
            <option value="eri">ERI API</option>
          </select>
        </Field>
        <Field label="Phone">
          <div className="row">
            <input className="input cc" value={form.phone_cc ?? "+91"} onChange={(e) => set("phone_cc", e.target.value)} aria-label="Country code" />
            <input className="input grow" value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} aria-label="Phone number" />
          </div>
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label="Reached through login" hint="blank = the client's own credentials; else the PAN of the AR login that shows this client">
          <input className="input mono" value={form.portal_login_ref ?? ""} maxLength={10}
                 onChange={(e) => set("portal_login_ref", e.target.value.toUpperCase())} />
        </Field>
        <Field label="Client file no.">
          <input className="input" value={form.client_file_no ?? ""} onChange={(e) => set("client_file_no", e.target.value)} />
        </Field>
        <Field label="Tags" hint="comma separated" wide>
          <input className="input" value={form.tags ?? ""} onChange={(e) => set("tags", e.target.value)} />
        </Field>
        {!existing && (form.source ?? "portal") === "portal" ? (
          <Field label="Portal password" wide
                 hint={form.portal_login_ref?.trim()
                   ? `for the login ${form.portal_login_ref.trim()}; stored in the OS keychain, never in the database`
                   : "optional; stored in the OS keychain, never in the database"}>
            <input className="input" type="password" autoComplete="new-password" value={password}
                   onChange={(e) => setPassword(e.target.value)} />
          </Field>
        ) : null}
        {!existing ? (
          <div className="field wide client-add-history">
            <label className="check">
              <input type="checkbox" checked={fetchHistory} onChange={(e) => setFetchHistory(e.target.checked)} />
              Also fetch full history tonight
            </label>
            <span className="hint">Index only; documents download when you open an item</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}
