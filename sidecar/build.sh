#!/usr/bin/env bash
# Freeze the ingestion sidecar with Chromium inside it, and place it where
# tauri.conf.json bundles it. Linux/macOS for development; build.ps1 is the
# Windows counterpart CI uses.
set -euo pipefail
cd "$(dirname "$0")"
export PLAYWRIGHT_BROWSERS_PATH=0
python3 -m venv .venv && source .venv/bin/activate
if [ -f requirements.lock.txt ]; then
  pip install -r requirements.lock.txt
else
  echo "warning: no sidecar/requirements.lock.txt - building against unpinned dependencies" >&2
  pip install -r requirements.txt
fi
python -m playwright install chromium
pyinstaller --noconfirm --clean draftax_sidecar.spec
rm -rf ../src-tauri/resources/sidecar
cp -r dist/draftax_sidecar ../src-tauri/resources/sidecar
touch ../src-tauri/resources/sidecar/.gitkeep
echo "Sidecar ready at src-tauri/resources/sidecar"
