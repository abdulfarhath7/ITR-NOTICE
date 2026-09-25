# Context: Returns / Forms / Demands walk finishes empty and reports "Last run finished"

Read `CLAUDE.md`, `docs/05-ingestion.md`, `docs/06-source-interface.md` and `NOTES.md`
("Findings from the first live capture (2026-09-23)") before touching code.
Operating mode is the usual: autonomous, no questions, log decisions to
`QUESTIONS.md` / `DECISIONS.md`, errors to `NOTES.md`, tick `TASKS.md`.

---

## 1. Symptom (as observed by the user, Windows build)

Select any module other than e-Proceedings (Outstanding Demands, Filed Returns,
Filed Forms) → sidecar logs in → opens the right portal page → logs out within
seconds → Ingestion screen pill says **"Last run finished"**. No error banner.
No rows land in the module's table.

## 2. Root cause (confirmed by reading the tree at `7a50f7c`)

Two independent things combine:

### 2a. The module card reader could not see the cards (reader bug)

Path: `sidecar/draftax_sidecar.py::Runner.list` → `sidecar/ingest/modules.py::list_module`.

- `_open_module()` returns True as soon as *any* `div.card-container, mat-card, .card`
  exists, so "the page opened" is not evidence the reader works.
- `_walk_cards()` evaluates each card and requires an identifier
  (`acknowledgement_number` for returns/forms, `demand_reference_number` for demands).
  Cards without one hit
  `log(f"  {module}: card {i+1} has no identifier; labels seen: ...", "warn")`
  and `continue` — **no `header` is ever emitted**.
- Before `7a50f7c` the reader was the e-Proceedings `CARD_JS` (`.body1` → `.heading5`).
  Those classes do not exist on `/dashboard/itrStatus` (View Filed Returns) or the
  View Filed Forms pages, so every card had empty `fields` → every card skipped →
  `panel_done cards=0`.
- `7a50f7c` (2026-09-23 18:43 IST) replaced it with `MODULE_CARD_JS`
  (`mat-label.rightsideLabel / .contentLabel / .thirdColKey` → `.fieldVal / .leftSideVal /
  .thirdColValue`, paired in document order; `.leftColKey/.leftColVal` wrappers;
  ack-number regex on `innerText`; `A.Y.` from `.contentHeadingText`) and made the
  Forms walk two-level (`mat-card.eachMatCardStyle` → "View All" → `mat-card.subCard`).
  `NOTES.md` states this was verified **offline against captured HTML only, never in
  a live sweep**, and there is **no pytest fixture** for it (only
  `sidecar/tests/fixtures/{notice,proceeding}-cards.html` exist).
- **Demands** has never been captured (no account with a demand); `LABELS["demands"]`
  is a guess and `_open_module` menu path `Pending Actions → Response to Outstanding
  Demand` is unverified.

### 2b. An empty walk is indistinguishable from a good one (reporting bug)

- `sidecar` emits `panel_done cards=0 …` with `note=None`. Nothing in the protocol
  says "I saw N cards but could identify none of them".
- `src-tauri/src/ingest/portal_source.rs::list_work_items` returns `Ok(PanelResult{cards:0})`.
- `src-tauri/src/ingest/runner.rs::drive` records the run with
  `status = if sink.errors.is_empty() { "ok" } else { "incomplete" }` — the sink never
  saw a header, so `errors` is empty → `"ok"`. Job → `done`.
- `runner.rs::run` sets the sweep phase purely from the stop flag:
  `let status = if self.controls.stopping() { "stopped" } else { "done" }`. Job
  outcomes (failed / parked / retry-scheduled / empty) never feed it.
- `src/screens/ingestion.tsx` maps `phase === "done"` → "Last run finished".
  The only per-job signal is the run log (`ing.log`) and the `ingestion_runs` /
  jobs tables further down the screen.

Net effect: a module that reads nothing looks exactly like a module with nothing
to read. `docs/05` says "zero is a finding" — true for an absent panel, wrong for a
present panel whose cards could not be parsed.

## 3. Fix — scope

Two tasks. Do 3.1 first; it is the one that makes 3.2 testable.

### 3.1 Make an unreadable panel visible end-to-end

**Sidecar (`sidecar/ingest/modules.py`, `sidecar/ingest/protocol.py` if needed)**

1. In `_Walk` add `unidentified: int`. Increment it on the "has no identifier" branch
   instead of silently continuing. Keep the per-card warn log (it carries the
   `labels seen` list, which is the diagnostic).
2. `list_module` → `panel_done` gains `unidentified=walk.unidentified` and, when
   `walk.cards == 0 and walk.unidentified > 0`, sets
   `note = f"{walk.unidentified} card(s) rendered but none carried an identifier; the {module} reader does not match this page"`.
3. Same in `_walk_forms`: if a form type's "View All" renders `subCard`s but all are
   unidentified, count them.
4. `_open_module`: after the menu walk, also log the final `page.url` at info level
   (one line) so a wrong landing page is obvious in the run log.

Do not change the `header`/`next` handshake or any click path. The read-only guard
(`FORBIDDEN` in `app/portal/scraper.py`) stays untouched.

**Core (`src-tauri/src/ingest/source.rs`, `portal_source.rs`, `runner.rs`)**

5. `PanelResult` gains `unidentified: i64`. `portal_source.rs` reads
   `ev["unidentified"]` (default 0). `eri_source.rs` and the test mock return 0.
6. `runner.rs::drive`, `Ok(r)` arm: status becomes
   - `"failed"`-style **only if** the sidecar said so (unchanged),
   - `"incomplete"` if `!sink.errors.is_empty()` **or** `r.unidentified > 0 && r.cards == 0`,
   - `"ok"` otherwise.
   Add `"unidentified": r.unidentified` to the `gaps` JSON. When the new `incomplete`
   condition fires, push `r.note` into `state.last_error` (so the red banner shows)
   and `self.log("warn", …)` the same text.
7. `runner.rs::run`: compute the sweep status from job outcomes, not only the stop
   flag. Suggested: after workers finish, query the sweep's jobs
   (`repo/queue.rs` — add a small `outcome_counts(con, sweep_id)` if nothing fits);
   `stopped` if stop flag; else `done_with_gaps` if any job is `parked` / retry-scheduled
   / had an `incomplete` run; else `done`. Keep `st.phase` a string; add the new value.
8. `src/screens/ingestion.tsx` pill: `done` → "Last run finished",
   `done_with_gaps` → "Finished with gaps" (class `pill warning`), `stopped` unchanged.
   Nothing else in the UI changes. Update `src/api.ts`/types if `phase` is typed.

**Docs**

9. `docs/05-ingestion.md`: one paragraph under "Zero is a finding" distinguishing
   *absent panel* (count 0, status ok) from *unreadable panel* (cards > 0,
   identified 0, status incomplete, banner shown). `docs/15-known-bugs.md`: close
   the entry if one exists, else add-and-close.

### 3.2 Pin the module readers with fixtures

10. Create scrubbed fixtures from the 2026-09-23 capture in `data/portal-map/`
    (gitignored — read them, scrub PAN / name / ack numbers to synthetic values,
    keep every class and DOM shape):
    - `sidecar/tests/fixtures/return-cards.html` (View Filed Returns, ≥2 cards, one
      with a `.matStepStatus` timeline and no explicit "Current Status" label)
    - `sidecar/tests/fixtures/form-summary-cards.html` (≥2 `eachMatCardStyle`)
    - `sidecar/tests/fixtures/form-filing-cards.html` (≥2 `subCard`, incl. the
      `thirdColKey/thirdColValue` and `leftColKey/leftColVal` variants)
    If a capture is missing, write the fixture from the class list documented in
    `MODULE_CARD_JS` comments and note that in `NOTES.md`.
11. Extend `sidecar/tests/test_parse.py` following the existing `_cards()` pattern
    but evaluating `MODULE_CARD_JS` and asserting via `modules.map_fields()`:
    every fixture card yields a non-None `acknowledgement_number`; returns yield
    `assessment_year`, `return_type`, `filed_on`, `processing_status`; forms yield
    `form_label` (via the `extra` merge) and `filed_on`. Once these pass, flip
    `map_fields` confidence for those anchored fields from `"low"` to `"high"` for
    `returns` and `forms` only — `demands` stays `"low"`.
12. Demands: do **not** invent markup. Leave `TODO(blocked)` as is. Add one test that
    `LABELS["demands"]` keys match `intake_modules::DemandCard` field names
    (string-level check via a small `demand-labels.json` or a hardcoded list) so a
    rename on either side fails loudly.

## 4. Acceptance

- Run the sidecar against the test account with module = returns: run log shows
  `returns: page 1: N card(s)` followed by `header` traffic (visible as
  `progress kind=walk`), rows appear in `returns`, ingestion_runs status `ok`.
- Same for forms: form types enumerated, `View All` walked, rows in `filed_forms`.
- Temporarily break `MODULE_CARD_JS` (e.g. rename `fieldVal`) and run returns:
  banner shows the "rendered but none carried an identifier" note, run status
  `incomplete`, pill "Finished with gaps". Revert.
- `pytest sidecar/tests -q` green (needs Playwright Chromium).
- `cargo test` green; `npm run build` green.
- `sidecar/build.ps1` produces a fresh `draftax_sidecar` bundle — the Windows tester's
  exe **must** be rebuilt; a build older than `7a50f7c` still ships the broken reader.

## 5. Out of scope

- ERI engine, relay/lease, multi-worker, the 15-minute re-login `TODO(blocked)`.
- Any change to what is clicked on the portal.
- UI redesign beyond the one pill label.
