# QUESTIONS — decisions for the human

The agent never blocks on these: it builds with the "Default used" and logs the
question here. Fill in `Your answer:` when you return; the next pass applies it.

Rewritten 2026-09-04. Four questions from the previous list were settled by the
rewrite itself and are marked `[RESOLVED]` with what the code now does; the rest
carry over restated for the current design.

---

## Q1 — Bundle identifier and publisher                      [RESOLVED]
- Settled in code: `identifier` is `in.llc.app`, product name
  "Litigation Command Center" (`src-tauri/tauri.conf.json`). The keychain service name and
  `%APPDATA%\in.llc.app\` both follow it, so changing it after a release
  orphans an installed user's archive *and* its encryption key.
- Say so if you want a firm-specific id instead — it must change before the
  first installer goes out, not after.
- Your answer:

---

## Q2 — Shipping updates                                     [OPEN]
- Question:       How does a firm get version 0.2.0?
- Why it matters: The Tauri updater was removed in the rewrite. Today there is
                  no update path at all: the NSIS installer is the only route,
                  and every machine has to run it by hand.
- Default used:   No updater. Tag a release, CI builds a draft release with the
                  installer attached, you send the link.
- Options:        A) keep it manual  B) re-add the Tauri updater (needs a
                  signing key, a public feed URL, and both compiled into the
                  installer *before* the first release)  C) an MSI/Intune push
                  if the firms are managed
- Your answer:

---

## Q3 — NSIS install mode                                    [OPEN]
- Question:       Per-user install, or machine-wide?
- Why it matters: Per-user needs no admin prompt and keeps the archive under the
                  Windows profile; machine-wide needs elevation but suits a
                  shared office PC with several logins. Note the archive key is
                  per Windows user either way — a second login gets a second,
                  empty archive.
- Default used:   `currentUser` (no admin prompt).
- Options:        A) currentUser  B) perMachine  C) both, user chooses
- Your answer:

---

## Q4 — Remembering the portal password                      [OPEN]
- Question:       Should "remember my password" stay in the connect dialog?
- Why it matters: Ticking it writes the portal password into Windows Credential
                  Manager under `portal:<PAN>`. Anything running as that Windows
                  user can read it back. Unticked, it exists only for the run.
- Default used:   Offered, off by default, and the app can log in without it.
- Options:        A) keep it, off by default  B) remove the option entirely
                  C) keep it and pre-fill the login form on launch
- Your answer:

---

## Q5 — Encrypting the archive                               [RESOLVED]
- Settled in code: SQLCipher, via `rusqlite` with
  `bundled-sqlcipher-vendored-openssl` (nothing to install on Windows). The key
  is 32 random bytes generated on first launch and kept in Credential Manager.
- The consequence to put in onboarding: **lose the Windows profile and the
  archive is unrecoverable.** A backup story has to export the key too.
- Your answer:

---

## Q6 — The old web dashboard                                [RESOLVED]
- Settled by the rewrite: the desktop app runs no HTTP server, so there is no
  second front door. The legacy web tool still exists in `app/` for reference
  and is not built or shipped.
- Your answer:

---

## Q7 — What the window shows first                          [OPEN]
- Question:       Should the app connect or fetch by itself on launch?
- Why it matters: A CA arriving in the morning wants today's position, but a
                  fetch drives a real browser and can demand an OTP, so starting
                  one unasked is a surprise.
- Default used:   Never. The window opens on the stored register; Connect and
                  Fetch are always deliberate clicks.
- Options:        A) never  B) prompt "fetch now?" on open  C) auto-fetch if the
                  last run is older than N hours
- Your answer:

---

## Q8 — Pinning the sidecar's Python dependencies            [OPEN]
- Question:       Which versions should a release freeze?
- Why it matters: `sidecar/requirements.txt` is three unpinned lines. Playwright
                  in particular decides which Chromium ships and how the portal
                  selectors behave, so every tag currently bakes whatever PyPI
                  served that morning into a signed installer.
- Default used:   Nothing invented. CI installs `sidecar/requirements.lock.txt`
                  when it exists and warns loudly when it does not. Generate it
                  with `pip freeze > sidecar/requirements.lock.txt` on a machine
                  where a sync is known to work.
- Options:        A) commit a lock file from a known-good machine
                  B) pin `==` versions in `requirements.txt` itself
                  C) leave it floating
- Your answer:

---

## Q9 — The Windows code-signing certificate                 [OPEN]
- Question:       Do you have an Authenticode certificate, and where does it live?
- Why it matters: Without one, SmartScreen warns every CA on every install. CI
                  imports a base64 PFX from `WINDOWS_CERT`, writes its thumbprint
                  into the bundle config, and skips the whole step when the
                  secret is empty.
- Default used:   Skip signing when `WINDOWS_CERT` is empty; the installer still
                  builds, unsigned.
- Options:        A) buy an OV/EV certificate and add the two secrets
                  B) ship unsigned  C) sign through a service (Azure Trusted
                  Signing / SignPath)
- Your answer:

---

## Q10 — Where the proxy runs, and how firms get a token     [OPEN]
- Phase:          5
- Question:       Which host serves `proxy/main.py`, and how does a firm's token
                  reach the firm?
- Why it matters: This is the only always-on piece and the only thing holding
                  your Anthropic key. Its URL is typed into every install's
                  Settings, so moving it later means touching every machine.
                  `FIRM_TOKENS` is a comma-separated env var, which means adding
                  a firm is a redeploy and revoking one is the same.
- Default used:   `http://localhost:8787` in Settings, tokens by hand in `.env`.
                  Nothing is deployed.
- Options:        A) one small VM with TLS and a stable hostname
                  B) a container platform (Fly/Render/Cloud Run)
                  C) tokens issued from a real store instead of an env var, once
                  there is more than a handful of firms
- Your answer:

---

## Q11 — Metering and abuse                                  [OPEN]
- Phase:          5
- Question:       Should the proxy count or cap what a firm spends?
- Why it matters: One token, no rate limit, 16k-token drafts with adaptive
                  thinking, PDFs up to 25 MB — a leaked token bills you until
                  you notice. The code has the seam (`firm()` returns the token)
                  and no counter.
- Default used:   No metering, no cap.
- Options:        A) log per-firm token counts  B) a hard monthly cap per firm
                  C) leave it, revoke by redeploy if it ever happens
- Your answer:

---

## Q12 — The legacy web tool in `app/`                       [OPEN]
- Question:       Keep `app/`, `run.sh`, `test_app.py`, `Dockerfile` in this repo?
- Why it matters: `app/portal/*` is the origin of the sidecar's copy and the two
                  must not drift. Keeping it makes the diff obvious; splitting
                  the repos makes the desktop build smaller and stops anyone
                  running the old dashboard against real data by accident.
- Default used:   Kept, untouched, not built by anything.
- Options:        A) keep it  B) move it to its own repo and vendor
                  `sidecar/app/portal` from there  C) delete it once the desktop
                  app has run a real sync
- Your answer:

---

## Q13 — Two controls the old dashboard did not have    [OPEN]
- Phase:          3
- Question:       The static UI was rebuilt faithfully, but two things it never
                  needed have no home in it. Are these the right places?
                  (a) **Settings** — the proxy URL and the firm bearer token.
                  The web tool kept its Anthropic key in the server's `.env`, so
                  no screen existed. Without these two values `ask_due_date` and
                  `draft_response` fail with "add your firm token in Settings
                  first", so the desktop app has to ask for them somewhere.
                  (b) **Remember the portal password** — `portal_login` takes a
                  `remember` flag and writes the Windows Credential Manager only
                  when it is set. The old login card had no such control.
- Why it matters: Both are additions to a UI whose whole point is that it is the
                  one the office already knows. Anything put in the header
                  changes the first thing they look at.
- Default used:   (a) a small modal reached **only** from the ⌘K palette
                  ("Settings: proxy URL and firm token"), so the header is still
                  the old header, exactly.
                  (b) a "Remember on this PC" checkbox inside the login card,
                  beside the password, using the `.filters label` styling the
                  card already has. Unticked by default; the card's wording was
                  updated from "kept in this server's memory only" (no longer
                  true) to say what the keychain does.
- Options:        A) leave both as they are
                  B) put Settings back in the header as a gear, next to Log out
                  C) drop the checkbox and always remember (the app is on the
                     CA's own machine and the archive is encrypted anyway)
                  D) drop the checkbox and never remember (type it every launch)
- Your answer:

---

## Q14 — What the live viewport should show with no frames  [RESOLVED]
- Phase:          3
- Question:       The sidecar emits no `viewport` event, so the REC light never
                  lights. Should frames come back, or should the card go?
- Why it matters: "Live viewport" is the panel that makes a headless browser
                  legible to someone who does not trust it yet — the whole
                  reason it existed. Right now it shows the login stage while
                  signing in and then "No frames yet." for the rest of the run,
                  which is honest but is not what it is for. Frames cost a JPEG
                  per action over a pipe that already carries PDFs.
- Default used:   Kept, with the plumbing intact (`Watch`'s `frame` prop) and a
                  TODO. Nothing sent frames.
- Options:        A) emit frames from `sidecar/notice_scraper.py` and pass them
                     through `scraper.rs` — the web tool's behaviour
                  B) leave it as a phase/status card and rename it
                  C) delete the panel and give the run log the full width
- Your answer:    A — asked for directly ("it never shows frames, fix the
                  issue"). Built 2026-09-07: `_viewport_loop` in the sidecar,
                  same 1.5s / q45 as the web tool, same credential guard.
                  `scraper.rs` needed no change. **The sidecar must be re-frozen
                  for it to take effect** (`sidecar/build.sh` on this box,
                  `build.ps1` on Windows) — the frozen binary is what runs, not
                  the .py.

---

## Q15 — Where "last sync" comes from                    [OPEN]
- Phase:          2 / 3
- Question:       Should the Rust core write the `runs` table?
- Why it matters: `db.rs` creates `runs` (started, finished, status, message,
                  notices_new, pdfs_saved, skipped_cached) and nothing ever
                  inserts a row. The old dashboard's "Last sync …" line and the
                  report's run line both read it. They now read what the sidecar
                  said in its `sync_done` stats, remembered in `localStorage` —
                  which means it is per-window, not part of the record, and a
                  reinstall loses it.
- Default used:   `localStorage`, key `llc.last-run`.
- Options:        A) insert a row in `scraper.rs` on `sync_done` (and on a sync
                     error) and add a `last_run` command
                  B) leave it in `localStorage`
                  C) drop the `runs` table from the schema, since nothing uses it
- Your answer:

---

## Q16 — The rename to LLC / Litigation Command Center       [OPEN]
- Question:       Is "LLC" the brand you want, and does the identifier change
                  land before or after the first installer reaches a firm?
- Why it matters: Two things.
                  1. **"LLC" already means "limited liability company"** to
                     every accountant and lawyer who will see the tile. A firm
                     may read the icon as a company-registration tool. "LCC"
                     (Litigation Command Centre) or a non-acronym name avoids
                     the collision; the code change is a one-line brand string.
                  2. The identifier moved from `in.noticedesk.app` to
                     `in.llc.app`. That is the `%APPDATA%` folder holding
                     `archive.db` **and** the Credential Manager service name
                     holding the archive key. Any machine that already ran the
                     old build keeps its data at the old path and cannot see it
                     from the new build — no migration code was written.
- Default used:   Renamed everywhere, no migration shim. The only installed
                  build so far is the v0.1.1 CI artefact, which nobody has
                  data in, so a clean break is cheaper than a migration that
                  would have to be maintained forever.
- Options:        A) keep "LLC" and the clean break
                  B) keep the name, add a one-shot migration in `lib.rs`
                     (copy `%APPDATA%\in.noticedesk.app\archive.db` and
                     re-key it from the old keychain entry on first run)
                  C) different brand — say the word and it is a sed away,
                     provided it happens before an installer ships
- Your answer:
