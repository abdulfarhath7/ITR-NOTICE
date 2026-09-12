# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

pw_datas, pw_binaries, pw_hidden = collect_all("playwright")

a = Analysis(
    ["draftax_sidecar.py"],
    pathex=["."],
    binaries=pw_binaries,
    datas=pw_datas,
    hiddenimports=pw_hidden + ["app", "app.config", "app.portal", "app.portal.session",
                               "app.portal.scraper", "ingest", "ingest.protocol",
                               "ingest.parse", "ingest.session", "ingest.walk", "ingest.modules"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="draftax_sidecar",
    console=True,            # stdin/stdout ARE the protocol - keep the console handles
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="draftax_sidecar")
