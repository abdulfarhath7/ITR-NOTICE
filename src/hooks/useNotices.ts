/** The notices table's data.
 *
 * A sync commits one notice at a time and says so on the socket. Refetching on
 * every message would be dozens of round trips a minute, so the store's
 * revision counter is collapsed into at most one reload every two seconds -
 * always with a trailing one, so the last notice of a run is never left off.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useHub } from "@/hooks/useHub";
import { ApiError, api, type Notice, type Run } from "@/lib/api";

const REFRESH_EVERY = 2000;

export type NoticesData = {
  notices: Notice[];
  lastRun: Run | null;
  loading: boolean;
  /** Set when the sidecar answered 401 - the dashboard password is on. */
  locked: boolean;
  error: string | null;
  reload: () => void;
  /** Patch one row in place, so a due date or a draft tick lands without a
   *  refetch (and without the table jumping). */
  patch: (refId: string, changes: Partial<Notice>) => void;
};

export function useNotices(): NoticesData {
  const { noticeRevision, finishedRevision } = useHub();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [lastRun, setLastRun] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadedAt = useRef(0);

  const reload = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      try {
        const data = await api.notices(controller.signal);
        if (!alive) return;
        loadedAt.current = Date.now();
        setNotices(data.notices);
        setLastRun(data.last_run);
        setLocked(false);
        setError(null);
      } catch (cause) {
        if (!alive) return;
        if (cause instanceof ApiError && cause.status === 401) {
          setLocked(true);
          setError(null);
        } else if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : "Could not reach the sidecar.");
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [tick]);

  // Throttled follow-up for the live "notice committed" pushes.
  useEffect(() => {
    if (noticeRevision === 0) return;
    if (timer.current) return;
    const wait = Math.max(0, REFRESH_EVERY - (Date.now() - loadedAt.current));
    timer.current = setTimeout(() => {
      timer.current = null;
      reload();
    }, wait);
  }, [noticeRevision, reload]);

  // A finished run is worth one immediate, un-throttled reload.
  useEffect(() => {
    if (finishedRevision === 0) return;
    reload();
  }, [finishedRevision, reload]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const patch = useCallback((refId: string, changes: Partial<Notice>) => {
    setNotices((rows) =>
      rows.map((row) => (row.ref_id === refId ? { ...row, ...changes } : row)),
    );
  }, []);

  return { notices, lastRun, loading, locked, error, reload, patch };
}
