"""Build the sidecar and drop it where Tauri expects it.

    python packaging/build_sidecar.py

Tauri's `externalBin` resolves `binaries/notice-desk-backend` to a file whose
name ends in the Rust target triple, so the built executable is copied to
`src-tauri/binaries/notice-desk-backend-<triple>[.exe]`. The triple comes from
`rustc -vV`, which is what Tauri itself reads.
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = ROOT / "packaging" / "notice-desk-backend.spec"
OUT = ROOT / "src-tauri" / "binaries"


def target_triple() -> str:
    out = subprocess.run(["rustc", "-vV"], check=True, capture_output=True, text=True).stdout
    for line in out.splitlines():
        if line.startswith("host:"):
            return line.split(":", 1)[1].strip()
    raise SystemExit("could not read the host target triple from `rustc -vV`")


def main() -> int:
    triple = target_triple()
    dist = ROOT / "build" / "sidecar"
    work = ROOT / "build" / "sidecar-work"

    subprocess.run(
        [
            sys.executable, "-m", "PyInstaller",
            "--noconfirm",
            "--clean",
            "--distpath", str(dist),
            "--workpath", str(work),
            str(SPEC),
        ],
        check=True,
        cwd=ROOT,
        # PYTHONSAFEPATH keeps the repo root off sys.path: this very directory
        # is named `packaging/`, and PyInstaller imports the PyPI package of
        # that name. Analysis still finds `app` through the spec's pathex.
        env={**os.environ, "PYTHONSAFEPATH": "1"},
    )

    suffix = ".exe" if os.name == "nt" else ""
    built = dist / f"notice-desk-backend{suffix}"
    if not built.exists():
        raise SystemExit(f"PyInstaller did not produce {built}")

    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"notice-desk-backend-{triple}{suffix}"
    shutil.copy2(built, target)
    target.chmod(0o755)
    print(f"sidecar -> {target}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
