# QUESTIONS — decisions for the human (answered AFTER the build)

The agent never blocks on these: it builds with the "Default used" and logs the
question here. Fill in `Your answer:` when you return; Pass 2 applies them.

---

## Q1 — Bundle identifier and publisher                      [OPEN]
- Phase:          0
- Question:       What identifier and publisher name should the Windows build ship under?
- Why it matters: The identifier keys the install path, the app-data directory
                  (where the database lives) and the update channel. Changing it
                  after the first release orphans an installed user's data.
- Default used:   `com.noticedesk.app`, publisher "Notice Desk", product name
                  "Notice Desk" (`src-tauri/tauri.conf.json`).
- Options:        A) keep it  B) your firm's reverse-domain id, e.g. `in.<firm>.noticedesk`
- Your answer:

---

## Q2 — Update feed location                                 [OPEN]
- Phase:          5
- Question:       Where does the updater manifest live?
- Why it matters: The endpoint is compiled into the installer. It cannot be
                  changed for machines already in the field except by an update
                  that itself came from the old endpoint.
- Default used:   GitHub Releases —
                  `https://github.com/OWNER/REPO/releases/latest/download/latest.json`
                  with `OWNER/REPO` left as a placeholder that must be filled
                  before the first tag.
- Options:        A) public GitHub Releases  B) a private static host you control
                  C) no auto-update, manual installers only
- Your answer:

---

## Q3 — NSIS install mode                                    [OPEN]
- Phase:          6
- Question:       Per-user install, or machine-wide?
- Why it matters: Per-user needs no admin prompt and keeps data under
                  `%LOCALAPPDATA%`; machine-wide needs elevation but suits a
                  shared office PC with several Windows logins.
- Default used:   `currentUser` (no admin prompt).
- Options:        A) currentUser  B) perMachine  C) both, user chooses
- Your answer:

---

## Q4 — Remembering the portal login                         [OPEN]
- Phase:          3
- Question:       Should the portal password ever be stored in the keychain?
- Why it matters: The backend was written so the portal login exists in memory
                  for one run and nowhere else. A keychain slot is safer than a
                  file but still turns "typed each time" into "held on the
                  machine".
- Default used:   Slot exists in the Rust layer but the UI never offers the
                  password — only the user ID — and nothing is stored unless the
                  user fills it in. Default is "ask each time".
- Options:        A) keep it off  B) offer it with a clear warning
                  C) offer it and pre-fill the login form on start
- Your answer:

---

## Q5 — Encrypting the archive                               [OPEN]
- Phase:          4
- Question:       Is SQLCipher worth an edit inside `app/db.py`?
- Why it matters: The database holds every notice PDF and every draft. Today it
                  is a plain file under app-data — readable by anything running
                  as that user. Encrypting it requires changing the connection
                  path in `app/db.py`, which the prime directives put off-limits,
                  and there is no `pysqlcipher3` wheel for Windows.
- Default used:   Plain SQLite, `TODO(sqlcipher)` in `run_backend.py` and a
                  NOTES.md entry, per `docs/04` Phase 4's own escape hatch.
- Options:        A) leave it plain  B) allow the `app/db.py` edit and ship
                  SQLCipher  C) encrypt the whole app-data folder with
                  Windows EFS / BitLocker instead
- Your answer:

---

## Q6 — The old web dashboard                                [OPEN]
- Phase:          1
- Question:       Should the sidecar keep serving `app/static/` at `/`?
- Why it matters: It still works on the loopback port, so the old UI is one URL
                  away — handy while comparing behaviour, but a second front
                  door onto the same data, gated only by the app password.
- Default used:   Left mounted (removing it would be an edit to `app/main.py`
                  outside the whitelist).
- Options:        A) leave it  B) drop the mount in a later pass
- Your answer:

---

## Q7 — What the window shows first                          [OPEN]
- Phase:          2
- Question:       Should the app start a sync by itself when it opens?
- Why it matters: A CA arriving in the morning wants today's position. But a
                  sync drives a real browser and can demand an OTP, so starting
                  one unasked is a surprise.
- Default used:   Never sync automatically. The window opens on the stored
                  register; Sync is always a deliberate click.
- Options:        A) never  B) prompt "run a sync?" on open
                  C) auto-sync if the last run is older than N hours
- Your answer:

---

## Q8 — Pinning the backend's Python dependencies         [OPEN]
- Phase:          6
- Question:       Which versions should a release build freeze?
- Why it matters: `requirements.txt` pins nothing, so every tag would bake
                  whatever PyPI served that morning into a code-signed
                  installer — including a Playwright whose portal selectors
                  behave differently.
- Default used:   Nothing invented. CI installs `requirements.lock.txt` when it
                  exists and prints a loud warning when it does not.
                  Generate it with `pip freeze > requirements.lock.txt` on the
                  machine where the scraper is known to work.
- Options:        A) commit a lock file from a known-good machine
                  B) pin `==` versions in requirements.txt itself
                  C) leave it floating and accept the risk
- Your answer:

---

## Q9 — The Windows code-signing certificate               [OPEN]
- Phase:          6
- Question:       Do you have an Authenticode certificate, and where does it live?
- Why it matters: Without one, Windows SmartScreen warns every user on every
                  install, and the app is indistinguishable from something
                  downloaded off a forum. The CI job imports a base64 PFX from
                  `WINDOWS_CERT` and writes its thumbprint into the bundle
                  config; with no secret set, the step is skipped and the
                  release is unsigned but still builds.
- Default used:   Skip signing when `WINDOWS_CERT` is empty.
- Options:        A) buy an OV/EV certificate and add the two secrets
                  B) ship unsigned and accept the SmartScreen warning
                  C) sign through a service (Azure Trusted Signing / SignPath)
- Your answer:

---

## Q10 — When to offer an update                           [OPEN]
- Phase:          5
- Question:       Should the app check for updates on every launch?
- Why it matters: It checks once at start-up and shows a banner; installing
                  relaunches the app, which would be rude mid-sync. There is
                  currently nothing stopping the user pressing it during a run.
- Default used:   Check on launch, offer a banner, never install unprompted.
- Options:        A) keep it  B) also refuse to install while a sync is running
                  C) check on a timer as well  D) manual "check for updates" only
- Your answer:

---
