/** Proxy URL + firm token.
 *
 * The old web tool had no such screen - its key sat in the server's `.env`.
 * The desktop app holds neither key nor prompt (CLAUDE.md, prime directive 2),
 * only the base URL and a bearer token, and something has to type them in.
 * It is kept off the header so the top bar stays the old one: reach it from
 * the ⌘K palette. See QUESTIONS.md Q13.
 */
import { useEffect, useState } from "react";
import type { Settings } from "../lib/types";

export default function SettingsModal({ show, settings, onSave, onClose }: {
  show: boolean;
  settings: Settings | null;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const [proxyUrl, setProxyUrl] = useState("");
  const [firmToken, setFirmToken] = useState("");

  useEffect(() => {
    if (!show || !settings) return;
    setProxyUrl(settings.proxy_url);
    setFirmToken(settings.firm_token);
  }, [show, settings]);

  return (
    <div className={"modal" + (show ? " show" : "")} role="dialog" aria-modal="true"
         aria-label="Settings"
         onClick={(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div className="sheet" style={{ width: "min(560px, 92vw)", height: "auto" }}>
        <div className="head">
          <strong>Settings</strong>
          <span className="grow" />
          <button className="ghost" onClick={onClose}>Close</button>
        </div>
        <form className="pad" style={{ display: "grid", gap: 12 }}
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!settings) return;
                onSave({ ...settings, proxy_url: proxyUrl.trim(), firm_token: firmToken.trim() });
              }}>
          <p className="mut" style={{ margin: 0 }}>
            Where the firm&rsquo;s proxy lives, and the token that opens it. The
            Anthropic key and the prompts stay on that server &mdash; never here.
          </p>
          <label className="mut" style={{ display: "grid", gap: 5 }}>
            Proxy URL
            <input value={proxyUrl} onChange={(e) => setProxyUrl(e.target.value)}
                   placeholder="https://proxy.example.in" autoComplete="off" />
          </label>
          <label className="mut" style={{ display: "grid", gap: 5 }}>
            Firm token
            <input type="password" value={firmToken} onChange={(e) => setFirmToken(e.target.value)}
                   placeholder="bearer token" autoComplete="off" />
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="primary" type="submit">Save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
