# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

pw_datas, pw_binaries, pw_hidden = collect_all("playwright")

a = Analysis(
    ["notice_scraper.py"],
    pathex=["."],
    binaries=pw_binaries,
    datas=pw_datas,
    hiddenimports=pw_hidden + ["app", "app.db", "app.config",
                               "app.portal", "app.portal.session",
                               "app.portal.scraper"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="notice_scraper",
    console=True,            # stdin/stdout ARE the protocol - keep the console handles
    disable_windowed_traceback=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="notice_scraper")
