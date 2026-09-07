#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export PLAYWRIGHT_BROWSERS_PATH=0
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install chromium
pyinstaller --noconfirm --clean notice_scraper.spec
rm -rf ../src-tauri/resources/scraper
cp -r dist/notice_scraper ../src-tauri/resources/scraper
echo "Sidecar ready at src-tauri/resources/scraper"
