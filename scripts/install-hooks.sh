#!/usr/bin/env bash
# Installs the pre-commit secret scan. Run once per clone.
set -euo pipefail
cd "$(dirname "$0")/.."
cat > .git/hooks/pre-commit <<'HOOK'
#!/usr/bin/env bash
exec "$(git rev-parse --show-toplevel)/scripts/secret-scan.sh" --staged
HOOK
chmod +x .git/hooks/pre-commit
echo "pre-commit hook installed: scripts/secret-scan.sh --staged"
