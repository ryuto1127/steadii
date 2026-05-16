#!/usr/bin/env bash
# Pre-commit / pre-push PII guard.
#
# Scans the diff (staged by default) for leak shapes that should never reach
# git per AGENTS.md §7a. Exits non-zero with a clear message on first hit so
# the leak is caught before it enters history.
#
# Patterns are loaded from two sibling files:
#   scripts/pii-patterns-universal.txt  ← COMMITTED, PUBLIC. Shape-based
#                                         patterns only (no real identities).
#                                         Catches e.g. any `@gmail.com`
#                                         address, API key shapes, JWT
#                                         tokens, private key headers,
#                                         connection strings with credentials.
#   scripts/pii-patterns.local.txt      ← GITIGNORED, LOCAL ONLY. The
#                                         maintainer's specific real names /
#                                         emails / companies. Mirror into
#                                         github secret `PII_PATTERNS_LOCAL`
#                                         for CI parity.
#
# The split exists because committing literal identities to the public-
# repo's pattern list would itself leak those identities — the scanner
# would become the leak.
#
# Usage:
#   bash scripts/check-no-pii.sh                # scans staged diff (pre-commit)
#   bash scripts/check-no-pii.sh --all          # scans whole working tree
#   bash scripts/check-no-pii.sh --range A..B   # scans a commit range
#
# Wire it into your local pre-commit hook (one-time setup):
#   ln -sf ../../scripts/check-no-pii.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit

set -euo pipefail

MODE="${1:-staged}"

# Resolve pattern files via git repo root — works whether the script is
# invoked directly, via the .git/hooks/pre-commit symlink, or from CI.
# Plain `dirname "$0"` returns the symlink's dir (`.git/hooks/`) when
# called via the hook, which is the wrong location for the pattern files.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  # Not inside a git repo; fall back to script's resolved physical dir.
  REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fi
UNIVERSAL_FILE="$REPO_ROOT/scripts/pii-patterns-universal.txt"
LOCAL_FILE="$REPO_ROOT/scripts/pii-patterns.local.txt"

if [ ! -f "$UNIVERSAL_FILE" ]; then
  echo "ERROR: universal patterns file missing: $UNIVERSAL_FILE" >&2
  exit 2
fi

# Load patterns: universal (always) + local (if present)
load_patterns() {
  local file="$1"
  # Strip comments + blank lines
  grep -v '^\s*#' "$file" 2>/dev/null | grep -v '^\s*$' || true
}

PATTERNS_FILE="$(mktemp -t pii-patterns-XXXXXX)"
trap 'rm -f "$PATTERNS_FILE" "$TMP" 2>/dev/null' EXIT

load_patterns "$UNIVERSAL_FILE" > "$PATTERNS_FILE"
if [ -f "$LOCAL_FILE" ]; then
  load_patterns "$LOCAL_FILE" >> "$PATTERNS_FILE"
fi

# Self-exclusion: this script + AGENTS.md + the pattern files themselves
# legitimately contain example pattern text (as rule docs / regex source).
# Don't flag them.
WHITELIST=(
  ':!scripts/check-no-pii.sh'
  ':!scripts/pii-patterns-universal.txt'
  ':!scripts/pii-patterns.local.txt'
  ':!AGENTS.md'
)

TMP="$(mktemp -t pii-scan-XXXXXX)"

case "$MODE" in
  staged)
    git diff --cached --unified=0 -- "${WHITELIST[@]}" > "$TMP"
    ;;
  --all)
    # Scan tracked working-tree contents
    git grep -nIE '.' -- ':!*.lock' ':!*.svg' ':!*-lock.json' "${WHITELIST[@]}" > "$TMP" || true
    ;;
  --range)
    RANGE="${2:?range required for --range mode (e.g. main..HEAD)}"
    git diff "$RANGE" --unified=0 -- "${WHITELIST[@]}" > "$TMP"
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    echo "Usage: $0 [staged | --all | --range A..B]" >&2
    exit 2
    ;;
esac

# Allowlist: shapes that LOOK like leaks but are app-critical / by-design.
# These are subtracted from hits.
ALLOWLIST_REGEX='noreply@|no-reply@|notifications@|@example\.|@test\.|@your-domain\.example|@u-tokyo\.ac\.jp|@u\.sample-univ\.example\.edu|@uni\.edu|@school\.edu|@somecorp\.com|@stripe\.com|recruiter@acme|\b(me|you|user|users|friend|friends|foo|bar|baz|abc|xyz|someone|anyone|test|tester|hello|admin|sample|alex|tanaka|stu|prof|recruiter|stripe|noreply|no-reply|notifications)@|user:pass@|username:password@|user:password@|\$\{[^}]+\}:\$\{[^}]+\}@'

hits=0
while IFS= read -r pat; do
  [ -z "$pat" ] && continue
  matched=$(grep -niE --color=never "$pat" "$TMP" 2>/dev/null | grep -viE "$ALLOWLIST_REGEX" || true)
  if [ -n "$matched" ]; then
    if [ "$hits" -eq 0 ]; then
      echo "BLOCKED — PII / leak patterns detected in this diff:" >&2
      echo "" >&2
    fi
    echo "  pattern: $pat" >&2
    echo "$matched" | head -3 | sed 's/^/    /' >&2
    echo "" >&2
    hits=$((hits + 1))
  fi
done < "$PATTERNS_FILE"

if [ "$hits" -gt 0 ]; then
  cat >&2 <<'EOF'
See AGENTS.md §7a — no PII or third-party content in committed artifacts.
Replace with a generic placeholder (Tanaka Taro / Acme Travel /
alex@example.com / etc.) at the source, then re-stage. If a pattern is
flagged but you believe it's app-critical (e.g. utoronto.ca in the academic-
email allowlist), either rephrase to avoid the trigger or extend the
ALLOWLIST_REGEX in this script to whitelist that specific usage.
EOF
  exit 1
fi

echo "PII check: clean."
