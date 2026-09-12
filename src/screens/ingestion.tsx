/** Screen 5 — Ingestion monitor. Until Phase 4 this drives the single
 *  account flow: log in, clear the OTP, sweep e-Proceedings. The queue,
 *  per-client locks and the six-panel sweep replace it there. */
import { useEffect, useState } from "react";
import { usePortalSession } from "../hooks/use-portal-session";
import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import type { Settings } from "../lib/types";
import Field from "../ui/field";

const SPEEDS: { key: string; label: string; seconds: number }[] = [
  { key: "slow", label: "Slow", seconds: 1.0 }, { key: "fast", label: "Fast", seconds: 0.25 }, { key: "extreme", label: "Extreme", seconds: 0 },
];

const STATE_LABEL: Record<string, { text: string; tone: string }> = {
  credentials_required: { text: "Not connected", tone: "" },
  otp_required: { text: "Waiting for OTP", tone: "warning" },
  running: { text: "Running", tone: "accent" },
  done: { text: "Finished", tone: "success" },
  failed: { text: "Failed", tone: "danger" },
  disconnected: { text: "Session ended", tone: "" },
};

function lineTone(line: string): string {
  const l = line.toLowerCase();
  if (l.startsWith("error") || l.startsWith("!") || l.includes("failed") || l.includes("could not")) return "bad";
  if (l.includes("logged in") || l.startsWith("sync done") || l.includes("downloaded")) return "good";
  if (l.includes("otp") || l.includes("skipped")) return "warn";
  return "";
}

export default function IngestionScreen() {
  const s = usePortalSession();
  const settings = useQuery<Settings>("settings", () => api.settings());
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [hasSaved, setHasSaved] = useState(false);
  const [otp, setOtp] = useState("");
  const [limit, setLimit] = useState("");
  const [speed, setSpeed] = useState("fast");

  useEffect(() => {
    if (!settings.data) return;
    setUserId(settings.data.last_user_id);
    setRemember(settings.data.remember_password);
  }, [settings.data]);
  useEffect(() => {
    const id = userId.trim();
    if (id.length !== 10) { setHasSaved(false); return; }
    api.hasSavedPassword(id).then(setHasSaved).catch(() => setHasSaved(false));
  }, [userId]);

  const connect = async () => {
    const pw = password || null;
    setPassword("");                         // never leave the password in the DOM
    await s.login(userId.trim(), pw, remember);
  };
  const startSync = async () => {
    const lim = parseInt(limit, 10);
    await s.speed(SPEEDS.find((x) => x.key === speed)?.seconds ?? 0.25);
    await s.sync(Number.isFinite(lim) && lim > 0 ? lim : null);
  };

  const label = STATE_LABEL[s.state] ?? { text: s.state, tone: "" };
  const prog = s.progress;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ingestion</h1>
        <span className={`pill ${label.tone}`}>{label.text}</span>
        {s.loggedIn ? <button className="btn" onClick={() => { void s.stop(); }}>Log out</button> : null}
      </div>
      <div className="page-body">
        <div className="banner">
          Single-account mode. The queue across the client book, per-client locks and the six-panel sweep
          arrive with the ingestion service. Nothing here writes to the portal.
        </div>

        <div className="grid-2">
          <div className="stack">
            {!s.loggedIn ? (
              <div className="card">
                <div className="card-head"><h2>Portal login</h2></div>
                <div className="card-body stack">
                  {s.error ? <div className="banner danger">{s.error}</div> : null}
                  <Field label="User ID (PAN)">
                    <input className="input mono" value={userId} maxLength={10} autoCapitalize="characters"
                           onChange={(e) => setUserId(e.target.value.toUpperCase())} />
                  </Field>
                  <Field label="Password" hint={hasSaved ? "a password is stored in the keychain; leave blank to use it" : "kept in memory for the run; stored only if you ask"}>
                    <input className="input" type="password" autoComplete="current-password" value={password}
                           onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                  <label className="check">
                    <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    Remember on this PC (OS keychain)
                  </label>
                  <div className="row">
                    <button className="btn accent" disabled={userId.trim().length !== 10 || (!password && !hasSaved) || s.state === "running"}
                            onClick={() => { void connect(); }}>Connect</button>
                    {hasSaved ? <button className="btn quiet" onClick={() => { void api.forgetPassword(userId.trim()).then(() => setHasSaved(false)); }}>Forget stored password</button> : null}
                  </div>
                </div>
              </div>
            ) : null}

            {s.state === "otp_required" ? (
              <div className="card">
                <div className="card-head"><h2>The portal is asking for an OTP</h2></div>
                <div className="card-body stack">
                  <p className="muted">The run waits here as long as it takes. Type the code from the SMS or email.</p>
                  <div className="row">
                    <input className="input mono" inputMode="numeric" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} aria-label="OTP" />
                    <button className="btn accent" disabled={otp.length < 4} onClick={() => { void s.otp(otp); setOtp(""); }}>Send</button>
                  </div>
                </div>
              </div>
            ) : null}

            {s.loggedIn ? (
              <div className="card">
                <div className="card-head"><h2>Sweep e-Proceedings</h2></div>
                <div className="card-body stack">
                  <div className="row">
                    <Field label="Stop after N new PDFs" hint="blank = every notice">
                      <input className="input" type="number" min={1} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 120 }} />
                    </Field>
                    <Field label="Browser pace">
                      <select className="select" value={speed} onChange={(e) => { setSpeed(e.target.value); void s.speed(SPEEDS.find((x) => x.key === e.target.value)?.seconds ?? 0.25); }}>
                        {SPEEDS.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="row">
                    <button className="btn accent" disabled={s.state === "running" && !!prog && prog.kind !== "done"} onClick={() => { void startSync(); }}>Sync now</button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="card-head"><h2>Progress</h2>{s.loginPhase ? <span className="meta">login: {s.loginPhase}</span> : null}</div>
              <div className="card-body">
                {prog ? (
                  <dl className="kv">
                    <dt>Stage</dt><dd>{String(prog.kind)}</dd>
                    {"tab" in prog ? <><dt>Panel</dt><dd>{String(prog.tab)} · {String(prog.sub_tab ?? "")}</dd></> : null}
                    {"card" in prog ? <><dt>Card</dt><dd className="num">{String(prog.card)} of {String(prog.of)}</dd></> : null}
                    {"name" in prog && prog.name ? <><dt>Proceeding</dt><dd>{String(prog.name)}</dd></> : null}
                    {"notice" in prog ? <><dt>Notice</dt><dd className="num">{String(prog.notice)} of {String(prog.of)}</dd></> : null}
                    {"downloaded" in prog ? <><dt>Downloaded</dt><dd className="num">{String(prog.downloaded)}</dd></> : null}
                    {"notices" in prog ? <><dt>Notices seen</dt><dd className="num">{String(prog.notices)}</dd></> : null}
                    {"new_notices" in prog ? <><dt>New</dt><dd className="num">{String(prog.new_notices)}</dd></> : null}
                    {"skipped_cached" in prog ? <><dt>Already held</dt><dd className="num">{String(prog.skipped_cached)}</dd></> : null}
                  </dl>
                ) : <span className="muted">Nothing running.</span>}
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="frame" aria-label="What the browser is looking at">
              {s.frame ? <img src={`data:image/jpeg;base64,${s.frame}`} alt="Portal viewport" />
                : <span>{s.state === "otp_required" ? "Paused — OTP on screen; frames withheld during login." : s.loggedIn ? "Waiting for the first frame." : "The browser appears here once connected."}</span>}
            </div>
            <div className="log" role="log" aria-live="polite">
              {s.log.map((line, i) => <div key={i} className={lineTone(line)}>{line}</div>)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
