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

/** Why the shell gave up on the backend, or null while it is still coming up.
 *  Recorded in the shell as well as emitted, so a failure that happened before
 *  this window had a listener is still readable. */
export async function backendFailure(): Promise<string | null> {
  if (!inTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("backend_failure");
}

export type BootResult = { ok: true } | { ok: false; message: string };

/** Wait for the sidecar.
 *
 *  The webview loads and starts calling while the shell is still polling
 *  /health, so the first `backend_info` almost always fails - that is the
 *  normal path, not an error. Only a failure the SHELL recorded, or running
 *  out of patience entirely, is worth telling the user about.
 */
export async function waitForBackend(timeoutMs = 90_000): Promise<BootResult> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await backend();
      return { ok: true };
    } catch {
      const failure = await backendFailure().catch(() => null);
      if (failure) return { ok: false, message: failure };
      if (Date.now() > deadline) {
        return { ok: false, message: `the backend did not answer within ${Math.round(timeoutMs / 1000)}s` };
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
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
