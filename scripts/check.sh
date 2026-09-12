#!/usr/bin/env bash
# Build, typecheck and lint every workspace. Exit 0 means the tree is green.
#
#   ./scripts/check.sh            everything
#   ./scripts/check.sh --fast     skip cargo clippy (the slow one)
#
# CI runs this on every push (.github/workflows/check.yml).
set -euo pipefail
cd "$(dirname "$0")/.."

fast=0
[ "${1:-}" = "--fast" ] && fast=1

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

PY=".venv/bin/python"
[ -x "$PY" ] || PY="python3"

step "secret scan"
./scripts/secret-scan.sh

step "frontend: tsc + vite build"
npm run --silent build

step "frontend: vitest"
npm run --silent test

step "rust: cargo check + tests"
( cd src-tauri && cargo check --quiet && cargo test --quiet )

if [ $fast -eq 0 ]; then
  step "rust: clippy"
  ( cd src-tauri && cargo clippy --quiet -- -D warnings )
fi

step "python: ruff"
"$PY" -m ruff check .

step "python: mypy"
"$PY" -m mypy

step "python: sidecar parser fixtures"
( cd sidecar && "../$PY" -m pytest tests -q )

step "python: compile"
"$PY" -m compileall -q sidecar/notice_scraper.py sidecar/draftax_sidecar.py sidecar/ingest proxy/main.py
[ -d relay ] && "$PY" -m compileall -q relay

printf '\n\033[32mcheck: green\033[0m\n'
