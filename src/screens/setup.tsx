/** Screen 8 — First-run wizard (task 10.2): firm setup, admin creation,
 *  the recovery code, collector nomination. Every step can be skipped;
 *  the app is fully usable on its own without a relay. */
import { useState } from "react";
import { useRoster } from "../hooks/use-sync";
import { api, describeError } from "../lib/api";
import { PRODUCT_NAME } from "../lib/product";
import { invalidate, useQuery } from "../lib/query";
import { navigate } from "../lib/router";
import { toast, toastError } from "../lib/toast";
import type { SetupState } from "../lib/types";
import FirmSetup from "./firm-setup";

export default function SetupScreen() {
  const state = useQuery<SetupState>("setup:state", () => api.setupState());
  const [showFirm, setShowFirm] = useState(false);
  const roster = useRoster(!!state.data?.relay_configured);
  const s = state.data;
  const admin = roster.data?.you.permission === "admin";
  const me = roster.data?.you.device_id;
  const collectorSet = !!roster.data?.devices.some((d) => d.role === "collector" && !d.removed_at);

  const finish = async (goto: "clients" | "attention") => {
    try { await api.markSetupDone(); invalidate("setup"); navigate({ name: goto }); }
    catch (e) { toastError(describeError(e)); }
  };
  const nominateSelf = async () => {
    if (!me) return;
    try { await api.setCollector(me); toast("This device is the collector."); invalidate("sync"); }
    catch (e) { toastError(describeError(e)); }
  };

  const step = !s ? 0 : !s.relay_configured ? 1 : (admin && !collectorSet) ? 2 : 3;

  return (
    <div className="page">
      <div className="page-head"><h1>Welcome to {PRODUCT_NAME}</h1></div>
      <div className="page-body" style={{ maxWidth: 720 }}>
        <p className="muted">Income tax notices, demands, filed returns and forms for every client of the firm, collected read-only from the portal and kept in one encrypted book on this machine. Nothing is ever invented: a date the portal does not state is shown as not stated.</p>

        <div className="card">
          <div className="card-head"><h2>1 · The firm</h2>{s?.relay_configured ? <span className="pill success">done</span> : <span className="pill">optional</span>}</div>
          <div className="card-body stack">
            <p className="muted">Sync shares the book between the firm's devices through a relay that stores only sealed blobs. The first device to create the firm becomes its admin and is shown a recovery code once. A device can also join with an invite from the admin.</p>
            {s?.relay_configured
              ? <p>Enrolled{s.permission ? ` as ${s.permission}` : ""}.</p>
              : <div className="row"><button className="btn accent" onClick={() => setShowFirm(true)}>Create or join a firm</button><span className="meta">You can do this later from Devices.</span></div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>2 · The collector</h2>{collectorSet ? <span className="pill success">done</span> : step === 2 ? <span className="pill warning">next</span> : <span className="pill">after step 1</span>}</div>
          <div className="card-body stack">
            <p className="muted">One device per firm sweeps the portal for everyone. It is a device setting, not a login: the admin nominates it, and the nomination can move. A sweep needs someone at that machine to clear the portal's captcha and OTP.</p>
            {step === 2 ? <div className="row"><button className="btn accent" onClick={() => { void nominateSelf(); }}>Make this device the collector</button><span className="meta">or nominate another device from Devices</span></div>
              : collectorSet ? <p>Collector nominated.</p>
              : <p className="meta">{s?.relay_configured && !admin ? "Only the admin nominates the collector." : "Available once the firm exists."}</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>3 · Clients and credentials</h2>{s && s.client_count > 0 ? <span className="pill success">{s.client_count} in the book</span> : null}</div>
          <div className="card-body stack">
            <p className="muted">Add clients by hand or import the firm's list from a CSV. Portal passwords go to the operating system's keychain only — never the database, never a log. A client reached through an Authorised Representative login needs no password of its own.</p>
            <div className="row">
              <button className="btn accent" onClick={() => { void finish("clients"); }}>Go to Clients</button>
              <button className="btn" onClick={() => { void finish("attention"); }}>Skip for now</button>
            </div>
          </div>
        </div>
      </div>
      {showFirm ? <FirmSetup onClose={() => { setShowFirm(false); invalidate("setup"); invalidate("sync"); }} /> : null}
    </div>
  );
}
