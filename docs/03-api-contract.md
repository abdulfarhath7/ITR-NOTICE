# 03 · API contract (backend is fixed — the UI conforms to this)

Base URL: `http://127.0.0.1:<port>`; send the shared token on every request.

## HTTP
- `POST /login {password}` · `POST /logout`
- `POST /api/sync {limit?}` — start a scrape run
- `POST /api/credentials {...}` · `DELETE /api/credentials` — portal creds (memory-only)
- `GET /api/speed` · `POST /api/speed {speed}` — Slow | Fast | Extreme, changeable mid-run
- `POST /api/otp {otp}` — human OTP, forwarded to the live browser
- `GET /api/notices` · `GET /api/notices/{ref_id}/pdf?inline=0|1`
- `GET /api/summary` · `GET /api/export.xlsx`
- `POST /api/notices/{ref_id}/ask-claude` — fill a missing due date
- `POST /api/notices/{ref_id}/draft?regenerate=0|1`
- `GET /api/notices/{ref_id}/draft.pdf?inline=0|1`
- `POST /api/notices/{ref_id}/draft/text {text}`
- `GET /health` (added by you) — readiness probe

## WebSocket `GET /ws`
Server → client messages the UI must handle:
- **log line** — append to the live log.
- **`otp_required`** — freeze the pipeline; open the OTP entry modal.
- **viewport frame** — base64 image of the live browser; render it.
- **state / stage counts** — drive the sync pipeline UI.

Match message shapes to what `app/main.py`'s `EventHub` and `app/static/app.js`
already emit/consume; treat `app.js` as the reference implementation.
