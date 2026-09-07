# 03 · Contracts

Three interfaces. They are the whole surface.

## 1 · UI → Rust (`invoke`)
Argument names are camelCase from TS, snake_case in Rust; Tauri converts.

| Command | In | Out |
|---|---|---|
| `get_settings` | — | `Settings` |
| `save_settings` | `settings` | — (token goes to the keychain) |
| `list_notices` | — | `NoticeRow[]` (never the PDF blob) |
| `get_notice_pdf` | `refId` | base64 string, for a `blob:` URL |
| `get_draft` | `refId` | `Draft \| null` |
| `save_draft_text` | `refId`, `draftText` | — |
| `has_saved_password` | `userId` | `boolean` |
| `forget_password` | `userId` | — |
| `portal_login` | `userId`, `password \| null`, `remember` | — (spawns the sidecar) |
| `portal_otp` | `code` | — |
| `portal_sync` | `limit \| null` | — |
| `portal_speed` | `seconds` | — (no UI calls this yet) |
| `portal_stop` | — | — (kills the sidecar) |
| `ask_due_date` | `refId` | `DueDateAnswer` — cached; a stored date wins |
| `draft_response` | `refId`, `regenerate` | `Draft` — cached unless regenerate |

`password: null` means "use the one in the keychain". Types live in
`src/lib/types.ts` and must match the `Serialize` structs in `db.rs`/`lib.rs`.

## 2 · Rust ↔ sidecar (JSON lines)
One JSON object per line, both directions. Never print anything else to stdout;
tracebacks go to stderr and are re-emitted as `{"ev":"stderr"}`.

Commands in: `login` (`user_id`, `password`), `otp` (`code`), `sync` (`limit`),
`speed` (`seconds`), `stop`.

Events out: `ready`, `log`, `progress` (`kind`, …), `login_phase` (`phase`),
`otp_required`, `login_ok`, `notice` (row fields + `pdf_b64`),
`sync_done` (`stats`), `error` (`kind`, `msg`).

Everything except `notice` is forwarded verbatim to the webview on the Tauri
event channel `scraper`; `notice` is absorbed into the archive first and
re-emitted as `{"ev":"notice","ref_id":…}`. Rust adds two events of its own:
`stderr` and `exited`.

## 3 · Rust → proxy (HTTPS, bearer token)
- `POST /v1/due-date` — `{ref_id, pdf_b64, issued_on?, served_on?}`
  → `{due_date: string|null, basis: string}`
- `POST /v1/draft` — `{ref_id, pdf_b64, notice_us?, assessee?, assessment_year?}`
  → `{summary, checklist: string[], draft_reply}`
- `GET /healthz` → `{ok: true}`

`Authorization: Bearer <firm token>`. 401 on an unknown token. Both routes are
stateless; the proxy stores and logs nothing.
