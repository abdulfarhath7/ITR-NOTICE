import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Settings } from "../lib/types";

// ------------------------------------------------------------- Connect

interface ConnectProps {
  open: boolean;
  phase: "idle" | "connecting" | "otp" | "done";
  initialUserId: string;
  log: string[];
  error: string;
  onLogin: (userId: string, password: string | null, remember: boolean) => void;
  onOtp: (code: string) => void;
  onClose: () => void;
}

const SPEEDS: { label: string; seconds: number }[] = [
  { label: "Slow", seconds: 1.0 }, { label: "Fast", seconds: 0.4 }, { label: "Extreme", seconds: 0.05 },
];

export function ConnectModal(p: ConnectProps) {
  const [userId, setUserId] = useState(p.initialUserId);
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [saved, setSaved] = useState(false);
  const [otp, setOtp] = useState("");
  const [speed, setSpeed] = useState(0.4);

  useEffect(() => { setUserId(p.initialUserId); }, [p.initialUserId]);
  useEffect(() => {
    if (!userId.trim()) { setSaved(false); return; }
    api.hasSavedPassword(userId).then(setSaved).catch(() => setSaved(false));
  }, [userId, p.open]);

  if (!p.open) return null;

  const canLogin = userId.trim().length > 0 && (password.length > 0 || saved);

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="connect-title">
      <div className="modal">
        {p.phase === "otp" ? (
          <>
            <h3 id="connect-title">Enter the OTP</h3>
            <p className="note">The portal sent a one-time code to the registered mobile and email. Type it here; it goes straight into the live login.</p>
            <div className="field">
              <input className="otp" inputMode="numeric" autoFocus value={otp} maxLength={8}
                     onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                     onKeyDown={(e) => { if (e.key === "Enter" && otp.length >= 4) p.onOtp(otp); }}
                     aria-label="One-time password" />
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" disabled={otp.length < 4} onClick={() => p.onOtp(otp)}>Continue</button>
            </div>
          </>
        ) : (
          <>
            <h3 id="connect-title">Connect to the e-filing portal</h3>
            <div className="field">
              <label htmlFor="uid">User ID (PAN)</label>
              <input id="uid" value={userId} autoFocus autoCapitalize="characters"
                     onChange={(e) => setUserId(e.target.value.toUpperCase())} disabled={p.phase === "connecting"} />
            </div>
            <div className="field">
              <label htmlFor="pw">Password{saved ? " — saved on this PC, leave blank to use it" : ""}</label>
              <input id="pw" type="password" value={password} autoComplete="current-password"
                     onChange={(e) => setPassword(e.target.value)} disabled={p.phase === "connecting"}
                     onKeyDown={(e) => { if (e.key === "Enter" && canLogin) p.onLogin(userId, password || null, remember); }} />
            </div>
            <label className="check">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} disabled={p.phase === "connecting"} />
              Remember the password in Windows Credential Manager
            </label>
            {saved && (
              <button className="btn btn-quiet" style={{ justifySelf: "start" }}
                      onClick={() => api.forgetPassword(userId).then(() => setSaved(false))}>
                Forget saved password
              </button>
            )}
            <div className="btn-row">
              <button className="btn btn-primary" disabled={!canLogin || p.phase === "connecting"}
                      onClick={() => p.onLogin(userId, password || null, remember)}>
                {p.phase === "connecting" ? "Logging in…" : "Log in"}
              </button>
              <button className="btn" onClick={p.onClose}>Cancel</button>
              <span className="spacer" style={{ flex: 1 }} />
              <div className="speed" role="group" aria-label="Browser pace">
                {SPEEDS.map((s) => (
                  <button key={s.label} className="btn" aria-pressed={speed === s.seconds}
                          onClick={() => { setSpeed(s.seconds); api.speed(s.seconds); }}>{s.label}</button>
                ))}
              </div>
            </div>
          </>
        )}
        {p.error && <p className="err">{p.error}</p>}
        {p.log.length > 0 && <div className="log" aria-live="polite">{p.log.slice(-60).join("\n")}</div>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Settings

interface SettingsProps {
  open: boolean;
  settings: Settings | null;
  onSave: (s: Settings) => void;
  onClose: () => void;
}

export function SettingsModal(p: SettingsProps) {
  const [s, setS] = useState<Settings | null>(p.settings);
  useEffect(() => setS(p.settings), [p.settings, p.open]);
  if (!p.open || !s) return null;

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal">
        <h3 id="settings-title">Settings</h3>
        <div className="field">
          <label htmlFor="proxy">Drafting service address</label>
          <input id="proxy" value={s.proxy_url} onChange={(e) => setS({ ...s, proxy_url: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="tok">Firm token</label>
          <input id="tok" type="password" value={s.firm_token} onChange={(e) => setS({ ...s, firm_token: e.target.value })} />
        </div>
        <p className="note">The token lives in Windows Credential Manager. Notices are stored encrypted on this PC; only the notice you ask about is sent to the drafting service, and nothing is kept there.</p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={() => p.onSave(s)}>Save</button>
          <button className="btn" onClick={p.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
