/** The sticky top bar, port of `app/static/index.html`'s <header class="top">. */
import type { SpeedMode } from "./types";

const STATE_LABEL: Record<string, string> = {
  idle: "idle", running: "syncing", failed: "failed",
  credentials_required: "needs portal login", otp_required: "waiting for OTP",
  done: "done", disconnected: "disconnected",
};

const SPEEDS: SpeedMode[] = ["slow", "fast", "extreme"];

export interface HeaderProps {
  state: string;
  limit: string;
  onLimit: (value: string) => void;
  speed: SpeedMode;
  onSpeed: (mode: SpeedMode) => void;
  theme: "dark" | "light";
  onTheme: () => void;
  onPalette: () => void;
  onSignOut: () => void;
  onExport: () => void;
  onSync: () => void;
}

export default function Header(p: HeaderProps) {
  const dot = "dot" + (p.state === "running" ? " running" : p.state === "failed" ? " failed" : "");
  return (
    <header className="top">
      <div className="brand"><span className="mark">IT</span> ITR notice tool</div>
      <div className="status"><span className={dot} /><span>{STATE_LABEL[p.state] ?? p.state}</span></div>
      <div className="grow" />

      <label className="mut" htmlFor="limit">Download at most</label>
      <input
        id="limit" type="number" min="1" step="1" placeholder="all" style={{ width: 78 }}
        name="download-limit" autoComplete="off" data-lpignore="true" data-1p-ignore
        aria-label="How many new PDFs to download this run"
        value={p.limit} onChange={(e) => p.onLimit(e.target.value)}
      />

      <div className="speed">
        <div className="seg" role="group" aria-label="Browser speed">
          {SPEEDS.map((mode) => (
            <button key={mode} aria-pressed={p.speed === mode} onClick={() => p.onSpeed(mode)}>
              {mode[0].toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        <span className="seg-note" hidden={p.speed !== "extreme"}>testing only</span>
      </div>

      <button className="ghost icon" onClick={p.onTheme} title="Switch theme"
              aria-label={p.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
        <svg className="i-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
        <svg className="i-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      </button>
      <button className="ghost" onClick={p.onPalette} title="Command palette"><span className="kbd">Ctrl K</span></button>
      <button className="ghost" onClick={p.onSignOut}>Log out</button>
      <button className="ghost" onClick={p.onExport} title="Download the summary as Excel">Export</button>
      <button className="primary accent" onClick={p.onSync}>Sync</button>
    </header>
  );
}
