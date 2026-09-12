/** Screen 7 — Settings. Cadence, data folder and firm arrive with the
 *  phases that need them; the proxy URL and firm token are live now. */
import { useEffect, useState } from "react";
import { api, describeError } from "../lib/api";
import { PRODUCT_NAME } from "../lib/product";
import { invalidate, useQuery } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { Cadence, Cadences, Settings } from "../lib/types";
import Field from "../ui/field";

const CADENCES: { key: Cadence; label: string }[] = [
  { key: "daily", label: "Daily" }, { key: "weekly", label: "Weekly" }, { key: "monthly", label: "Monthly" }, { key: "manual", label: "Manual only" },
];
const MODULE_LABEL: Record<keyof Cadences, string> = {
  proceedings: "e-Proceedings", demands: "Outstanding demands", returns: "e-Returns filed", forms: "e-Forms filed",
};

function CadenceCard() {
  const q = useQuery<Cadences>("cadence", () => api.sweepCadence());
  const [draft, setDraft] = useState<Cadences | null>(null);
  const value = draft ?? q.data;
  const save = async () => {
    if (!draft) return;
    try { await api.setSweepCadence(draft); invalidate("cadence"); setDraft(null); toast("Cadence saved."); }
    catch (e) { toastError(describeError(e)); }
  };
  return (
    <div className="card">
      <div className="card-head"><h2>Sweep cadence</h2><span className="meta">per module (Q12)</span></div>
      <div className="card-body stack">
        <p className="muted">"Sweep what is due" on the Ingestion screen runs the modules whose cadence has elapsed since their last successful sweep on this device.</p>
        {value ? (Object.keys(MODULE_LABEL) as (keyof Cadences)[]).map((m) => (
          <Field key={m} label={MODULE_LABEL[m]}>
            <select className="select" value={value[m]} onChange={(e) => setDraft({ ...(value), [m]: e.target.value as Cadence })}>
              {CADENCES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </Field>
        )) : <span className="muted">Loading</span>}
        <div className="row"><button className="btn accent" disabled={!draft} onClick={() => { void save(); }}>Save</button></div>
      </div>
    </div>
  );
}

export default function SettingsScreen({ theme, onTheme }: { theme: "dark" | "light"; onTheme: (t: "dark" | "light") => void }) {
  const q = useQuery<Settings>("settings", () => api.settings());
  const [proxyUrl, setProxyUrl] = useState("");
  const [firmToken, setFirmToken] = useState("");
  useEffect(() => { if (q.data) { setProxyUrl(q.data.proxy_url); setFirmToken(q.data.firm_token); } }, [q.data]);

  const save = async () => {
    if (!q.data) return;
    try {
      await api.saveSettings({ ...q.data, proxy_url: proxyUrl.trim(), firm_token: firmToken.trim() });
      invalidate("settings");
      toast("Settings saved.");
    } catch (e) { toastError(describeError(e)); }
  };

  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="page-body">
        <div className="grid-2">
          <div className="card">
            <div className="card-head"><h2>Drafting proxy</h2></div>
            <div className="card-body stack">
              <p className="muted">The proxy holds the AI key. This app holds only its address and the firm's bearer token, in the OS keychain.</p>
              <Field label="Proxy URL"><input className="input mono" value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)} /></Field>
              <Field label="Firm token"><input className="input mono" type="password" autoComplete="off" value={firmToken} onChange={(e) => setFirmToken(e.target.value)} /></Field>
              <div className="row"><button className="btn accent" onClick={() => { void save(); }}>Save</button></div>
            </div>
          </div>
          <CadenceCard />
          <div className="card">
            <div className="card-head"><h2>Appearance</h2></div>
            <div className="card-body stack">
              <Field label="Theme">
                <select className="select" value={theme} onChange={(e) => onTheme(e.target.value as "dark" | "light")}>
                  <option value="dark">Dark</option><option value="light">Light</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h2>About</h2></div>
            <div className="card-body stack">
              <p>{PRODUCT_NAME} — income tax notice, demand and compliance tracking for a CA firm.</p>
              <p className="muted">Read-only against the portal. Nothing is ever invented: a missing date shows as missing.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
