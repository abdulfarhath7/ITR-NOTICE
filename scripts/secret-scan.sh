#!/usr/bin/env bash
# Rejects content that looks like a PAN, an Indian mobile number, a private
# key header, or a high-entropy value assigned to a secret-looking name.
# False positives are acceptable; a committed password is not
# (docs/07-security.md).
#
#   scripts/secret-scan.sh            scan the files git tracks
#   scripts/secret-scan.sh --staged   scan what is staged (pre-commit hook)
set -uo pipefail
cd "$(dirname "$0")/.."

mode="${1:-tracked}"
if [ "$mode" = "--staged" ]; then
  files=$(git diff --cached --name-only --diff-filter=ACMR)
else
  files=$(git ls-files)
fi

# Binary and generated content is skipped; fonts, icons, lockfiles.
files=$(printf '%s\n' "$files" | grep -v -E \
  '\.(png|ico|woff2?|ttf|jpg|jpeg|pdf|lock)$|package-lock\.json|Cargo\.lock' || true)
[ -z "$files" ] && exit 0

patterns=(
  # PAN: five letters, four digits, one letter. The fourth letter is the
  # holder type (P, C, H, F, A, T, B, L, J, G), which cuts most false hits.
  '\b[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]\b'
  # Indian mobile: optional +91 / 0, then a 10-digit number starting 6-9.
  '(\+91[ -]?|\b0)?[6-9][0-9]{9}\b'
  # Private key blocks.
  '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  # A secret-looking name assigned a long token-shaped literal.
  '(?i)(password|passwd|secret|api[_-]?key|token|bearer)[a-z0-9_]*\s*[:=]\s*["'"'"']?(?=[A-Za-z0-9+/_\-]*[0-9])[A-Za-z0-9+/_\-]{20,}'
)

status=0
while IFS= read -r f; do
  [ -f "$f" ] || continue
  for p in "${patterns[@]}"; do
    if hits=$(grep -n -P -- "$p" "$f" 2>/dev/null); then
      # Allowlisted shapes: the documented PAN example in the glossary and
      # the masked form used in the UI spec, neither of which is a real PAN.
      hits=$(printf '%s\n' "$hits" | grep -v -E 'AABCV1234K|AABCV••••K|ABCDE1234F' || true)
      [ -z "$hits" ] && continue
      echo "secret-scan: $f"
      printf '%s\n' "$hits" | sed 's/^/  /' | cut -c1-140
      status=1
    fi
  done
done <<< "$files"

if [ $status -ne 0 ]; then
  echo
  echo "secret-scan: refused. Mask or remove the values above (docs/07-security.md)."
fi
exit $status
