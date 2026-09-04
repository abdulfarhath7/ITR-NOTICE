# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the sidecar.

One file, no console window, everything the backend imports lazily pulled in by
name - uvicorn's protocol implementations and anthropic's httpx stack are found
only at runtime, so PyInstaller has to be told about them.

Chromium is deliberately NOT bundled (docs/02): the sidecar installs it into
app-data on first run.
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_all, collect_submodules

ROOT = Path(SPECPATH).resolve().parent

# app/main.py mounts StaticFiles(directory=app/static) at import time, so the
# tree has to be inside the bundle or the frozen sidecar dies before it binds a
# port. It also keeps the old web dashboard reachable on the loopback port.
datas = [(str(ROOT / "app" / "static"), "app/static")]
binaries = []
hiddenimports = []

# playwright ships a node driver + browser registry as package data
for package in ("playwright", "anthropic", "fpdf", "openpyxl"):
    package_datas, package_binaries, package_hidden = collect_all(package)
    datas += package_datas
    binaries += package_binaries
    hiddenimports += package_hidden

hiddenimports += collect_submodules("uvicorn")
hiddenimports += [
    "uvicorn.logging",
    "uvicorn.loops.auto",
    "uvicorn.loops.asyncio",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.lifespan.on",
    "websockets.legacy",
    "app",
    "app.main",
    "app.db",
    "app.config",
    "app.report",
    "app.response_pdf",
    "app.claude_client",
    "app.portal.session",
    "app.portal.scraper",
]

a = Analysis(
    [str(ROOT / "run_backend.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="notice-desk-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    # No console: the shell reads stdout over the pipe, and a second black
    # window next to the app would be the first thing a user reports.
    console=False,
    # console=False: an unhandled exception must not become a modal dialog
    # from an invisible process. stderr still reaches the shell's log.
    disable_windowed_traceback=True,
    icon=str(ROOT / "src-tauri" / "icons" / "icon.ico"),
)
