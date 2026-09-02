# ITR notice tool

Logs into the income tax portal by itself, walks e-Proceedings, downloads
every notice PDF, and shows them in one dashboard. Missing due dates get an
"Ask Claude" button (build step 5).

## Run on your machine (recommended for now)

    ./run.sh

That is the whole thing, first run and every run after. It builds the venv,
installs the dependencies, downloads Chromium, creates .env, opens
http://localhost:8000 in your browser and starts the server. Anything already
done is skipped, so later runs start in about a second. Ctrl+C stops it.

    RUN_DEV=1 ./run.sh          # same, plus uvicorn --reload

Hit "Sync now". The "Download at most" box next to it caps how many new PDFs
that run fetches - handy for a quick test. Leave it blank for every notice.
A capped run stops cleanly and the next Sync picks up where it left off. The dashboard asks for your portal user ID and password the
first time; they are held in the server's memory for as long as it runs and
are never written to disk. Restarting the
server asks again, and the "Change login" link in the header forgets them.
Keep HEADLESS=false in .env for the first runs so you can watch the browser.

Run the tests with:

    python test_app.py

## Run with Docker (laptop or AWS Lightsail, identical)

    cp .env.example .env        # no portal credentials in here
    docker compose up -d        # dashboard on port 8000, log in through it

## The dashboard

Dark by default, light on the toggle. Ctrl/Cmd+K opens a command palette,
`s` starts a sync, `/` jumps to the filter box. During a sync the "Live
viewport" card shows what the browser is actually looking at, frame by frame -
except on the login and OTP screens, which are never captured.

## What is built vs pending

- [x] Step 1  FastAPI skeleton + SQLite schema
- [x] Step 2  Login: auto, secure-access checkbox, force-login (generic),
              OTP relay via dashboard, 15-min proactive re-login,
              wrong-password = hard stop (never retried)
- [x] Step 3  Scraper structure: tabs x sub-tabs, notice fields, PDF download,
              cache (never re-downloads a stored notice)
- [x] Step 4  Minimal dashboard: sync, live log, OTP box, notices table
- [x] Step 4b Access lock: APP_PASSWORD gates the dashboard, the API and the
              WebSocket (leave it empty only on localhost)
- [x] Step 4c Dashboard summary cards + year/name/missing-due-date filters
- [x] Step 4d Preview a stored notice in the browser (Download unchanged)
- [x] Step 5  Ask-Claude due date: "Ask Claude" on rows the portal left blank,
              answer cached forever, basis shown as a tooltip
- [x] Step 7  UI v2: dark-first design system, table-as-hero with countdown
              chips, AI cards, command palette, live viewport, pipeline bar
- [x] Step 6  Claude drafts a reply: summary, document checklist and an
              editable draft in a side panel. Always a draft - this tool
              never submits anything to the portal.

## First-run note

The two card parsers in app/portal/scraper.py were written from screenshots,
not the live DOM. Run once with HEADLESS=false, watch where it stumbles,
paste the log + a screenshot back into the chat, and they get tightened.

## Guardrails baked in

- Never clicks Submit/Respond/Appeal - read-only by construction.
- Never retries a rejected password (the portal locks accounts): the login is
  dropped and the dashboard asks again.
- The whole app sits behind APP_PASSWORD when that is set; unset, it warns
  loudly at startup and stays open (fine on localhost, not on a public URL).
- Portal credentials live in server memory only - not in .env, not in SQLite,
  never logged, never returned by any endpoint. .env holds only the Anthropic
  key and HEADLESS.
