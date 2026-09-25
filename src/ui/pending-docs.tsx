/** Documents indexed but not fetched yet (docs/17 §6.4, §3). The row
 *  marker is an icon only, never a text badge, so a row keeps its height;
 *  the banner on a work item offers the item fetch. */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeError, onIngestion } from "../lib/api";
import { invalidate } from "../lib/query";
import type { IngestionState, Module } from "../lib/types";
import Icon from "./icons";

const LABEL = "Documents not fetched yet";

/** Reads the count off any row that may carry it (the core sends
 *  `pending_documents` on work item rows); a row without it reads as
 *  nothing pending. */
export function pendingOf(row: object): number {
  const v = (row as { pending_documents?: unknown }).pending_documents;
  return typeof v === "number" ? v : 0;
}

/** The outline cloud after a section pill. Renders nothing when every
 *  document is stored. */
export default function PendingDocs({ count }: { count: number | null | undefined }) {
  if (!count) return null;
  return (
    <span className="pending-docs" role="img" title={LABEL} aria-label={LABEL}>
      <Icon name="cloud-down" width={14} height={14} />
    </span>
  );
}

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "busy" }
  | { kind: "queued" }
  | { kind: "running"; since: number }
  | { kind: "failed"; message: string };

function progressLine(st: IngestionState | null): string {
  if (!st || st.scope !== "item") return "Fetching";
  const where = st.panel ?? st.phase;
  return ["Fetching", where, `${st.counts.fetched} fetched`].filter(Boolean).join(" · ");
}

/** "Documents not fetched yet · Fetch" under a work item's header, with the
 *  inline progress of the item fetch once started. With `auto_item_fetch`
 *  on it starts once when the screen opens, unless a run already holds
 *  the session, when it offers the queue instead. */
export function PendingBanner({ module, id, pending }: { module: Module; id: string; pending: number }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [state, setState] = useState<IngestionState | null>(null);
  const autoTried = useRef(false);
  const sawRunning = useRef(false);

  const reload = useCallback(() => {
    invalidate(`${module}:${id}`);
    invalidate("work_items");
  }, [module, id]);

  const fetchNow = useCallback(async (queueIfBusy: boolean) => {
    setPhase({ kind: "starting" });
    try {
      const r = await api.fetchItem(module, id, queueIfBusy);
      sawRunning.current = false;
      if (r.status === "started") setPhase({ kind: "running", since: Date.now() });
      else if (r.status === "queued") setPhase({ kind: "queued" });
      else setPhase({ kind: "busy" });
    } catch (e) {
      setPhase({ kind: "failed", message: describeError(e) });
    }
  }, [module, id]);

  // Auto item fetch: once per opening of the screen, only when something
  // is pending, and never on top of a run that holds the login.
  useEffect(() => {
    if (!pending || autoTried.current) return;
    autoTried.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const s = await api.sweepSettings();
        if (cancelled || !s.auto_item_fetch) return;
        const st = await api.ingestionState();
        if (cancelled) return;
        if (st.running) { setPhase({ kind: "busy" }); return; }
        await fetchNow(false);
      } catch { /* the banner's own Fetch still works */ }
    })();
    return () => { cancelled = true; };
  }, [pending, fetchNow]);

  // While our fetch runs: follow item-scope events, poll as a fallback,
  // and reload the item when the run is over.
  const running = phase.kind === "running";
  const since = phase.kind === "running" ? phase.since : 0;
  useEffect(() => {
    if (!running) return;
    let dropped = false;
    const check = async () => {
      try {
        const st = await api.ingestionState();
        if (dropped) return;
        setState(st);
        if (st.running) { sawRunning.current = true; return; }
        // The core may not report the run for a moment after starting it.
        if (!sawRunning.current && Date.now() - since < 8000) return;
        reload();
        setPhase(st.last_error && st.scope === "item" ? { kind: "failed", message: st.last_error } : { kind: "idle" });
      } catch { /* next tick */ }
    };
    void check();
    const poll = setInterval(() => { void check(); }, 2500);
    let unlisten: (() => void) | undefined;
    onIngestion((ev) => { if (ev.scope === "item" || ev.ev === "state") void check(); })
      .then((u) => { if (dropped) u(); else unlisten = u; })
      .catch(() => { /* polling covers it */ });
    return () => { dropped = true; clearInterval(poll); unlisten?.(); };
  }, [running, since, reload]);

  if (!pending && phase.kind !== "running" && phase.kind !== "queued") return null;

  return (
    <div className="banner pending-banner" role="status">
      <Icon name="cloud-down" />
      {phase.kind === "running" || phase.kind === "starting" ? (
        <span className="num">{phase.kind === "starting" ? "Fetching" : progressLine(state)}</span>
      ) : phase.kind === "queued" ? (
        <span>Queued after the sweep</span>
      ) : phase.kind === "busy" ? (
        <span>
          A sweep is using this login ·{" "}
          <button type="button" className="link-btn" onClick={() => { void fetchNow(true); }}>Queue after sweep</button>
        </span>
      ) : (
        <span>
          {LABEL} ·{" "}
          <button type="button" className="link-btn" onClick={() => { void fetchNow(false); }}>Fetch</button>
          {phase.kind === "failed" ? <span className="muted"> · {phase.message}</span> : null}
        </span>
      )}
    </div>
  );
}
