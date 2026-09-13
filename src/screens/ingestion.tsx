/** Screen 5 — Ingestion monitor (docs/09). Current client, queue position,
 *  panel, counts; a prominent challenge card when the run needs a human;
 *  pause and resume. The run never fails while it waits. */
import { useMemo, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useIngestion } from "../hooks/use-ingestion";
import { api } from "../lib/api";
import { JOB_STATUS, panelLabel, plural, runTone } from "../lib/labels";
import { useQuery } from "../lib/query";
import { href } from "../lib/router";
import type { IngestionJob, IngestionRun } from "../lib/types";
import { stamp } from "../ui/dates";
import Field from "../ui/field";
import Icon from "../ui/icons";
import { Page, PageBody, PageHead } from "../ui/page";

function ChallengeCard({ kind, image, onSubmit }: { kind: string; image: string | null; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  const isOtp = kind === "otp";
  const send = () => { if (value) { onSubmit(value); setValue(""); } };
  return (
    <div className="card challenge">
      <div className="card-head"><h2>{isOtp ? "The portal is asking for an OTP" : "The portal is asking for a captcha"}</h2>
        <span className="pill warning">Waiting for you</span></div>
      <div className="card-body stack">
        <p className="muted">The run waits here as long as it takes. Nothing times out and nothing is retried.</p>
        {image ? <img className="captcha" src={`data:image/png;base64,${image}`} alt="Captcha" /> : null}
        <div className="row">
          <input className="input mono" inputMode={isOtp ? "numeric" : "text"} value={value} autoFocus
                 onChange={(e) => setValue(isOtp ? e.target.value.replace(/\D/g, "") : e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                 aria-label={isOtp ? "OTP" : "Captcha text"} />
          <button className="btn accent" disabled={!value} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}

function maskLogin(ref: string): string {
  return ref.length > 9 ? `${ref.slice(0, 5)}••••${ref.slice(9)}` : "•••••";
}

function Jobs({ jobs, clientsById }: { jobs: IngestionJob[]; clientsById: Map<string, string> }) {
  if (!jobs.length) return <div className="card-body muted">No jobs queued.</div>;
  return (
    <table className="table">
      <thead><tr><th className="num">#</th><th>Login</th><th>Client</th><th>Module</th><th>Status</th><th className="num">Attempts</th><th>Note</th></tr></thead>
      <tbody>
        {jobs.map((j) => {
          const st = JOB_STATUS[j.status] ?? { label: j.status, tone: "" };
          return (
            <tr key={j.id}>
              <td className="num">{j.position}</td>
              <td className="mono">{maskLogin(j.login_ref)}</td>
              <td className="wrap">{j.client_id ? (clientsById.get(j.client_id) ?? "—") : <span className="muted">not in the book</span>}</td>
              <td>{j.module}</td>
              <td><span className={`pill ${st.tone}`}>{st.label}</span></td>
              <td className="num">{j.attempts}</td>
              <td className="wrap muted">{j.last_error ?? ""}{j.next_attempt_at ? ` · retry after ${stamp(j.next_attempt_at)}` : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function runNote(r: IngestionRun): string {
  const parts = [r.notes ?? ""];
  try {
    const g = r.gaps ? JSON.parse(r.gaps) as Record<string, unknown> : {};
    if (g.stopped_early) parts.push("stopped early (10 known rows)");
    if (g.missing_panel) parts.push("panel absent");
    const errs = Array.isArray(g.errors) ? g.errors.length : 0;
    if (errs) parts.push(plural(errs, "problem"));
  } catch { /* gaps is free-form */ }
  return parts.filter(Boolean).join(" · ");
}

function Runs({ runs, clientsById }: { runs: IngestionRun[]; clientsById: Map<string, string> }) {
  if (!runs.length) return <div className="card-body muted">No sweep has run on this device yet.</div>;
  return (
    <table className="table">
      <thead><tr><th>When</th><th>Client</th><th>Panel</th><th className="num">Found</th><th>Status</th><th>Note</th></tr></thead>
      <tbody>
        {runs.map((r) => (
          <tr key={r.id}>
            <td>{stamp(r.run_at)}</td>
            <td className="wrap">{r.client_id ? (clientsById.get(r.client_id) ?? "—") : "—"}</td>
            <td>{panelLabel(r.panel_swept)}</td>
            <td className="num">{r.records_found}</td>
            <td><span className={`pill ${runTone(r.status)}`}>{r.status.replace("_", " ")}</span></td>
            <td className="wrap muted">{runNote(r)}</td>
          </tr>
        ))}
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
  const sweepId = s?.sweep_id ?? s?.resumable_sweep_id ?? undefined;
  const jobs = useQuery<IngestionJob[]>(`ingestion:jobs:${sweepId ?? "none"}:${s?.counts.panels_done ?? 0}:${s?.phase ?? ""}`, () => api.ingestionJobs(sweepId));
  const runs = useQuery<IngestionRun[]>(`ingestion:runs:${s?.counts.panels_done ?? 0}:${s?.finished_at ?? ""}`, () => api.ingestionRuns(60));
  const due = useQuery<string[]>(`ingestion:due:${s?.finished_at ?? ""}`, () => api.modulesDue());
  const clientsById = useMemo(() => new Map((clients.data ?? []).map((c) => [c.id, c.name])), [clients.data]);
  const portalClients = useMemo(() => (clients.data ?? []).filter((c) => c.source === "portal"), [clients.data]);

  const phasePill = running
    ? <span className={`pill ${s?.paused || s?.awaiting_operator ? "warning" : "accent"}`}>{s?.paused ? "Paused" : s?.awaiting_operator ? "Waiting for you" : (s?.phase ?? "Running")}</span>
    : <span className="pill">{s?.phase === "done" ? "Last run finished" : s?.phase === "stopped" ? "Stopped" : "Idle"}</span>;

  return (
    <Page>
      <PageHead title="Ingestion" meta={phasePill}>
        {running ? (
          <>
            {s?.paused ? <button className="btn" onClick={() => { void ing.resume(); }}>Resume</button>
              : <button className="btn" onClick={() => { void ing.pause(); }}>Pause</button>}
            <button className="btn danger" onClick={() => { void ing.stop(); }}>Stop after this client</button>
          </>
        ) : null}
      </PageHead>
      <PageBody>
        {!running && s?.resumable_sweep_id ? (
          <div className="banner warning">
            <Icon name="info" />
            <span>A run was interrupted before it finished. Resuming continues at the next panel of the next client; nothing is fetched twice.</span>
            <span className="grow" />
            <button className="btn small" onClick={() => { if (s.resumable_sweep_id) void ing.resumeSweep(s.resumable_sweep_id); }}>Resume</button>
          </div>
        ) : null}
        {s?.last_error ? <div className="banner danger" role="alert"><Icon name="alert" /><span>{s.last_error}</span></div> : null}

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
                  <p className="muted">One login at a time. e-Proceedings sweeps all six panels; demands, returns and forms each sweep their list. A person clears the captcha and OTP; the queue waits. Read-only against the portal.</p>
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
                          {portalClients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </Field>
                    ) : null}
                  </div>
                  <div className="row">
                    {scopeKind === "all" ? (
                      <>
                        <button className="btn accent" disabled={!due.data?.length}
                                title={due.data?.length ? `due: ${due.data.join(", ")}` : "nothing is due by cadence"}
                                onClick={() => { void ing.start({ kind: "all" }); }}>
                          Sweep what is due{due.data?.length ? ` (${due.data.join(", ")})` : ""}
                        </button>
                        <button className="btn" onClick={() => { void ing.start({ kind: "all" }, true); }}>Sweep everything now</button>
                      </>
                    ) : (
                      <button className="btn accent" disabled={!clientId}
                              onClick={() => { void ing.start({ kind: "client", client_id: clientId }, true); }}>Start</button>
                    )}
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
                    <dt>Panel</dt><dd>{panelLabel(s.panel)} <span className="muted num">({s.counts.panels_done} of {s.panel_total || 6} done)</span></dd>
                    <dt>Counts</dt><dd className="num">{s.counts.cards} cards · {s.counts.notices} notices · {s.counts.fetched} fetched · {s.counts.changed} changed · {s.counts.skipped} known</dd>
                    {ing.progress && "card" in ing.progress ? <><dt>Card</dt><dd className="num">{String(ing.progress.card)} of {String(ing.progress.of)} {ing.progress.name ? `· ${String(ing.progress.name)}` : ""}</dd></> : null}
                    {ing.progress && "notice" in ing.progress ? <><dt>Downloading</dt><dd className="num">notice {String(ing.progress.notice)} of {String(ing.progress.of)}</dd></> : null}
                    <dt>Browser pace</dt>
                    <dd>
                      <select className="select" value={pace} aria-label="Browser pace" onChange={(e) => { setPace(e.target.value); void ing.setPace(parseFloat(e.target.value)); }}>
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
          <div className="card-head"><h2>Queue</h2><span className="meta num">{plural(jobs.data?.length ?? 0, "job")}</span></div>
          <Jobs jobs={jobs.data ?? []} clientsById={clientsById} />
        </div>
        <div className="card">
          <div className="card-head"><h2>Sweep history</h2><span className="meta">every panel, zero counts included</span></div>
          <Runs runs={runs.data ?? []} clientsById={clientsById} />
        </div>
      </PageBody>
    </Page>
  );
}
