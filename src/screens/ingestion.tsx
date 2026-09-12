/** Screen 5 — Ingestion monitor (docs/09). Current client, queue position,
 *  panel, counts; a prominent challenge card when the run needs a human;
 *  pause and resume. The run never fails while it waits. */
import { useState } from "react";
import { useIngestion } from "../hooks/use-ingestion";
import { useClients } from "../hooks/use-clients";
import { api } from "../lib/api";
import { useQuery } from "../lib/query";
import { href } from "../lib/router";
import type { IngestionJob, IngestionRun } from "../lib/types";
import { stamp } from "../ui/dates";
import Field from "../ui/field";

const PANEL_LABEL: Record<string, string> = {
  "self:action": "Self · for your action", "self:information": "Self · for your information",
  "other_pan:action": "Other PAN/TAN · for your action", "other_pan:information": "Other PAN/TAN · for your information",
  "auth_rep:action": "As AR · for your action", "auth_rep:information": "As AR · for your information",
};

const JOB_PILL: Record<string, string> = {
  queued: "", running: "accent", awaiting_operator: "warning", done: "success", incomplete: "warning",
  failed: "danger", parked: "danger", cancelled: "",
};
const JOB_LABEL: Record<string, string> = {
  queued: "Queued", running: "Running", awaiting_operator: "Waiting for you", done: "Done",
  incomplete: "Incomplete", failed: "Failed", parked: "Credentials need attention", cancelled: "Cancelled",
};

function ChallengeCard({ kind, image, onSubmit }: { kind: string; image: string | null; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  const isOtp = kind === "otp";
  return (
    <div className="card" style={{ borderColor: "var(--warning)" }}>
      <div className="card-head"><h2>{isOtp ? "The portal is asking for an OTP" : "The portal is asking for a captcha"}</h2>
        <span className="pill warning">Waiting for you</span></div>
      <div className="card-body stack">
        <p className="muted">The run waits here as long as it takes. Nothing times out and nothing is retried.</p>
        {image ? <img src={`data:image/png;base64,${image}`} alt="Captcha" style={{ maxWidth: 320, borderRadius: 6 }} /> : null}
        <div className="row">
          <input className="input mono" inputMode={isOtp ? "numeric" : "text"} value={value} autoFocus
                 onChange={(e) => setValue(isOtp ? e.target.value.replace(/\D/g, "") : e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && value) { onSubmit(value); setValue(""); } }}
                 aria-label={isOtp ? "OTP" : "Captcha text"} />
          <button className="btn accent" disabled={!value} onClick={() => { onSubmit(value); setValue(""); }}>Send</button>
        </div>
      </div>
    </div>
  );
}

function Jobs({ jobs, clientsById }: { jobs: IngestionJob[]; clientsById: Record<string, string> }) {
  if (!jobs.length) return <div className="card-body muted">No jobs queued.</div>;
  return (
    <table className="table">
      <thead><tr><th className="num">#</th><th>Login</th><th>Client</th><th>Module</th><th>Status</th><th className="num">Attempts</th><th>Note</th></tr></thead>
      <tbody>
        {jobs.map((j) => (
          <tr key={j.id}>
            <td className="num">{j.position}</td>
            <td className="mono">{j.login_ref.slice(0, 5)}••••{j.login_ref.slice(9)}</td>
            <td className="wrap">{j.client_id ? (clientsById[j.client_id] ?? "—") : <span className="muted">not in the book</span>}</td>
            <td>{j.module}</td>
            <td><span className={`pill ${JOB_PILL[j.status] ?? ""}`}>{JOB_LABEL[j.status] ?? j.status}</span></td>
            <td className="num">{j.attempts}</td>
            <td className="wrap muted">{j.last_error ?? ""}{j.next_attempt_at ? ` · retry after ${stamp(j.next_attempt_at)}` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Runs({ runs, clientsById }: { runs: IngestionRun[]; clientsById: Record<string, string> }) {
  if (!runs.length) return <div className="card-body muted">No sweep has run on this device yet.</div>;
  return (
    <table className="table">
      <thead><tr><th>When</th><th>Client</th><th>Panel</th><th className="num">Found</th><th>Status</th><th>Note</th></tr></thead>
      <tbody>
        {runs.map((r) => {
          let note = r.notes ?? "";
          try {
            const g = r.gaps ? JSON.parse(r.gaps) as Record<string, unknown> : {};
            if (g.stopped_early) note = `${note ? note + " · " : ""}stopped early (10 known rows)`;
            if (g.missing_panel) note = `${note ? note + " · " : ""}panel absent`;
            const errs = Array.isArray(g.errors) ? g.errors.length : 0;
            if (errs) note = `${note ? note + " · " : ""}${errs} problem${errs === 1 ? "" : "s"}`;
          } catch { /* gaps is free-form */ }
          return (
            <tr key={r.id}>
              <td className="num">{stamp(r.run_at)}</td>
              <td className="wrap">{r.client_id ? (clientsById[r.client_id] ?? "—") : "—"}</td>
              <td>{r.panel_swept ? (PANEL_LABEL[r.panel_swept] ?? r.panel_swept) : "—"}</td>
              <td className="num">{r.records_found}</td>
              <td><span className={`pill ${r.status === "ok" ? "success" : r.status === "failed" || r.status === "credentials_parked" ? "danger" : "warning"}`}>{r.status.replace("_", " ")}</span></td>
              <td className="wrap muted">{note}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default function IngestionScreen() {
  const ing = useIngestion();
  const clients = useClients("");
  const [scopeKind, setScopeKind] = useState<"all" | "client">("all");
  const [clientId, setClientId] = useState("");
  const [pace, setPace] = useState("0.4");
  const s = ing.state;
  const running = !!s?.running;
  const jobsKey = `ingestion:jobs:${s?.sweep_id ?? s?.resumable_sweep_id ?? "none"}:${s?.counts.panels_done ?? 0}:${s?.phase ?? ""}`;
  const jobs = useQuery<IngestionJob[]>(jobsKey, () => api.ingestionJobs(s?.sweep_id ?? s?.resumable_sweep_id ?? undefined));
  const runs = useQuery<IngestionRun[]>(`ingestion:runs:${s?.counts.panels_done ?? 0}:${s?.finished_at ?? ""}`, () => api.ingestionRuns(60));
  const clientsById = Object.fromEntries((clients.data ?? []).map((c) => [c.id, c.name]));

  return (
    <div className="page">
      <div className="page-head">
        <h1>Ingestion</h1>
        {running
          ? <span className={`pill ${s?.paused ? "warning" : s?.awaiting_operator ? "warning" : "accent"}`}>
              {s?.paused ? "Paused" : s?.awaiting_operator ? "Waiting for you" : (s?.phase ?? "Running")}</span>
          : <span className="pill">{s?.phase === "done" ? "Last run finished" : s?.phase === "stopped" ? "Stopped" : "Idle"}</span>}
        {running ? (
          <>
            {s?.paused ? <button className="btn" onClick={() => { void ing.resume(); }}>Resume</button>
              : <button className="btn" onClick={() => { void ing.pause(); }}>Pause</button>}
            <button className="btn danger" onClick={() => { void ing.stop(); }}>Stop after this client</button>
          </>
        ) : null}
      </div>
      <div className="page-body">
        {!running && s?.resumable_sweep_id ? (
          <div className="banner warning">
            <span>A run was interrupted before it finished. Resuming continues at the next panel of the next client; nothing is fetched twice.</span>
            <button className="btn small" onClick={() => { if (s.resumable_sweep_id) void ing.resumeSweep(s.resumable_sweep_id); }}>Resume</button>
          </div>
        ) : null}
        {s?.last_error ? <div className="banner danger">{s.last_error}</div> : null}

        <div className="grid-2">
          <div className="stack">
            {s?.awaiting_operator && running
              ? <ChallengeCard kind={s.awaiting_operator.kind} image={s.awaiting_operator.image_b64}
                               onSubmit={(v) => { if (s.awaiting_operator) void ing.submitChallenge(s.awaiting_operator.kind, v); }} />
              : null}

            {!running ? (
              <div className="card">
                <div className="card-head"><h2>Start a sweep</h2></div>
                <div className="card-body stack">
                  <p className="muted">One login at a time, e-Proceedings, all six panels. A human clears the captcha and OTP; the queue waits. Read-only against the portal.</p>
                  <div className="row">
                    <Field label="Scope">
                      <select className="select" value={scopeKind} onChange={(e) => setScopeKind(e.target.value as "all" | "client")}>
                        <option value="all">Every portal-source client</option>
                        <option value="client">One client</option>
                      </select>
                    </Field>
                    {scopeKind === "client" ? (
                      <Field label="Client">
                        <select className="select" value={clientId} onChange={(e) => setClientId(e.target.value)}>
                          <option value="">Choose</option>
                          {(clients.data ?? []).filter((c) => c.source === "portal").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </Field>
                    ) : null}
                  </div>
                  <div className="row">
                    <button className="btn accent" disabled={scopeKind === "client" && !clientId}
                            onClick={() => { void ing.start(scopeKind === "all" ? { kind: "all" } : { kind: "client", client_id: clientId }); }}>
                      Start
                    </button>
                    <span className="meta">Last sweep on this device: {stamp(s?.last_run_at)}</span>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="card">
              <div className="card-head"><h2>Now</h2>{s?.phase ? <span className="meta">{s.phase}</span> : null}</div>
              <div className="card-body">
                {running && s ? (
                  <dl className="kv">
                    <dt>Client</dt><dd>{s.current_client_id
                      ? <a href={href({ name: "client", id: s.current_client_id })}>{s.current_client_name ?? s.current_client_id}</a>
                      : <span className="muted">login not in the book</span>} <span className="mono muted">{s.current_login_ref_masked}</span></dd>
                    <dt>Queue</dt><dd className="num">{s.queue_position} of {s.queue_total}</dd>
                    <dt>Module</dt><dd>{s.module ?? "—"}</dd>
                    <dt>Panel</dt><dd>{s.panel ? (PANEL_LABEL[s.panel] ?? s.panel) : <span className="muted">—</span>} <span className="muted num">({s.counts.panels_done} of 6 done)</span></dd>
                    <dt>Counts</dt><dd className="num">{s.counts.cards} cards · {s.counts.notices} notices · {s.counts.fetched} fetched · {s.counts.changed} changed · {s.counts.skipped} known</dd>
                    {ing.progress && "card" in ing.progress ? <><dt>Card</dt><dd className="num">{String(ing.progress.card)} of {String(ing.progress.of)} {ing.progress.name ? `· ${String(ing.progress.name)}` : ""}</dd></> : null}
                    {ing.progress && "notice" in ing.progress ? <><dt>Downloading</dt><dd className="num">notice {String(ing.progress.notice)} of {String(ing.progress.of)}</dd></> : null}
                    <dt>Browser pace</dt>
                    <dd>
                      <select className="select" value={pace} onChange={(e) => { setPace(e.target.value); void ing.setPace(parseFloat(e.target.value)); }}>
                        <option value="1">Slow</option><option value="0.4">Normal</option><option value="0.1">Fast</option>
                      </select>
                    </dd>
                  </dl>
                ) : <span className="muted">Nothing running.</span>}
              </div>
            </div>
          </div>

          <div className="stack">
            <div className="frame" aria-label="What the browser is looking at">
              {ing.frame && running ? <img src={`data:image/jpeg;base64,${ing.frame}`} alt="Portal viewport" />
                : <span>{s?.awaiting_operator ? "Frames are withheld while a login screen is up." : running ? "Waiting for the first frame." : "The browser appears here during a sweep."}</span>}
            </div>
            <div className="log" role="log" aria-live="polite">
              {ing.log.length ? ing.log.map((l, i) => <div key={i} className={l.level === "error" ? "bad" : l.level === "warn" ? "warn" : ""}>{l.msg}</div>)
                : <span className="muted">The run log appears here.</span>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h2>Queue</h2><span className="meta num">{jobs.data?.length ?? 0} jobs</span></div>
          <Jobs jobs={jobs.data ?? []} clientsById={clientsById} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Sweep history</h2><span className="meta">every panel, zero counts included</span></div>
          <Runs runs={runs.data ?? []} clientsById={clientsById} />
        </div>
      </div>
    </div>
  );
}
