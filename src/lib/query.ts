/** The query layer (docs/13): components never fetch; hooks do, through
 *  here. A key names a piece of server state; `invalidate(prefix)` refetches
 *  every mounted query under it. Small on purpose. */
import { useCallback, useEffect, useRef, useState } from "react";

type Listener = () => void;
const listeners = new Map<string, Set<Listener>>();

export function invalidate(prefix: string): void {
  for (const [key, set] of listeners) {
    if (key === prefix || key.startsWith(prefix + ":")) set.forEach((l) => l());
  }
}

export interface QueryState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (key === null) { setLoading(false); return; }
    const set = listeners.get(key) ?? new Set<Listener>();
    set.add(refetch);
    listeners.set(key, set);
    return () => { set.delete(refetch); if (!set.size) listeners.delete(key); };
  }, [key, refetch]);

  useEffect(() => {
    if (key === null) return;
    let live = true;
    setLoading(true);
    fetcherRef.current().then(
      (d) => { if (live) { setData(d); setError(null); setLoading(false); } },
      (e) => { if (live) { setError(describeError(e)); setLoading(false); } },
    );
    return () => { live = false; };
  }, [key, tick]);

  return { data, error, loading, refetch };
}

/** Commands reject with an `AppError` object ({ code, message, detail }) or,
 *  from the older commands, a plain string. One reader for both. */
export function describeError(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  return String(e);
}
