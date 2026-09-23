/** The ingestion monitor's state: polled from the core and nudged by the
 *  `ingestion` event channel (state changes, log lines, frames). */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, describeError, onIngestion } from "../lib/api";
import { invalidate } from "../lib/query";
import { toastError } from "../lib/toast";
import type { IngestionEvent, IngestionState, Module, Scope } from "../lib/types";

export interface LogLine { level: string; msg: string; at: number }

export function useIngestion() {
  const [state, setState] = useState<IngestionState | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [frame, setFrame] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, unknown> | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try { setState(await api.ingestionState()); } catch { /* the shell may not be up yet */ }
  }, []);

  // Data screens refresh at most every 2 s while a run writes.
  const invalidateSoon = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      invalidate("work_items"); invalidate("clients"); invalidate("proceedings");
    }, 2000);
  }, []);

  useEffect(() => {
    void refresh();
    const poll = setInterval(() => { void refresh(); }, 2500);
    let unlisten: (() => void) | undefined;
    let dropped = false;
    const handler = (ev: IngestionEvent) => {
      switch (ev.ev) {
        case "state": void refresh(); invalidateSoon(); break;
        case "log": setLog((l) => [...l.slice(-399), { level: ev.level, msg: ev.msg, at: Date.now() }]); break;
        case "progress": setProgress(ev.data); break;
        case "viewport": setFrame(ev.img); break;
        case "challenge": void refresh(); break;
      }
    };
    let p: Promise<(() => void) | undefined>;
    try { p = onIngestion(handler); } catch { p = Promise.resolve(undefined); }
    p.then((u) => { if (dropped) u?.(); else unlisten = u; });
    return () => { dropped = true; unlisten?.(); clearInterval(poll); if (refreshTimer.current) clearTimeout(refreshTimer.current); };
  }, [refresh, invalidateSoon]);

  const guard = useCallback(async (f: () => Promise<unknown>) => {
    try { await f(); await refresh(); }
    catch (e) { toastError(describeError(e)); }
  }, [refresh]);

  return {
    state, log, frame, progress,
    start: (scope: Scope, allNow = false, modules?: Module[]) => guard(() => { setFrame(null); setProgress(null); return api.startIngestion(scope, allNow, modules); }),
    resumeSweep: (id: string) => guard(() => api.resumeSweep(id)),
    pause: () => guard(() => api.pauseIngestion()),
    resume: () => guard(() => api.resumeIngestion()),
    stop: () => guard(() => api.stopIngestion()),
    submitChallenge: (kind: string, value: string) => guard(() => api.submitChallenge(kind, value)),
    setPace: (seconds: number) => guard(() => api.setPace(seconds)),
  };
}
