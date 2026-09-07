# Build the sidecar on Windows and place it where tauri.conf.json bundles it.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# THE trick: browsers install INSIDE the playwright package, so PyInstaller
# (collect_all) sweeps Chromium into the bundle. Must be set before install.
$env:PLAYWRIGHT_BROWSERS_PATH = "0"

python -m venv .venv
.\.venv\Scripts\Activate.ps1

# A signed installer should not be built from whatever PyPI served that morning.
# requirements.lock.txt (pip freeze from a machine where a sync is known to
# work) wins when it exists. See QUESTIONS.md Q8.
if (Test-Path "requirements.lock.txt") {
    pip install -r requirements.lock.txt
} else {
    Write-Warning "no sidecar/requirements.lock.txt - building against unpinned dependencies"
    pip install -r requirements.txt
}
python -m playwright install chromium

pyinstaller --noconfirm --clean notice_scraper.spec

$dest = Join-Path $PSScriptRoot "..\src-tauri\resources\scraper"
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse "dist\notice_scraper" $dest
# the folder is tracked but empty in git; keep the placeholder alive
New-Item -ItemType File -Force (Join-Path $dest ".gitkeep") | Out-Null
Write-Host "Sidecar ready at $dest"
