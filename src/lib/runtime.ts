/** Where the sidecar is, and the token that opens it.
 *
 * The Rust layer picks a free loopback port and mints a random token at
 * launch, then answers the `backend_info` command with both. Neither value is
 * ever written to disk by the UI (docs/06-security.md); this module is the
 * only place that holds them.
 */

export type Backend = {
  baseUrl: string;
  token: string;
};

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

let cached: Backend | null = null;
let pending: Promise<Backend> | null = null;

export const inTauri = (): boolean =>
  typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;

/** Browser-only development (`pnpm dev` with a hand-started backend). */
function fromEnv(): Backend {
  const base = import.meta.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8000";
  return { baseUrl: base.replace(/\/$/, ""), token: import.meta.env.VITE_APP_TOKEN ?? "" };
}

export async function backend(): Promise<Backend> {
  if (cached) return cached;
  if (pending) return pending;
  const attempt = (async (): Promise<Backend> => {
    if (!inTauri()) {
      cached = fromEnv();
      return cached;
    }
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ base_url: string; token: string }>("backend_info");
    cached = { baseUrl: info.base_url.replace(/\/$/, ""), token: info.token };
    return cached;
  })();
  // The shell answers `backend_info` with an error until the sidecar is
  // healthy. Memoising that rejection would poison every later call for the
  // life of the window, so the memo is dropped and the next call retries.
  pending = attempt;
  attempt.catch(() => {
    if (pending === attempt) pending = null;
  });
  return attempt;
}

/** Why the backend is not there, straight from the shell. Used once on start
 *  so a failed launch names its reason instead of showing an empty table. */
export async function backendFailure(): Promise<string | null> {
  if (!inTauri()) return null;
  try {
    await backend();
    return null;
  } catch (cause) {
    return typeof cause === "string" ? cause : cause instanceof Error ? cause.message : null;
  }
}

/** The websocket URL for the same sidecar. A browser cannot put a header on a
 *  websocket handshake, so the shared token rides in the query string - still
 *  loopback-only, and never logged (docs/06). */
export async function wsUrl(): Promise<string> {
  const { baseUrl, token } = await backend();
  const url = new URL("/ws", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (token) url.searchParams.set("token", token);
  return url.toString();
}
