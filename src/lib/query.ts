/** The query layer (docs/13): components never fetch; hooks do, through
 *  here. A key names a piece of server state; `invalidate(prefix)` refetches
 *  every mounted query under it.
 *
 *  Small on purpose, but not naive: results are cached by key, so a screen
 *  the user comes back to paints from cache and revalidates in the
 *  background, and two components asking for the same key at the same
 *  time share one in-flight call to the core. */
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

type Listener = () => void;

/** Immutable per-key snapshot: React compares these by identity. */
interface Snapshot<T = unknown> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** 0 until the first successful fetch, or after an invalidation. */
  fetchedAt: number;
}

interface Entry<T = unknown> {
  snap: Snapshot<T>;
  inflight: Promise<void> | null;
  /** The fetcher of the running or last fetch, for a refetch after it. */
  fetcher: (() => Promise<unknown>) | null;
  /** An invalidation arrived while a fetch was running: go again after it. */
  again: boolean;
  listeners: Set<Listener>;
}

const EMPTY: Snapshot = { data: undefined, error: null, loading: false, fetchedAt: 0 };
const cache = new Map<string, Entry>();
/** Entries nobody is watching are dropped after this long. */
const IDLE_TTL_MS = 5 * 60_000;

function entry<T>(key: string): Entry<T> {
  let e = cache.get(key) as Entry<T> | undefined;
  if (!e) {
    e = { snap: EMPTY as Snapshot<T>, inflight: null, fetcher: null, again: false, listeners: new Set() };
    cache.set(key, e);
  }
  return e;
}

function update<T>(e: Entry<T>, patch: Partial<Snapshot<T>>): void {
  e.snap = { ...e.snap, ...patch };
  e.listeners.forEach((l) => l());
}

function fetchInto<T>(key: string, fetcher: () => Promise<T>): Promise<void> {
  const e = entry<T>(key);
  e.fetcher = fetcher;
  if (e.inflight) return e.inflight;
  update(e, { loading: true });
  const settle = (patch: Partial<Snapshot<T>>) => {
    e.inflight = null;
    const again = e.again;
    e.again = false;
    // A result that an invalidation overtook is shown, then replaced.
    update(e, { ...patch, loading: false, fetchedAt: again ? 0 : Date.now() });
    if (again && e.fetcher) void fetchInto(key, e.fetcher as () => Promise<T>);
  };
  const p = fetcher().then(
    (data) => settle({ data, error: null }),
    (err) => settle({ error: describeError(err) }),
  );
  e.inflight = p;
  return p;
}

/** Refetch every mounted query whose key is `prefix` or starts with
 *  `prefix:`. Unmounted entries are simply forgotten so they refetch on
 *  their next mount. */
export function invalidate(prefix: string): void {
  for (const [key, e] of cache) {
    if (key !== prefix && !key.startsWith(prefix + ":")) continue;
    if (!e.listeners.size) { cache.delete(key); continue; }
    if (e.inflight) e.again = true;
    update(e, { fetchedAt: 0 });
  }
}

export interface QueryState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

export function useQuery<T>(key: string | null, fetcher: () => Promise<T>): QueryState<T> {
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const subscribe = useCallback((onChange: Listener) => {
    if (key === null) return () => {};
    const e = entry<T>(key);
    e.listeners.add(onChange);
    return () => {
      e.listeners.delete(onChange);
      if (!e.listeners.size) {
        setTimeout(() => { const cur = cache.get(key); if (cur && !cur.listeners.size) cache.delete(key); }, IDLE_TTL_MS);
      }
    };
  }, [key]);
  const snapshot = useCallback((): Snapshot<T> => (key === null ? (EMPTY as Snapshot<T>) : entry<T>(key).snap), [key]);
  const snap = useSyncExternalStore(subscribe, snapshot, snapshot);

  // A mount with no fresh data fetches; a stale entry refetches while the
  // cached value stays on screen.
  useEffect(() => {
    if (key === null) return;
    if (snap.fetchedAt === 0 && !entry<T>(key).inflight) void fetchInto(key, fetcherRef.current);
  }, [key, snap.fetchedAt]);

  const refetch = useCallback(() => {
    if (key !== null) void fetchInto(key, fetcherRef.current);
  }, [key]);

  // Before the first fetch lands the query is loading, even if the effect
  // that starts it has not run yet: no screen flashes its empty state.
  const loading = key !== null && (snap.loading || (snap.fetchedAt === 0 && snap.error === null));
  return { data: snap.data, error: snap.error, loading, refetch };
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
