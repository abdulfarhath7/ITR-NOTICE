# 00 · Overview

## Goal
Ship the income-tax **notice + litigation** tool as a native, local-first
**Windows desktop app** on Tauri 2, reusing the portal automation from the web
tool unchanged.

## In scope
- Tauri 2 shell; React + TS UI bundled as app assets.
- Rust core: encrypted archive, OS keychain, sidecar bridge, proxy client.
- The Playwright automation as a bundled child process.
- A small hosted proxy holding the Anthropic key and the prompts.
- GitHub Actions build producing an NSIS installer for Windows.

## Non-goals
- No rewrite of the portal automation.
- No macOS/Linux release (dev on Linux is fine; shipping is Windows only).
- No auto-update yet — deliberately dropped, see QUESTIONS.md Q2.
- No central store of firm data. The proxy sees one notice PDF per request and
  keeps nothing.
- No new product features beyond what the web tool already did.

## Success in one sentence
On a Windows machine, `npm run tauri build` produces an installer that logs into
the portal, fills an encrypted local archive, and drafts a reply through the
firm's proxy.
