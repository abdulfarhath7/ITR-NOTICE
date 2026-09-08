/** The two cards that block a run: the portal login and the OTP.
 *  Port of `#creds` and `#otp` in `app/static/index.html`. */
import { useEffect, useRef, useState } from "react";

export interface CredsGateProps {
  show: boolean;
  error: string;
  userId: string;
  remember: boolean;
  onRemember: (on: boolean) => void;
  onSubmit: (userId: string, password: string) => void;
}

export function CredsGate(p: CredsGateProps) {
  const [userId, setUserId] = useState(p.userId);
  const [password, setPassword] = useState("");
  const uid = useRef<HTMLInputElement>(null);

  useEffect(() => { setUserId(p.userId); }, [p.userId]);
  useEffect(() => { if (p.show) uid.current?.focus(); }, [p.show]);

  return (
    <div className={"card gate pad" + (p.show ? " show" : "")}>
      <p className="err">{p.error}</p>
      <div className="gatehead">
        <span className="eyebrow">Access</span>
        <strong>Portal login</strong>
      </div>
      <p className="mut" style={{ margin: "6px 0 12px" }}>
        Held in the OS keychain only when you ask for it &mdash; never written beside
        the archive. Without &ldquo;remember&rdquo;, closing the app asks again.
      </p>
      <form
        className="filters" style={{ padding: 0 }}
        onSubmit={(ev) => {
          ev.preventDefault();               // stay on the page, post it ourselves
          p.onSubmit(userId.trim(), password);
          setPassword("");                   // never leave the password in the DOM
        }}
      >
        <input ref={uid} name="username" placeholder="PAN / AADHAAR / OTHER USER ID"
               autoComplete="username" aria-label="Portal user ID" style={{ width: 270 }}
               value={userId} onChange={(e) => setUserId(e.target.value)} />
        <input name="password" type="password" placeholder="Portal password"
               autoComplete="current-password" aria-label="Portal password" style={{ width: 200 }}
               value={password} onChange={(e) => setPassword(e.target.value)} />
        <label>
          <input type="checkbox" checked={p.remember}
                 onChange={(e) => p.onRemember(e.target.checked)} /> Remember on this PC
        </label>
        <button className="primary" type="submit">Save &amp; sync</button>
      </form>
    </div>
  );
}

export interface OtpGateProps {
  show: boolean;
  onSend: (code: string) => void;
  onBadCode: () => void;
}

export function OtpGate(p: OtpGateProps) {
  const [code, setCode] = useState("");
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { if (p.show) box.current?.focus(); }, [p.show]);

  const send = () => {
    const trimmed = code.trim();
    if (!/^\d{4,8}$/.test(trimmed)) { p.onBadCode(); return; }
    p.onSend(trimmed);
    setCode("");
  };

  return (
    <div className={"card gate pad" + (p.show ? " show" : "")}>
      <div className="gatehead">
        <span className="eyebrow">Verify</span>
        <strong>Portal is asking for an OTP</strong>
      </div>
      <div className="filters" style={{ padding: "8px 0 0" }}>
        <input ref={box} inputMode="numeric" maxLength={6} placeholder="6 digits"
               aria-label="One time password" style={{ width: 130, letterSpacing: "3px" }}
               value={code} onChange={(e) => setCode(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter") send(); }} />
        <button className="primary" onClick={send}>Send to portal</button>
      </div>
    </div>
  );
}
