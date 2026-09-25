/** Screen 5 — Sync (docs/17 §6.1, was Ingestion; docs/09 screen 5). The
 *  head starts or pauses a sweep; the run card says how far tonight's run
 *  has got; the queue table lists every portal client in the frozen order
 *  with its scope, status and cadence. The live session (challenge entry,
 *  viewport, log) sits under the run card and opens while a run is active:
 *  the run never fails while it waits for a person. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useClients } from "../hooks/use-clients";
import { useIngestion } from "../hooks/use-ingestion";
import { useRowNav, type RowNavProps } from "../hooks/use-row-nav";
import { api, describeError, onIngestion } from "../lib/api";
import { MODULES, MODULE_LABEL, panelLabel, plural, runTone } from "../lib/labels";
import { usePersistedFilters } from "../lib/persisted-filters";
import { invalidate, useQuery } from "../lib/query";
import { href, navigate } from "../lib/router";
import {
  elapsedHm, estimateLabel, isFailed, istClock, istStamp, lastSweepShort, leftHm, nextRunLine, nextRunSentence,
  scopeLabel, scopeTone, secondsSince, statusText, weekdayShort, windowLeftSeconds,
} from "../lib/sync-format";
import { toast, toastError } from "../lib/toast";
import type { IngestionRun, IngestionState, Module, SyncOverview, SyncRow } from "../lib/types";
import { stamp } from "../ui/dates";
import EmptyState from "../ui/empty-state";
import Field from "../ui/field";
import Icon from "../ui/icons";
import { Page, PageBody, PageHead } from "../ui/page";

const OVERVIEW_KEY = "sync:overview";

type SyncFilter = "all" | "running" | "failed" | "queued" | "dormant";
interface SyncFilters { status: SyncFilter }
const DEFAULT_FILTERS: SyncFilters = { status: "all" };
const FILTERS: { key: SyncFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "running", label: "Running" }, { key: "failed", label: "Failed" },
  { key: "queued", label: "Queued" }, { key: "dormant", label: "Dormant" },
];

function inFilter(row: SyncRow, f: SyncFilter): boolean {
  switch (f) {
    case "all": return true;
    case "running": return row.status === "running" || row.status === "awaiting";
    case "failed": return isFailed(row);
    case "queued": return row.status === "queued";
    case "dormant": return row.status === "dormant";
  }
}

/** A clock that ticks once a second while something on screen counts up. */
function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!ticking) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

// ------------------------------------------------------------------ live session

function ChallengeCard({ kind, image, onSubmit }: { kind: string; image: string | null; onSubmit: (v: string) => void }) {
  const [value, setValue] = useState("");
  const isOtp = kind === "otp";
  const send = () => { if (value) { onSubmit(value); setValue(""); } };
  return (
    <div className="card challenge">
      <div className="card-head"><h2>{isOtp ? "The portal is asking for an OTP" : "The portal is asking for a captcha"}</h2>
        <span className="pill warning">Awaiting you</span></div>
      <div className="card-body stack">
        <p className="muted">The run waits here as long as it takes. Nothing times out and nothing is retried.</p>
        {image ? <img className="captcha" src={`data:image/png;base64,${image}`} alt="Captcha" /> : null}
        <div className="row">
          <input className="input mono" inputMode={isOtp ? "numeric" : "text"} value={value} autoFocus
                 placeholder={isOtp ? "OTP from the registered phone or email" : "The characters in the image"}
                 onChange={(e) => setValue(isOtp ? e.target.value.replace(/\D/g, "") : e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") send(); }}
                 aria-label={isOtp ? "OTP" : "Captcha text"} />
          <button className="btn accent" disabled={!value} onClick={send}>Send</button>
        </div>
      </div>
    </div>
  );
}

function LiveSession({ ing, open, onToggle }: {
  ing: ReturnType<typeof useIngestion>; open: boolean; onToggle: (open: boolean) => void;
}) {
  const [pace, setPace] = useState("0.4");
  const s = ing.state;
  const running = !!s?.running;
  const waiting = running && s?.awaiting_operator ? s.awaiting_operator : null;
  return (
    <details className="card sync-live" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="card-head">
        <Icon name="chevron-right" className="sync-caret" />
        <h2>Live session</h2>
        {waiting ? <span className="pill warning">Awaiting you</span>
          : running ? <span className="pill accent">{s?.paused ? "Paused" : (s?.phase ?? "Running")}</span>
          : <span className="meta">Nothing running</span>}
      </summary>
      <div className="card-body sync-live-body">
        <div className="stack">
          {waiting ? (
            <ChallengeCard kind={waiting.kind} image={waiting.image_b64}
                           onSubmit={(v) => { void ing.submitChallenge(waiting.kind, v); }} />
          ) : null}
          {running && s ? (
            <dl className="kv">
              <dt>Client</dt><dd>{s.current_client_id
                ? <a href={href({ name: "client", id: s.current_client_id })}>{s.current_client_name ?? s.current_client_id}</a>
                : <span className="muted">Login not in the book</span>} <span className="mono muted">{s.current_login_ref_masked}</span></dd>
              <dt>Queue</dt><dd className="num">{s.queue_position} of {s.queue_total}</dd>
              <dt>Module</dt><dd>{s.module ?? "—"}</dd>
              <dt>Panel</dt><dd>{panelLabel(s.panel)} <span className="muted num">({s.counts.panels_done} of {s.panel_total || 6} done)</span></dd>
              <dt>Phase</dt><dd>{s.phase ?? "—"}</dd>
              <dt>Counts</dt><dd className="num">{s.counts.cards} cards · {s.counts.notices} notices · {s.counts.fetched} fetched · {s.counts.changed} changed · {s.counts.skipped} known{s.counts.indexed ? ` · ${s.counts.indexed} indexed` : ""}</dd>
              {ing.progress && "card" in ing.progress ? <><dt>Card</dt><dd className="num">{String(ing.progress.card)} of {String(ing.progress.of)} {ing.progress.name ? `· ${String(ing.progress.name)}` : ""}</dd></> : null}
              {ing.progress && "notice" in ing.progress ? <><dt>Downloading</dt><dd className="num">notice {String(ing.progress.notice)} of {String(ing.progress.of)}</dd></> : null}
              <dt>Browser pace</dt>
              <dd>
                <select className="select" value={pace} aria-label="Browser pace" onChange={(e) => { setPace(e.target.value); void ing.setPace(parseFloat(e.target.value)); }}>
                  <option value="1">Slow</option><option value="0.4">Normal</option><option value="0.1">Fast</option>
                </select>
              </dd>
            </dl>
          ) : <p className="muted">Nothing running. The current client, panel and any OTP or captcha request appear here during a run.</p>}
          {running ? (
            <div className="row">
              <button className="btn danger" onClick={() => { void ing.stop(); }}>Stop after this client</button>
            </div>
          ) : null}
        </div>
        <div className="stack">
          <div className="frame" aria-label="What the browser is looking at">
            {ing.frame && running ? <img src={`data:image/jpeg;base64,${ing.frame}`} alt="Portal viewport" />
              : <span>{waiting ? "Frames are withheld while a login screen is up." : running ? "Waiting for the first frame." : "The browser appears here during a sweep."}</span>}
          </div>
          <div className="log" role="log" aria-live="polite">
            {ing.log.length ? ing.log.map((l, i) => <div key={i} className={l.level === "error" ? "bad" : l.level === "warn" ? "warn" : ""}>{l.msg}</div>)
              : <span className="muted">The run log appears here.</span>}
          </div>
        </div>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ run card

function Legend({ swept, skipped, failed, deep }: { swept: number; skipped: number; failed: number; deep: number }) {
  return (
    <p className="sync-legend">
      <span><span className="dot success" />Swept {swept}</span>
      <span><span className="dot" />Skipped {skipped} unchanged</span>
      <span><span className="dot danger" />Failed {failed}</span>
      <span><span className="dot accent" />Deep {deep} queued</span>
    </p>
  );
}

function RunCardView({ o, ing, now }: { o: SyncOverview; ing: IngestionState | null; now: number }) {
  const run = o.run;
  if (run) {
    const title = run.scheduled ? "Tonight's run" : "This run";
    const left = run.scheduled ? windowLeftSeconds(run.started_at, o.window_end, now) : null;
    const pct = run.total ? Math.min(100, Math.round((run.done / run.total) * 100)) : 0;
    return (
      <div className="sync-run">
        <div className="sync-run-line">
          <span>
            <strong>{title}</strong> · started {istClock(run.started_at)}
            {run.scheduled ? <> · window ends {o.window_end}</> : null}
            {ing?.paused ? <> · <span className="sync-tone warning">Paused</span></> : null}
          </span>
          <span className="num sync-run-right">
            {run.done} / {run.total} · {elapsedHm(secondsSince(run.started_at, now))} elapsed
            {left !== null ? <> · {leftHm(left)} left</> : null}
          </span>
        </div>
        <div className="sync-bar" role="progressbar" aria-label={`${title} progress`}
             aria-valuemin={0} aria-valuemax={run.total} aria-valuenow={run.done}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <Legend swept={run.swept} skipped={run.skipped} failed={run.failed} deep={o.deep_queued} />
      </div>
    );
  }

  // A deep or item run in flight is not a sweep, so the core sends no run
  // card for it; the runner's own state still says how far it has got.
  if (ing?.running) {
    const what = ing.scope === "deep" ? "Deep fetch" : ing.scope === "item" ? "Item fetch" : "Sweep";
    const pct = ing.queue_total ? Math.min(100, Math.round((ing.queue_position / ing.queue_total) * 100)) : 0;
    return (
      <div className="sync-run">
        <div className="sync-run-line">
          <span><strong>This run</strong> · {what}{ing.current_client_name ? ` · ${ing.current_client_name}` : ""}
            {ing.paused ? <> · <span className="sync-tone warning">Paused</span></> : null}</span>
          <span className="num sync-run-right">{ing.queue_position} / {ing.queue_total}</span>
        </div>
        <div className="sync-bar" role="progressbar" aria-label="This run progress"
             aria-valuemin={0} aria-valuemax={ing.queue_total} aria-valuenow={ing.queue_position}>
          <span style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }

  const last = o.last_summary;
  const sum = last?.summary ?? null;
  const next = nextRunLine(o, now);
  let line: React.ReactNode;
  if (!last) line = <strong>No run yet</strong>;
  else if (sum) {
    line = (
      <span>
        <strong>Last run:</strong> swept {sum.swept}, skipped {sum.skipped_unchanged} unchanged, {sum.failed} failed
        {sum.parked ? `, ${sum.parked} need credentials` : ""}
        {sum.window_closed ? " · window closed" : ""}
      </span>
    );
  } else {
    line = <span title={istStamp(last.finished_at ?? last.started_at)}><strong>Last run</strong> · {last.finished_at ? `finished ${lastSweepShort(last.finished_at, now)}` : `started ${lastSweepShort(last.started_at, now)}`}</span>;
  }
  return (
    <div className="sync-run">
      {sum?.window_closed ? (
        <div className="banner warning" role="status">
          <Icon name="clock" />
          <span>Stopped · window closed. The rest continues {nextRunSentence(o, now)}.</span>
        </div>
      ) : null}
      <div className="sync-run-line">
        {line}
        <span className="sync-run-right">{next}</span>
      </div>
      {sum ? <Legend swept={sum.swept} skipped={sum.skipped_unchanged} failed={sum.failed + sum.parked} deep={o.deep_queued} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ queue table

function NextCell({ row, weekday }: { row: SyncRow; weekday: number }) {
  switch (row.next) {
    case "nightly": return <>Nightly</>;
    case "weekly": return <>Weekly · {weekdayShort(weekday)}</>;
    case "tonight": return <>Tonight</>;
    case "fix":
      return <a className="sync-tone danger" href={href({ name: "client", id: row.client_id, tab: "credentials" })}
                onClick={(e) => e.stopPropagation()}>Fix credentials</a>;
    default: return <span className="muted">—</span>;
  }
}

function QueueRow({ row, nav, now, weekday, busy, selected, onSelect, onSync, onRetry }: {
  row: SyncRow; nav: RowNavProps; now: number; weekday: number; busy: boolean;
  selected: boolean; onSelect: (on: boolean) => void;
  onSync: () => void; onRetry: () => void;
}) {
  const st = statusText(row, now);
  const failed = isFailed(row);
  const stop = (f: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); f(); };
  return (
    <tr className={`row-link sync-row${selected ? " selected" : ""}`} onClick={() => navigate({ name: "client", id: row.client_id })} {...nav}>
      <td className="sync-pick" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} aria-label={`Select ${row.client_name}`}
               onChange={(e) => onSelect(e.target.checked)} />
      </td>
      <td className="sync-client">
        <span className="sync-name">{row.client_name}</span>
        <div className="sub mono">{row.pan_masked}</div>
      </td>
      <td><span className={`pill ${scopeTone(row)}`}>{scopeLabel(row)}</span></td>
      <td className="sync-status-cell"><span className={`sync-tone ${st.tone}`} title={st.text}>{st.text}</span></td>
      <td className="num">{row.changes ?? <span className="muted">—</span>}</td>
      <td title={istStamp(row.last_swept_at)}>{row.last_swept_at ? lastSweepShort(row.last_swept_at, now) : <span className="muted">—</span>}</td>
      <td className="sync-next-cell">
        <span className="sync-next"><NextCell row={row} weekday={weekday} /></span>
        <span className="actions sync-hover">
          {row.next === "fix" ? (
            <a className="btn small" href={href({ name: "client", id: row.client_id, tab: "credentials" })}
               onClick={(e) => e.stopPropagation()}>Fix credentials</a>
          ) : null}
          {failed ? <button className="btn small" disabled={busy} onClick={stop(onRetry)}>Retry</button> : null}
          {row.next !== "fix" ? <button className="btn small" disabled={busy} onClick={stop(onSync)}>Sync now</button> : null}
        </span>
      </td>
    </tr>
  );
}

// ------------------------------------------------------------------ history (kept from the Ingestion screen)

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

function History({ names, finishedAt }: { names: Map<string, string>; finishedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const runs = useQuery<IngestionRun[]>(open ? `ingestion:runs:${finishedAt ?? ""}` : null, () => api.ingestionRuns(60));
  const list = runs.data ?? [];
  return (
    <details className="card sync-history" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="card-head">
        <Icon name="chevron-right" className="sync-caret" />
        <h2>Panel history</h2>
        <span className="meta">every panel of the last 60 runs, zero counts included</span>
      </summary>
      {runs.error ? <div className="banner danger" role="alert">{runs.error}</div>
        : runs.loading && !runs.data ? <div className="loading">Loading</div>
        : !list.length ? <div className="card-body muted">No sweep has run on this device yet.</div>
        : (
          <table className="table">
            <thead><tr><th>When</th><th>Client</th><th>Scope</th><th>Panel</th><th className="num">Found</th><th>Status</th><th>Note</th></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.id}>
                  <td>{stamp(r.run_at)}</td>
                  <td className="wrap">{r.client_id ? (names.get(r.client_id) ?? "—") : "—"}</td>
                  <td>{r.scope === "deep" ? "Deep" : r.scope === "item" ? "Item" : "Sweep"}</td>
                  <td>{panelLabel(r.panel_swept)}</td>
                  <td className="num">{r.records_found}</td>
                  <td><span className={`pill ${runTone(r.status)}`}>{r.status.replace("_", " ")}</span></td>
                  <td className="wrap muted">{runNote(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </details>
  );
}

// ------------------------------------------------------------------ more sweep options (Build 1, kept)

/** The Build 1 start controls: sweep only some modules, one client, or
 *  only what is due by cadence. Collapsed: the head's Sweep all now is the
 *  everyday path. */
function MoreOptions({ ing, finishedAt }: { ing: ReturnType<typeof useIngestion>; finishedAt: string | null }) {
  const [open, setOpen] = useState(false);
  const clients = useClients("");
  const [scopeKind, setScopeKind] = useState<"all" | "client">("all");
  const [clientId, setClientId] = useState("");
  const [picked, setPicked] = useState<Module[]>(MODULES);
  const toggle = (m: Module, on: boolean) =>
    setPicked((cur) => (on ? MODULES.filter((x) => x === m || cur.includes(x)) : cur.filter((x) => x !== m)));
  const only = picked.length === MODULES.length ? undefined : picked;
  const due = useQuery<string[]>(open ? `ingestion:due:${finishedAt ?? ""}` : null, () => api.modulesDue());
  const portalClients = useMemo(() => (clients.data ?? []).filter((c) => c.source === "portal"), [clients.data]);
  const running = !!ing.state?.running;
  const started = () => invalidate(OVERVIEW_KEY);
  return (
    <details className="card sync-more" onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="card-head">
        <Icon name="chevron-right" className="sync-caret" />
        <h2>More sweep options</h2>
        <span className="meta">some modules, one client, or only what is due</span>
      </summary>
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
        <fieldset className="row" aria-label="Modules to sweep">
          {MODULES.map((m) => (
            <label key={m} className="check">
              <input type="checkbox" checked={picked.includes(m)} onChange={(e) => toggle(m, e.target.checked)} /> {MODULE_LABEL[m]}
            </label>
          ))}
        </fieldset>
        <div className="row">
          {scopeKind === "all" ? (
            <>
              <button className="btn accent" disabled={running || !picked.length || !due.data?.some((m) => picked.includes(m as Module))}
                      title={due.data?.length ? `Due: ${due.data.join(", ")}` : "Nothing is due by cadence"}
                      onClick={() => { void ing.start({ kind: "all" }, false, only).then(started); }}>
                Sweep what is due{due.data?.length ? ` (${due.data.join(", ")})` : ""}
              </button>
              <button className="btn" disabled={running || !picked.length} onClick={() => { void ing.start({ kind: "all" }, true, only).then(started); }}>Sweep everything now</button>
            </>
          ) : (
            <button className="btn accent" disabled={running || !clientId || !picked.length}
                    onClick={() => { void ing.start({ kind: "client", client_id: clientId }, true, only).then(started); }}>Start</button>
          )}
          <span className="meta">Last sweep on this device: {stamp(ing.state?.last_run_at)}</span>
        </div>
      </div>
    </details>
  );
}

// ------------------------------------------------------------------ screen

export default function IngestionScreen({ filter }: { filter?: "failed" }) {
  const ing = useIngestion();
  const s = ing.state;
  const q = useQuery<SyncOverview>(OVERVIEW_KEY, () => api.syncOverview());
  const o = q.data;
  const [f, setF] = usePersistedFilters<SyncFilters>("sync", DEFAULT_FILTERS);
  // Attention's Retry and the Updates failure card land here on Failed.
  useEffect(() => { if (filter === "failed") setF({ status: "failed" }); }, [filter, setF]);

  const running = !!s?.running;
  const active = running || !!o?.run;
  const anyRowRunning = !!o?.rows.some((r) => r.status === "running");
  const now = useNow(active || anyRowRunning);

  // Refresh on runner events, at most once a second, and every 5 s while a
  // run is active so counts move even when the sidecar is quiet.
  const throttle = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let dropped = false;
    const bump = () => {
      if (throttle.current) return;
      throttle.current = setTimeout(() => { throttle.current = null; invalidate(OVERVIEW_KEY); }, 1000);
    };
    let p: Promise<(() => void) | undefined>;
    try { p = onIngestion((ev) => { if (ev.ev !== "viewport" && ev.ev !== "log") bump(); }); } catch { p = Promise.resolve(undefined); }
    p.then((u) => { if (dropped) u?.(); else unlisten = u; }).catch(() => { /* no shell: polling still covers it */ });
    return () => { dropped = true; unlisten?.(); if (throttle.current) clearTimeout(throttle.current); throttle.current = null; };
  }, []);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => invalidate(OVERVIEW_KEY), 5000);
    return () => clearInterval(t);
  }, [active]);
  // A run starting or stopping changes the whole card: refetch at once.
  const wasRunning = useRef(running);
  useEffect(() => {
    if (wasRunning.current !== running) invalidate(OVERVIEW_KEY);
    wasRunning.current = running;
  }, [running]);

  // Live session: open while a run is active, the person's toggle wins
  // until the next run starts.
  const [liveOpen, setLiveOpen] = useState(running);
  useEffect(() => { if (running) setLiveOpen(true); }, [running]);
  useEffect(() => { if (s?.awaiting_operator) setLiveOpen(true); }, [s?.awaiting_operator]);

  const [busy, setBusy] = useState<string | null>(null);
  const act = useCallback(async (key: string, f: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try { await f(); toast(done); }
    catch (e) { toastError(describeError(e)); }
    finally { setBusy(null); invalidate(OVERVIEW_KEY); }
  }, []);
  const syncNow = (r: SyncRow) => act(r.client_id, () => api.refreshClient(r.client_id), `Syncing ${r.client_name}.`);
  const retry = (r: SyncRow) => (r.scope === "deep" && r.deep_request_id
    ? act(r.client_id, () => api.retryDeepFetch(r.deep_request_id as string), `Deep fetch for ${r.client_name} queued again.`)
    : act(r.client_id, () => api.refreshClient(r.client_id), `Retrying ${r.client_name}.`));

  const rows = useMemo(() => o?.rows ?? [], [o]);
  const visible = useMemo(() => rows.filter((r) => inFilter(r, f.status)), [rows, f.status]);
  const counts = useMemo(() => {
    const c: Record<SyncFilter, number> = { all: rows.length, running: 0, failed: 0, queued: 0, dormant: 0 };
    for (const r of rows) for (const k of ["running", "failed", "queued", "dormant"] as const) if (inFilter(r, k)) c[k]++;
    return c;
  }, [rows]);
  const names = useMemo(() => new Map(rows.map((r) => [r.client_id, r.client_name])), [rows]);
  const allPaused = rows.length > 0 && rows.every((r) => r.status === "paused");

  const openAt = useCallback((i: number) => {
    const r = visible[i];
    if (r) navigate({ name: "client", id: r.client_id });
  }, [visible]);
  const nav = useRowNav(visible.length, openAt);

  const estimate = o ? estimateLabel(o.estimate_all_s) : "";

  // "Sweep selected": a hand-picked set, kept across filter changes and
  // dropped for clients that leave the book.
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setPicked((p) => {
      const ids = new Set(rows.map((r) => r.client_id));
      const next = new Set([...p].filter((id) => ids.has(id)));
      return next.size === p.size ? p : next;
    });
  }, [rows]);
  const pick = (id: string, on: boolean) => setPicked((p) => {
    const next = new Set(p);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const visibleIds = visible.map((r) => r.client_id);
  const allVisiblePicked = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const pickVisible = (on: boolean) => setPicked((p) => {
    const next = new Set(p);
    for (const id of visibleIds) { if (on) next.add(id); else next.delete(id); }
    return next;
  });
  const pickedKey = [...picked].sort().join(",");
  const [pickedEstimate, setPickedEstimate] = useState<number | null>(null);
  useEffect(() => {
    if (!pickedKey) { setPickedEstimate(null); return; }
    let live = true;
    api.sweepEstimate(pickedKey.split(",")).then((n) => { if (live) setPickedEstimate(n); }).catch(() => { if (live) setPickedEstimate(null); });
    return () => { live = false; };
  }, [pickedKey]);
  const sweepSelected = () => {
    const ids = rows.filter((r) => picked.has(r.client_id)).map((r) => r.client_id);   // frozen order, not click order
    void ing.start({ kind: "clients", client_ids: ids }, true).then(() => { setPicked(new Set()); invalidate(OVERVIEW_KEY); });
  };

  return (
    <Page>
      <PageHead title="Sync" meta={o ? plural(rows.length, "client") : undefined}>
        <button className="btn accent" disabled={running || !rows.length || allPaused}
                title={running ? "A run is in progress" : undefined}
                onClick={() => { void ing.start({ kind: "all" }, true).then(() => invalidate(OVERVIEW_KEY)); }}>
          <Icon name="refresh" /><span>Sweep all now{estimate ? ` · ${estimate}` : ""}</span>
        </button>
        {s?.paused && running ? (
          <button className="btn" onClick={() => { void ing.resume(); }}><Icon name="refresh" /><span>Resume</span></button>
        ) : (
          <button className="btn" disabled={!running} onClick={() => { void ing.pause(); }}><Icon name="pause" /><span>Pause</span></button>
        )}
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

        <div className="card sync-run-card">
          {o ? <RunCardView o={o} ing={s} now={now} />
            : q.error ? <div className="sync-run muted">Run state unavailable</div>
            : <div className="sync-run muted">Loading</div>}
        </div>

        <LiveSession ing={ing} open={liveOpen} onToggle={setLiveOpen} />
        <MoreOptions ing={ing} finishedAt={s?.finished_at ?? null} />

        <div className="toolbar">
          <div className="segmented" role="radiogroup" aria-label="Which clients">
            {FILTERS.map((x) => (
              <button key={x.key} type="button" role="radio" aria-checked={f.status === x.key} onClick={() => setF({ status: x.key })}>
                {x.label}{o && x.key !== "all" && counts[x.key] ? <span className="sync-count">{counts[x.key]}</span> : null}
              </button>
            ))}
          </div>
          <span className="grow" />
          {picked.size ? (
            <>
              <span className="meta">{plural(picked.size, "client")} selected</span>
              <button className="btn small" onClick={() => setPicked(new Set())}>Clear</button>
              <button className="btn small accent" disabled={running} title={running ? "A run is in progress" : undefined}
                      onClick={sweepSelected}>
                Sweep selected{pickedEstimate ? ` · ${estimateLabel(pickedEstimate)}` : ""}
              </button>
            </>
          ) : <span className="meta">↑ ↓ to move · Enter to open</span>}
        </div>

        {allPaused ? (
          <div className="banner" role="status">
            <Icon name="pause" />
            <span><strong>Every client is paused.</strong> Paused clients are skipped by every run. Resume sync from a client's page.</span>
          </div>
        ) : null}

        <div className="att-card sync-card">
          {q.error ? (
            <div className="banner danger" role="alert">
              <Icon name="alert" /><span>Could not load the sync queue: {q.error}</span>
              <span className="grow" />
              <button className="btn small" onClick={() => q.refetch()}>Try again</button>
            </div>
          ) : q.loading && !o ? (
            <div className="loading">Loading</div>
          ) : !rows.length ? (
            <EmptyState title="No clients to sync yet"
                        body="Portal clients appear here once they are added with a login. Each one is swept in the nightly run."
                        action={<a className="btn" href={href({ name: "clients" })}><Icon name="plus" /><span>Add client</span></a>} />
          ) : !visible.length ? (
            <EmptyState title={`No ${FILTERS.find((x) => x.key === f.status)?.label.toLowerCase() ?? ""} clients`}
                        body="Nothing in the queue matches this filter right now."
                        action={<button className="btn" onClick={() => setF({ status: "all" })}>Show all</button>} />
          ) : (
            <table className="table sync-table" onKeyDown={nav.onKeyDown} aria-label="Sync queue">
              <colgroup>
                <col style={{ width: "2.25rem" }} />
                <col style={{ width: "26%" }} /><col style={{ width: "13%" }} /><col style={{ width: "24%" }} />
                <col style={{ width: "8%" }} /><col style={{ width: "11%" }} /><col style={{ width: "18%" }} />
              </colgroup>
              <thead><tr>
                <th className="sync-pick">
                  <input type="checkbox" checked={allVisiblePicked} aria-label="Select every client shown"
                         onChange={(e) => pickVisible(e.target.checked)} />
                </th>
                <th>Client</th><th>Scope</th><th>Status</th><th className="num">Changes</th><th>Last sweep</th><th>Next</th>
              </tr></thead>
              <tbody>
                {visible.map((r, i) => (
                  <QueueRow key={`${r.client_id}:${r.scope}`} row={r} nav={nav.rowProps(i)} now={now} weekday={o?.dormant_weekday ?? 7}
                            busy={busy === r.client_id}
                            selected={picked.has(r.client_id)} onSelect={(on) => pick(r.client_id, on)}
                            onSync={() => { void syncNow(r); }} onRetry={() => { void retry(r); }} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <History names={names} finishedAt={s?.finished_at ?? null} />
      </PageBody>
    </Page>
  );
}
