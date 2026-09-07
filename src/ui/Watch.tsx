/** The two live panels: what the bot sees, and what it is doing.
 *  Port of `.watch` in `app/static/index.html`. */
import { Fragment, useEffect, useRef } from "react";
import type { LoginPhase, StageCounts, SyncStage } from "./types";

/* -------------------------------------------------------------- pipeline */

const STAGES: { key: SyncStage; label: string }[] = [
  { key: "login", label: "Login" },
  { key: "list", label: "Open list" },
  { key: "walk", label: "Walk proceedings" },
  { key: "download", label: "Download PDFs" },
  { key: "done", label: "Done" },
];

/** The sidecar sends raw counts; this is what a person would say out loud.
 *  Anything unrecognised still shows, as "key value", rather than vanishing. */
function countText(stage: SyncStage | null, c: StageCounts): string {
  const has = (k: string) => c[k] !== null && c[k] !== undefined && c[k] !== "";
  const parts: string[] = [];
  // Deliberately terse: the step is the headline, the log underneath carries
  // the detail.
  if (stage === "download" && has("notice") && has("of")) {
    parts.push(`${c.notice}/${c.of}`);
  } else if (stage === "walk") {
    if (has("card") && has("of")) parts.push(`${c.card}/${c.of}`);
    else if (has("items")) parts.push(`${c.items}`);
  } else if (stage === "done") {
    if (has("notices")) parts.push(`${c.notices} notices`);
    if (has("downloaded")) parts.push(`${c.downloaded} new`);
  }
  if (parts.length) return parts.join(" · ");
  return Object.entries(c)
    .filter(([, v]) => v !== null && v !== undefined && v !== "" && v !== false)
    .map(([k, v]) => `${k} ${v}`).join(" · ");
}

function Pipeline({ stage, counts }: { stage: SyncStage | null; counts: StageCounts }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  return (
    <div className="pad pipe">
      {STAGES.map((s, i) => {
        const cls = at < 0 ? "" : i < at ? "done" : i === at ? "active" : "";
        const text = i === at ? countText(stage, counts) : "";
        // the separator is the step's sibling, exactly as the old markup had it
        return (
          <Fragment key={s.key}>
            <span className={`step ${cls}`}>
              <span className="bead">{cls === "done" ? "✓" : i + 1}</span>
              {s.label}
              {text ? <> <span className="count">{text}</span></> : null}
            </span>
            {i < STAGES.length - 1 ? <span className="sep" /> : null}
          </Fragment>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- viewport */

/** No frame is sent while credentials or an OTP are on screen, and that rule
 *  is not being relaxed. The card shows the phase instead of sitting dark. */
const LOGIN_PHASES: { key: LoginPhase; text: string }[] = [
  { key: "opening", text: "Opening portal…" },
  { key: "credentials", text: "Entering credentials…" },
  { key: "force_login", text: "Another session found — taking over…" },
  { key: "otp", text: "Waiting for you — enter the OTP above" },
  { key: "done", text: "Logged in ✓" },
];

function LoginStage({ phase, waiting }: { phase: LoginPhase; waiting: boolean }) {
  const spec = LOGIN_PHASES.find((p) => p.key === phase);
  // steps, not an endless spinner: one bar per phase, filled up to this one
  const steps = LOGIN_PHASES.filter((p) => p.key !== "otp" || phase === "otp");
  const here = steps.findIndex((p) => p.key === phase);
  const tone = phase === "otp" ? " otp" : phase === "done" ? " done" : phase === "failed" ? " failed" : "";
  const text = phase === "failed" ? "Login failed — see log"
    : waiting ? "Waiting for the first frame…"
    : spec ? spec.text : "Signing in…";

  return (
    <div className={"loginstage" + tone}>
      <svg className="lock" width="34" height="34" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
           strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path className="shackle" d="M8 10V7a4 4 0 0 1 8 0v3" />
        <circle cx="12" cy="15.5" r="1.4" />
      </svg>
      <p className="phase">{text}</p>
      <div className="dots" aria-hidden="true">
        {steps.map((p, i) => (
          <i key={p.key} className={i < here ? "done on" : i === here ? "on" : ""} />
        ))}
      </div>
    </div>
  );
}

export interface WatchProps {
  open: boolean;
  onOpen: (open: boolean) => void;
  hint: string;
  /** While this is set the stage takes the card, frame or no frame: no shot is
   *  taken during login, and a stale one must not sit under a phase caption. */
  loginPhase: LoginPhase | null;
  phaseWaiting: boolean;
  /** base64 JPEG from the sidecar's `viewport` event. */
  frame: string | null;
  /** A recording light that is always on is not a recording light: this is true
   *  only while frames are actually arriving, so the last frame of a finished
   *  run stays on screen under a dark REC. */
  live: boolean;
  stage: SyncStage | null;
  counts: StageCounts;
  caption: string;
  log: string[];
}

export default function Watch(p: WatchProps) {
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [p.log]);

  return (
    <div className="watch">
      <details className={"card monitor" + (p.live ? " live" : "")} id="monitor"
               open={p.open} onToggle={(e) => p.onOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span className="rec"><i />REC</span>
          <strong style={{ fontSize: 13 }}>Live viewport</strong>
          <span className="mut">{p.hint}</span>
        </summary>
        <div className="screen">
          {p.loginPhase
            ? <LoginStage phase={p.loginPhase} waiting={p.phaseWaiting} />
            : p.frame
              // keyed on the frame so each one mounts fresh and fades in
              ? <img key={p.frame.length + p.frame.slice(0, 24)} className="in"
                     src={`data:image/jpeg;base64,${p.frame}`}
                     alt="What the bot is looking at right now" />
              : <span className="mut">No frames yet.</span>}
        </div>
        <div className="caption">{p.caption}</div>
      </details>

      <div className="card runlog">
        <Pipeline stage={p.stage} counts={p.counts} />
        <div id="log" ref={logRef}>{p.log.join("\n")}</div>
      </div>
    </div>
  );
}
