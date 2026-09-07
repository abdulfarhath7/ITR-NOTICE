# QUESTIONS — decisions for the human

The agent never blocks on these: it builds with the "Default used" and logs the
question here. Fill in `Your answer:` when you return; the next pass applies it.

Rewritten 2026-09-04. Four questions from the previous list were settled by the
rewrite itself and are marked `[RESOLVED]` with what the code now does; the rest
carry over restated for the current design.

---

## Q1 — Bundle identifier and publisher                      [RESOLVED]
- Settled in code: `identifier` is `in.noticedesk.app`, product name
  "Notice Desk" (`src-tauri/tauri.conf.json`). The keychain service name and
  `%APPDATA%\in.noticedesk.app\` both follow it, so changing it after a release
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
