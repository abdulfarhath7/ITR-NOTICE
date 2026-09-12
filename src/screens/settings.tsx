/** Screen 7 — Settings. Cadence, data folder and firm arrive with the
 *  phases that need them; the proxy URL and firm token are live now. */
import { useEffect, useState } from "react";
import { api, describeError } from "../lib/api";
import { PRODUCT_NAME } from "../lib/product";
import { invalidate, useQuery } from "../lib/query";
import { toast, toastError } from "../lib/toast";
import type { Cadence, Cadences, DataDirInfo, Settings, SweepSchedule } from "../lib/types";

const DAY_LABEL = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function ScheduleCard() {
  const q = useQuery<SweepSchedule>("schedule", () => api.sweepSchedule());
  const [draft, setDraft] = useState<SweepSchedule | null>(null);
  const value = draft ?? q.data;
  const save = async () => {
    if (!draft) return;
    try { await api.setSweepSchedule(draft); invalidate("schedule"); setDraft(null); toast("Schedule saved."); }
    catch (e) { toastError(describeError(e)); }
  };
  if (!value) return null;
  return (
    <div className="card">
      <div className="card-head"><h2>Unattended sweep</h2>{value.enabled ? <span className="pill success">on</span> : <span className="pill">off</span>}</div>
      <div className="card-body stack">
        <p className="muted">At this time (IST) on these days the collector starts a sweep by itself. If the portal asks for an OTP or a captcha, the run pauses and the app alerts — it never fails for want of a person. Under a relay only the nominated collector runs it.</p>
        <label className="check"><input type="checkbox" checked={value.enabled} onChange={(e) => setDraft({ ...value, enabled: e.target.checked })} /> Enabled</label>
        <div className="row">
          <Field label="Time (IST)"><input className="input mono" type="time" value={value.time} onChange={(e) => setDraft({ ...value, time: e.target.value })} /></Field>
          <Field label="Sweep">
            <select className="select" value={value.scope} onChange={(e) => setDraft({ ...value, scope: e.target.value as "due" | "all" })}>
              <option value="due">What is due by cadence</option><option value="all">Every module</option>
            </select>
          </Field>
        </div>
        <div className="row">
          {DAY_LABEL.map((d, i) => (
            <label key={d} className="check">
              <input type="checkbox" checked={value.days.includes(i + 1)}
                     onChange={(e) => setDraft({ ...value, days: e.target.checked ? [...value.days, i + 1].sort() : value.days.filter((x) => x !== i + 1) })} />
              {d}
            </label>
          ))}
        </div>
        <div className="row"><button className="btn accent" disabled={!draft} onClick={() => { void save(); }}>Save</button></div>
      </div>
    </div>
  );
}
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

function DataCard() {
  const q = useQuery<DataDirInfo>("settings:datadir", () => api.dataDir());
  return (
    <div className="card">
      <div className="card-head"><h2>Data and workers</h2></div>
      <div className="card-body stack">
        <dl className="kv">
          <dt>Data folder</dt>
          <dd>
            <span className="mono" style={{ overflowWrap: "anywhere" }}>{q.data?.path ?? "…"}</span>
            <div className="row" style={{ marginTop: 6 }}>
              <button className="btn small" onClick={() => { void api.openDataDir().catch((e) => toastError(describeError(e))); }}>Open folder</button>
              <span className="meta">archive {q.data ? `${Math.round(q.data.archive_bytes / 1048576)} MB` : ""}, SQLCipher-encrypted; its key is in the OS keychain</span>
            </div>
          </dd>
          <dt>Workers</dt>
          <dd>1 <span className="muted">— the portal allows one live session per taxpayer and a second login evicts the first, so the sweep is strictly sequential (D-002).</span></dd>
        </dl>
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
          <ScheduleCard />
          <DataCard />
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
