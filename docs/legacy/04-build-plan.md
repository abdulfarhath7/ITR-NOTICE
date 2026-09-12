# 04 · Build state

The port was built in one pass, then rebuilt around a different architecture.
`TASKS.md` is the live checklist; this file is the shape of the work.

## What is built
0. **Shell** — Tauri 2 + Vite + React + TS, plain CSS, NSIS bundle, capabilities
   limited to `core:default`.
1. **Sidecar** — the portal automation as a child process with a JSON-lines
   protocol, frozen by PyInstaller with Chromium inside it.
2. **Rust core** — SQLCipher archive, keychain, sidecar bridge, proxy client,
   15 commands, one event channel.
3. **UI** — register with due-date buckets, notice drawer with PDF and draft,
   connect + OTP flow, settings, Excel export.
4. **Proxy** — two routes, per-firm bearer tokens, stateless.
5. **CI** — a `windows-latest` job triggered by a `vX.Y.Z` tag.

## What is deliberately not built
- Auto-update (Q2). No updater plugin, no signing key, no feed.
- Live browser viewport, command palette, speed control UI — all dropped when
  the websocket went away. `portal_speed` still exists on both sides.
- Any test suite. The human verifies; see the checklist in `NOTES.md`.

## Rules for the next pass
- Do not stop to ask. Default, build, record in `QUESTIONS.md`.
- Do not test. Compiling and bundling are allowed; running the app is not.
- On an error: `TODO` at the site, a line in `NOTES.md`, keep going.
