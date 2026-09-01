#!/usr/bin/env bash
# One command, every time: ./run.sh
#
# Creates the venv, installs dependencies, downloads Chromium, makes .env,
# opens the dashboard and starts the server. Everything already done is
# skipped, so the second run reaches "Starting server" in a couple of seconds.
#
# RUN_DEV=1 ./run.sh   adds uvicorn --reload (restarts on file changes).
set -euo pipefail

cd "$(dirname "$0")"

VENV=".venv"
PY="$VENV/bin/python"
MARKER="$VENV/.deps-ok"
HOST="127.0.0.1"
PORT="8000"
URL="http://localhost:$PORT"

# --- 0. is the port free? ----------------------------------------------------
if (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null; then
    exec 3<&- 2>/dev/null || true
    echo "Port $PORT is already in use - something is listening on $URL."
    echo "Stop it first (pkill -f uvicorn), then run ./run.sh again."
    exit 1
fi

# --- 1. virtualenv -----------------------------------------------------------
if [ ! -d "$VENV" ]; then
    echo "Creating virtualenv (first run only)..."
    if ! python3 -m venv "$VENV" 2>/dev/null; then
        # Ubuntu splits ensurepip into python3.X-venv. Rather than demand sudo,
        # build a pip-less venv and drive it with the system pip.
        echo "  (no ensurepip - building a pip-less venv, using the system pip)"
        rm -rf "$VENV"
        python3 -m venv --without-pip "$VENV"
    fi
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"

# pip lives either inside the venv or outside it, pointed at the venv python.
pip_install() {
    if "$PY" -m pip --version >/dev/null 2>&1; then
        "$PY" -m pip install "$@"
    else
        /usr/bin/pip --python "$PY" install "$@"
    fi
}

# --- 2. dependencies ---------------------------------------------------------
# The marker is rewritten after a good install and goes stale the moment
# requirements.txt is edited.
if [ ! -f "$MARKER" ] || [ requirements.txt -nt "$MARKER" ]; then
    echo "Installing dependencies (first run only)..."
    pip_install -r requirements.txt
    touch "$MARKER"
fi

# --- 3. chromium (the slow one - skipped once present) -----------------------
# A glob on the browser cache costs nothing; asking Playwright itself costs a
# second of node startup on every run, which is the whole 2-second budget.
BROWSER_ROOT="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
if ! compgen -G "$BROWSER_ROOT/chromium-*/chrome-linux*/chrome" >/dev/null; then
    echo "Downloading Chromium for Playwright (first run only, ~150MB)..."
    if ! playwright install chromium --with-deps; then
        echo "  (--with-deps needs sudo; retrying without the system packages)"
        playwright install chromium
    fi
fi

# --- 4. .env -----------------------------------------------------------------
if [ ! -f .env ]; then
    cp .env.example .env
    echo "Created .env from .env.example (holds ANTHROPIC_API_KEY + HEADLESS)."
    echo "  Portal login is typed into the dashboard - nothing to edit to start."
fi

# --- 5. open the dashboard ---------------------------------------------------
# Backgrounded: wait for the port to answer, then hand it to the browser.
# A headless machine has no xdg-open; that is fine, we ignore the failure.
(
    for _ in $(seq 1 40); do
        if (exec 3<>"/dev/tcp/$HOST/$PORT") 2>/dev/null; then
            exec 3<&- 2>/dev/null || true
            xdg-open "$URL" >/dev/null 2>&1 || true
            exit 0
        fi
        sleep 0.25
    done
) &

# --- 6. server ---------------------------------------------------------------
echo "Starting server on $URL  (Ctrl+C to stop)"
# exec: uvicorn becomes this process, so Ctrl+C reaches it directly.
if [ "${RUN_DEV:-0}" = "1" ]; then
    exec uvicorn app.main:app --host "$HOST" --port "$PORT" --reload
else
    exec uvicorn app.main:app --host "$HOST" --port "$PORT"
fi
