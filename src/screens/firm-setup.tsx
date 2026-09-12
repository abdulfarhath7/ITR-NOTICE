/** Enrolling this device with a firm on the relay: create, join, or
 *  recover. The recovery code is shown once with a confirm step (7.3). */
import { useState } from "react";
import { api, describeError } from "../lib/api";
import { invalidate } from "../lib/query";
import { toast } from "../lib/toast";
import { Dialog } from "../ui/dialog";
import Field from "../ui/field";

type Mode = "create" | "join" | "recover";

export default function FirmSetup({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<Mode>("create");
  const [relayUrl, setRelayUrl] = useState("https://");
  const [deviceName, setDeviceName] = useState("");
  const [firmName, setFirmName] = useState("");
  const [invite, setInvite] = useState("");
  const [firmId, setFirmId] = useState("");
  const [recovery, setRecovery] = useState("");
  const [firmKey, setFirmKey] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shownCode, setShownCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const run = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === "create") {
        const r = await api.registerFirm(relayUrl, firmName, deviceName, email.trim() || null);
        setShownCode(r.recovery_code);
      } else if (mode === "join") {
        await api.enrolDevice(relayUrl, invite, deviceName, email.trim() || null);
        toast("Enrolled. The book is syncing from the relay.");
        invalidate("sync"); invalidate("clients"); invalidate("work_items"); invalidate("device");
        onClose();
      } else {
        const r = await api.recoverAdmin(relayUrl, firmId, recovery, firmKey, deviceName, email.trim() || null);
        setShownCode(r.recovery_code);
      }
    } catch (e) { setError(describeError(e)); }
    finally { setBusy(false); }
  };

  if (shownCode) {
    return (
      <Dialog title="Your recovery code" onClose={() => { /* must confirm */ }} footer={
        <button className="btn accent" disabled={!saved} onClick={() => { invalidate("sync"); invalidate("device"); onClose(); }}>Done</button>
      }>
        <div className="banner danger">This code is shown once and stored nowhere on this device. It is the only way back into the firm if this laptop is lost.</div>
        <div className="card"><div className="card-body" style={{ textAlign: "center" }}>
          <span className="mono" style={{ fontSize: 18, letterSpacing: 1 }}>{shownCode}</span>
        </div></div>
        <label className="check">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have written this code down somewhere safe.
        </label>
      </Dialog>
    );
  }

  return (
    <Dialog title="Set up sync" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn accent" disabled={busy || !relayUrl.startsWith("http") || !deviceName.trim()
                  || (mode === "create" && !firmName.trim()) || (mode === "join" && !invite.trim())
                  || (mode === "recover" && !(firmId && recovery && firmKey))}
                onClick={() => { void run(); }}>
          {mode === "create" ? "Create firm" : mode === "join" ? "Join" : "Recover"}
        </button>
      </>
    }>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={mode === "create"} onClick={() => setMode("create")}>Create a firm</button>
        <button role="tab" aria-selected={mode === "join"} onClick={() => setMode("join")}>Join with an invite</button>
        <button role="tab" aria-selected={mode === "recover"} onClick={() => setMode("recover")}>Recover admin</button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}
      <Field label="Relay URL" hint="the firm's relay; it stores sealed blobs and cannot read them">
        <input className="input mono" value={relayUrl} onChange={(e) => setRelayUrl(e.target.value)} />
      </Field>
      <Field label="This device's name" hint="as it appears on the roster">
        <input className="input" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder="Partner laptop" />
      </Field>
      <Field label="Your email (optional)" hint="for the alert when the collector misses a run; stored on the relay">
        <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </Field>
      {mode === "create" ? (
        <>
          <Field label="Firm name"><input className="input" value={firmName} onChange={(e) => setFirmName(e.target.value)} /></Field>
          <p className="muted">The first device to activate becomes the firm's admin. There is exactly one admin, always; the role can be transferred.</p>
        </>
      ) : mode === "join" ? (
        <>
          <Field label="Invite" hint="from the admin's Devices screen; carries the firm key, so treat it like a password">
            <textarea className="textarea" rows={3} value={invite} onChange={(e) => setInvite(e.target.value)} />
          </Field>
          <p className="muted">Joining downloads the latest snapshot and replays only what came after it.</p>
        </>
      ) : (
        <>
          <Field label="Firm id"><input className="input mono" value={firmId} onChange={(e) => setFirmId(e.target.value)} /></Field>
          <Field label="Recovery code"><input className="input mono" value={recovery} onChange={(e) => setRecovery(e.target.value.toUpperCase())} /></Field>
          <Field label="Firm key" hint="the third part of any invite, or from a bundle's owner">
            <input className="input mono" value={firmKey} onChange={(e) => setFirmKey(e.target.value)} />
          </Field>
          <p className="muted">This device becomes the admin; the previous admin device becomes a member. A new recovery code is issued.</p>
        </>
      )}
    </Dialog>
  );
}
