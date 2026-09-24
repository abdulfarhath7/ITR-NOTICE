# 17 — Scrape scopes: sweep, deep fetch, item fetch

Read after `05-ingestion.md`, `06-source-interface.md` and `16-dashboard-v2.md`.
This file is the specification for Phase 23 in `TASKS.md`.

The tool must never scrape a client's full history by default. The
overnight run reads only what the dashboard needs; full history is
fetched for one client at a time, only when a person asks. This file
turns that policy into three scopes and one nightly pipeline, built on
top of the queue, sidecar protocol and scheduler that already exist.

Everything in `05-ingestion.md` still holds — sequential queue, never
fail on a human, never retry a bad password, blank beats guessed, zero is
a finding, resumability — with one amendment stated in §5.

---

## 0. What already exists (inspect before building)

| Piece | Where | Reuse |
|---|---|---|
| Sweeps and jobs, resume cursor, retry schedule | `migrations/0011_ingestion_queue.sql`, `src-tauri/src/repo/queue.rs` | keep; add `scope` semantics |
| Runner, one client at a time, session locks | `src-tauri/src/ingest/runner.rs` | keep; add the per-header decision in §2.3 |
| Scheduler (`sweep_schedule` in the settings KV) | `src-tauri/src/ingest/scheduler.rs` | keep; add window end and budget |
| Early-stop delta walk (10 unchanged rows) | `05-ingestion.md`, sidecar `walk.py` | keep; the sweep window is applied on top of it |
| Sidecar v2 protocol: `header` → `next skip/fetch/stop` | `sidecar/ingest/protocol.py` | this is where scope decisions land — the Rust side answers every `header` |
| Per-module cadence (Q12) | `05-ingestion.md` "Cadence" | keep; dormant tier (§2.5) sits beside it |
| `documents.state` = stored / pending / failed | `migrations/0007_documents.sql` | `pending` is the index-only state |
| Per-client sync toggle, `Sync now` | Build 2 Phase 20 (`clients.sync_enabled`) | keep; §6 adds reason text |
| Ingestion screen | `screens/ingestion.tsx` | becomes the Sync screen in §7 |

Build 2 landed after this repo snapshot was written; if a name above has
moved, follow the code, not this table, and note it in `NOTES.md`.

---

## 1. The three scopes

| Scope | Trigger | Clients | Time range | Documents | Runs |
|---|---|---|---|---|---|
| **Sweep** | scheduler, or `Sweep all now` / `Sync now` | all enabled clients (or one) | new items issued within `lookback_days` (default 30) **plus every tracked open item regardless of age** | index only (`pending`) | background, sequential, nightly |
| **Deep fetch** | `Fetch history` on a client, or the add-client checkbox | one client | Everything / Last N AYs / Since date | index only, or download all (user's choice) | queued after tonight's sweep, or `Run now` in the foreground |
| **Item fetch** | opening a work item whose documents are `pending`; the `Fetch` button on the item; warm cache (§2.6) | one proceeding | that proceeding only, all its communications and responses | download | foreground, immediate; or background for warm cache |

A closed/settled item is never touched by a sweep. It is read again only
by a deep fetch or an item fetch.

`ingestion_sweeps.scope` JSON gains a `kind` value of `sweep`, `deep` or
`item` (the existing `all` / `module` / `client` selectors stay as
`selector` inside the same JSON). Every `ingestion_runs` row gains
`scope TEXT NOT NULL DEFAULT 'sweep'` so the Updates screen and exports
can say which kind of run produced a change.

---

## 2. The overnight pipeline

```
run window opens (default 01:00 IST)
  │
  ├─ 1. order clients            §2.1
  ├─ 2. probe each client        §2.2   ~5 s each; unchanged → skip
  ├─ 3. sweep changed clients    §2.3   header-by-header decisions
  ├─ 4. deep queue               §2.4   one request at a time
  ├─ 5. warm cache               §2.6   only if budget remains
  └─ 6. summary                  §2.8
run window closes (default 06:00 IST) or budget exhausted → checkpoint, stop
```

Steps 2–5 are each interruptible; the checkpoint (§2.7) makes the next
night, or a restart, continue rather than begin again.

### 2.1 Ordering

Clients are ordered once at the start of the run, then the order is
frozen for that run:

1. clients whose last sweep `failed` (not `credentials_parked` — those
   wait for a person)
2. by soonest effective due date across their open items, ascending;
   clients with an overdue item first
3. clients with no open items, by `last_swept_at` ascending (oldest first)
4. dormant clients (§2.5) only on their cadence day

The order is written into `ingestion_jobs.position`. The Sync screen
shows it.

### 2.2 Probe

Before a full panel walk, the runner asks the sidecar for the listing of
each panel and computes a **list hash**: SHA-256 over the concatenation
of every row's `row_hash` (the existing `din + status + due_date +
gap_flags` hash) in portal order, for the first two pages only. New
sidecar command:

```
{"cmd": "probe", "panel": "self:action", "client_pan": "...", "pages": 2}
→ {"ev": "probe_done", "panel": "...", "list_hash": "...", "rows": n}
```

The hash is stored in a new local table:

```sql
CREATE TABLE probe_state (
    login_ref   TEXT NOT NULL,
    panel       TEXT NOT NULL,
    list_hash   TEXT NOT NULL,
    rows        INTEGER NOT NULL,
    checked_at  TEXT NOT NULL,
    PRIMARY KEY (login_ref, panel)
);
```

If every panel's hash equals the stored one, the client's sweep job is
marked `done` with `records_found = 0` and `notes = 'unchanged'`, an
`ingestion_runs` row is still written (zero is a finding), and the
runner moves on. If any panel differs, the client is swept in full and
the new hashes are stored after the sweep completes.

Rules for the probe:

- The hash is computed **from portal row content only**. Never include
  a value the tool computed (today's date, a bucket, a rank). A wrong
  input here would hide real notices.
- A probe that fails for any reason counts as "changed": sweep the
  client. Never skip on a failed probe.
- The first sweep of a client (no `probe_state` rows) is never skipped.
- A deep fetch or item fetch never consults the probe.

### 2.3 Sweep decisions per header

The sidecar already emits one `header` per row and waits for `next`.
The runner answers using this table, in order:

| Condition | Answer |
|---|---|
| row already stored and `row_hash` unchanged and the stored item is settled | `skip` |
| row already stored and `row_hash` unchanged and the stored item is open | `skip` (the row is unchanged; the open item's status is read from the row itself) |
| row already stored and `row_hash` changed | `fetch` header only — update the row, mark documents for the changed communication `pending`; do not download |
| row not stored and `issued_on` within `lookback_days` | `fetch` header only; store with documents `pending` |
| row not stored and `issued_on` older than `lookback_days` | `skip`, and increment the panel's "older than window" count |
| row not stored and `issued_on` blank | `fetch` header only (blank beats guessed: an undated row is inside the window) |
| streak of 10 unchanged in a row | `stop` (existing early-stop rule) |

"Fetch header only" means the runner takes the `header` event's data and
does **not** answer `fetch` for the PDF; it answers `skip` after recording
the header. This needs one protocol addition so the sidecar can tell the
two apart:

```
{"cmd": "next", "action": "index"}     # record header, no document download
```

`index` behaves like `skip` on the portal but the sidecar emits the
header's document references (filename, portal document id if visible)
as an `item` event with `pdf_b64: null` so the runner can create the
`documents` row in state `pending`.

Every open tracked item is therefore re-read every night: its row
appears in the listing (open items are on the "For your action" tabs),
its hash is compared, and any change (due date, status, a new response)
is captured. That is what feeds the Updates screen.

### 2.4 Deep fetch

A request row:

```sql
CREATE TABLE deep_fetch_requests (
    id            TEXT PRIMARY KEY,
    client_id     TEXT NOT NULL REFERENCES clients(id),
    depth         TEXT NOT NULL CHECK (depth IN ('all','years','since')),
    depth_value   TEXT,                 -- years: "2"; since: "YYYY-MM-DD"; all: NULL
    modules       TEXT NOT NULL,        -- JSON array
    docs_policy   TEXT NOT NULL CHECK (docs_policy IN ('index','download')),
    mode          TEXT NOT NULL CHECK (mode IN ('tonight','now')),
    status        TEXT NOT NULL CHECK (status IN ('queued','running','done','failed','cancelled')),
    requested_by  TEXT,
    requested_at  TEXT NOT NULL,
    started_at    TEXT,
    finished_at   TEXT,
    progress      TEXT,                 -- JSON: {"panel":"...","ay":"...","done":n,"total":n}
    last_error    TEXT
);
```

Execution:

- `tonight`: picked up after step 3 of the pipeline, oldest request
  first, one at a time, only while the run window is open. A request not
  reached tonight stays `queued` and is first tomorrow.
- `now`: creates a foreground sweep with `kind: deep` immediately, using
  the attended runner path (captcha/OTP pauses and prompts as today).
  `Sync now` and a running scheduled sweep are mutually exclusive on the
  same login (existing session lock); the UI says "a sweep is running,
  queued for after it" instead of failing.
- Depth `all`: every AY the portal lists, all panels including "For your
  information", all selected modules. `years`: the latest N AYs.
  `since`: rows with `issued_on >= date`; blank `issued_on` is included.
- Docs policy `index` stores rows with documents `pending`; `download`
  answers `fetch` for every header and stores PDFs as today.
- On completion: `clients.history_depth` = `full` (for `all`) or `partial`
  (for `years` / `since`), `clients.history_fetched_at` = now,
  `clients.history_note` = a short human string ("Last 2 AYs, index
  only"). A `history_fetched` entry is written to the ledger so the
  Updates screen can show "History fetched · Rao Textiles · 1,204 items".
- Failure: `status = failed`, `last_error` masked, the client stays at its
  previous depth. No automatic retry; the Sync screen offers `Retry`.

Client columns:

```sql
ALTER TABLE clients ADD COLUMN history_depth      TEXT NOT NULL DEFAULT 'recent'
                                                  CHECK (history_depth IN ('recent','partial','full'));
ALTER TABLE clients ADD COLUMN history_fetched_at TEXT;
ALTER TABLE clients ADD COLUMN history_note       TEXT;
ALTER TABLE clients ADD COLUMN cadence_tier       TEXT NOT NULL DEFAULT 'nightly'
                                                  CHECK (cadence_tier IN ('nightly','weekly'));
ALTER TABLE clients ADD COLUMN last_swept_at      TEXT;
ALTER TABLE clients ADD COLUMN sync_pause_reason  TEXT;
```

### 2.5 Dormant tier

After each sweep, a client is moved to `cadence_tier = weekly` when all
three hold: no open items; nothing issued within `dormant_after_days`
(default 90); no deep fetch queued. It moves back to `nightly` the
moment a sweep or probe finds any change. Weekly clients are swept on
`dormant_weekday` (default Sunday). The tier is shown on the client and
on the Sync screen; a person can pin a client to `nightly` (a
`cadence_pinned` boolean column) and that pin is never auto-cleared.

### 2.6 Warm cache

After the deep queue, if the run window is still open and at least 20%
of the budget remains, download documents in state `pending` for open
items whose effective due is within `warm_cache_days` (default 7),
soonest first, as item fetches in the background. Stop the moment the
window closes. This is the only step that downloads PDFs during a sweep
without a person asking.

### 2.7 Time budget and checkpoint

- `run_window_start` (default `01:00`) and `run_window_end` (default
  `06:00`), IST, in the scheduler settings beside the existing `time`.
  The existing `time` becomes `run_window_start`; migrate the stored
  value.
- `client_timeout_min` (default 3): a client whose job exceeds it is
  marked `incomplete` with the cursor saved, and the runner moves on.
- The runner checks the wall clock between clients and between panels;
  past `run_window_end` it finishes the current panel, saves the
  cursor, marks the sweep `stopped` with `notes = 'window closed'`, and
  exits. Nothing is marked failed because time ran out.
- Resume rule (existing): on the next start the sweep continues from
  the first non-done job. A run that stopped on the window boundary
  resumes the **next night** at the same position, then re-orders.

### 2.8 Summary

When a sweep finishes or stops, write one `sweep_summary` JSON on the
`ingestion_sweeps` row: `{swept, skipped_unchanged, failed, parked,
deep_done, warm_cached, duration_s, window_closed}`. Show it as a toast on
the collector and as the first card on the Updates screen ("Last night:
swept 187, skipped 12 unchanged, 3 failed"). The Updates unread badge
counts it.

### 2.9 Cost estimate

`estimate_sweep_seconds(client_ids)` = Σ per client of the median
duration of that client's last five sweep jobs, or the firm-wide median
when the client has fewer than two; probe-skips count as 5 s. Shown on
the `Sweep all now` button ("≈ 42 min"), in the deep-fetch dialog, and on
the client's `Sync now` tooltip. Never block on the estimate; it is a
label.

---

## 3. Item fetch

Triggered when:

1. a person opens a work item that has any document in state `pending`
   — the detail screen shows "Documents not fetched yet · Fetch" and, if
   `auto_item_fetch` is on (default on), starts the fetch immediately with
   an inline progress line;
2. a person clicks `Fetch` on the item or on a document row;
3. warm cache (§2.6).

An item fetch logs in as that client, navigates to the one proceeding,
downloads every communication and response document, stores them
(document first, row second — the existing rule), and marks them
`stored`. It writes an `ingestion_runs` row with `scope = 'item'`. It
takes the session lock like any job; if the client's login is in use by
the nightly sweep, the UI says so and offers to queue it.

---

## 4. Add-client flow

The add-client form gains one checkbox, off by default: "Also fetch full
history tonight". Unchecked: the client's first sweep runs at the next
`Sync now` or nightly run, and the client shows `History: recent only`.
Checked: a `deep_fetch_requests` row (`all`, `index`, `tonight`) is
created alongside. Bulk credential import (deferred) will get the same
column later; do not build it now.

---

## 5. Amendment to `05-ingestion.md`

"Document first, row second" stays the rule **whenever a document is
fetched**. Index-only rows are now allowed: a row may reference a
document in state `pending` (no `file_hash`, no `storage_path`). The
invariant becomes: a `documents` row in state `stored` must have a
hash and a path; a row in state `pending` must have a `source_url` or
portal reference the item fetch can use. Update `05-ingestion.md` and
`02-data-model.md` to say this (task 23.14).

---

## 6. UI

### 6.1 Sync screen (was Ingestion)

Route stays; nav label becomes "Sync". Matches mockup
`lcc_sync_screen_queue_and_health`:

- Head: title "Sync"; right side `Sweep all now · ≈ 42 min` and `Pause`
  (existing pause).
- Run card: "Tonight's run · started 01:00 · window ends 06:00" left,
  "128 / 200 · 02:47 elapsed · 1:10 left" right; a 6px progress bar;
  a legend line with dots: Swept n · Skipped n unchanged · Failed n ·
  Deep n queued. When no run is active the card shows the last
  summary (§2.8) and "Next run tonight 01:00".
- Queue table, columns: Client · Scope · Status · Changes · Last sweep ·
  Next. Scope is a pill: `Sweep` (success tint), `Deep · full` /
  `Deep · 2 AYs` / `Deep · since 1 Apr` (accent tint), `Item` (muted).
  Status strings: `Running · 0:38`, `Done · 0:41`, `Skipped · unchanged`,
  `Failed · <reason>` (danger), `Queued · after sweep`, `Dormant`,
  `Paused · <reason>`, `Awaiting you · OTP` (warning). Next: `Nightly`,
  `Weekly · Sun`, `Tonight`, `Fix credentials` (danger link to the
  client's credentials), `—`.
- Row click opens the client. Hover shows `Sync now` and, for failed
  rows, `Retry`.
- Filters above the table: All · Running · Failed · Queued · Dormant, as
  segmented control; persisted like the Attention filters.

### 6.2 Client 360 additions

- Header line under identifiers: `History: recent only · Fetch history`
  or `History: full · fetched 12 Sep` or `History: last 2 AYs, index only
  · Fetch more`. The link opens the dialog in §6.3.
- The existing sync toggle, when turned off, asks for an optional reason
  (one input) stored in `sync_pause_reason` and shown as `Paused · <reason>`.
- Summary tile "Last synced" also shows the tier: `6:12 am · nightly`.

### 6.3 Deep fetch dialog

Matches mockup `lcc_deep_fetch_dialog`:

- Title `Fetch history · <client>`; subtitle `Currently: <history_note>
  · swept <tier>`.
- "How far back": Everything, all assessment years (default) / Last
  `[2]` assessment years (number input 1–10) / Since `[date]`.
- "Documents": Index only, download on click (default) / Download every
  PDF now.
- "Modules": four checkboxes, all on, at least one required.
- Estimate line: `≈ 11 min · runs tonight after the sweep · or run now
  in the foreground`, using §2.9 with a deep multiplier (median deep
  duration per AY × AY count when known, else 3× the sweep median).
- Buttons: Cancel · Run now · Queue for tonight (primary). Queueing
  when a request already exists for the client replaces it.

### 6.4 Rows and badges

- Attention list, module lists, Updates rows, Calendar day list: an
  item with any `pending` document shows a small outline `cloud-down`
  icon after the section pill with tooltip "Documents not fetched yet".
  Stored items show nothing. This is the `Indexed` state; do not add
  a text badge.
- Clients list: a `recent` / `partial` / `full` pill in a History column,
  and a `weekly` pill when dormant.
- Work item detail: banner under the header when documents are pending:
  `Documents not fetched yet · Fetch` with inline progress once started.

### 6.5 Settings → Sweeps

Existing schedule section, extended. Every row is a `Row` in the
settings vocabulary; all persist to the scheduler settings KV.

| Row | Control | Default |
|---|---|---|
| Run window | two time inputs, start / end | 01:00 – 06:00 |
| Days | existing day picker | Mon–Sat |
| Look back for new items | number, days | 30 |
| Re-check open items every night | read-only "On" with hint | on |
| Dormant after | number, days; "Never" toggle | 90 |
| Dormant cadence | Weekly + weekday select / Fortnightly | Weekly · Sunday |
| Per-client timeout | number, minutes | 3 |
| Documents during sweep | Index only / Download within window | Index only |
| Warm cache after sweep | Off / 3 / 7 / 15 days | 7 |
| Fetch documents when I open an item | toggle | on |
| Retry failed clients | read-only "Next night, every night until fixed" | fixed |

---

## 7. Commands (Rust → frontend)

| Command | Purpose |
|---|---|
| `request_deep_fetch(client_id, depth, depth_value, modules, docs_policy, mode)` | create or replace a request; `mode = now` starts it |
| `cancel_deep_fetch(id)` | queued only |
| `list_deep_fetch_requests()` | for the Sync screen |
| `fetch_item(module, id)` | foreground item fetch; returns a job id for progress events |
| `sweep_estimate(client_ids)` / `deep_estimate(client_id, depth, depth_value)` | §2.9 |
| `get_sweep_settings()` / `set_sweep_settings(...)` | §6.5, superset of the existing schedule get/set |
| `set_client_sync(client_id, enabled, reason)` | extends Build 2's toggle |
| `pin_client_cadence(client_id, pinned)` | §2.5 |

Progress for deep and item fetches arrives on the existing ingestion
event stream (`onIngestion`), with a `scope` field added to every event.

---

## 8. Out of scope

Parallel workers above the existing constant (Q08), near-real-time
detection via ERI, email or WhatsApp on sweep completion, bulk credential
import, cross-device scope negotiation beyond carrying `history_depth`
in the existing sync payload, and any write to the portal. Do not start
these.

---

## 9. Reference mockups

| Mockup id | Screen |
|---|---|
| `lcc_scrape_scopes_sweep_deep_item` | the three scopes (this file §1) |
| `lcc_overnight_run_pipeline` | the pipeline (§2) |
| `lcc_sync_screen_queue_and_health` | Sync screen (§6.1) |
| `lcc_deep_fetch_dialog` | deep fetch dialog (§6.3) |

Structure, order and labels follow the mockups; colours follow
`10-design-system.md`.

## 10. Copy

Sentence case. Exact strings: "Sweep all now", "Sync now", "Fetch
history", "Fetch more", "Fetch", "Queue for tonight", "Run now",
"Documents not fetched yet", "Skipped · unchanged", "History: recent
only", "History: full", "Paused", "Dormant", "Awaiting you".
