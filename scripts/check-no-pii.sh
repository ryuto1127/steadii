#!/usr/bin/env bash
# Pre-commit / pre-push PII guard.
#
# Scans the diff (staged by default) for personal-content patterns that should
# never reach git per AGENTS.md §7a. Exits non-zero with a clear message on
# first hit so the leak is caught before it enters history.
#
# Usage:
#   bash scripts/check-no-pii.sh                # scans staged diff (pre-commit)
#   bash scripts/check-no-pii.sh --all          # scans whole working tree
#   bash scripts/check-no-pii.sh --range A..B   # scans a commit range
#
# Wire it into your local pre-commit hook (one-time setup):
#   ln -sf ../../scripts/check-no-pii.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
#
# Patterns are explicitly known-leak; extend when a new leak shape is
# identified. This is a deterrent, not a guarantee — judgment still required.

set -euo pipefail

MODE="${1:-staged}"

# Build the scan target into a tempfile.
TMP="$(mktemp -t pii-scan-XXXXXX)"
trap 'rm -f "$TMP"' EXIT

# Exclude this script + AGENTS.md from scanning — they intentionally
# CONTAIN the patterns (as the rule's pattern list / NG examples), so a
# naive scan would flag them every commit. The whitelist is narrow: only
# files where the pattern presence is by-design and reviewed.
WHITELIST=(
  ':!scripts/check-no-pii.sh'
  ':!AGENTS.md'
)

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
    exit 2
    ;;
esac

# Known-leak patterns — extend as new shapes surface.
# Anchored as case-insensitive substrings; one hit is enough to block.
PATTERNS=(
  # Maintainer's own identity that must never land in git
  '田中'
  'Tanaka'
  'ryuto\.2007'
  'admin-alt'
  # Recruiting case (アクメトラベル) — historical leak vector
  'アクメトラベル'
  'アクメとラベル'
  'acme'
  'acme-travel'
  'Acme Travel'
  'acme\.co\.jp'
  'acme\.example'
  'example\.com'
  'example-ats'
  'candidate-001'
  # Third-party leak (PR-notification quoted in docs)
  'Sample Sender'
  'sample-user'
  # Identifying profile combos for the maintainer
  'Vancouver Grade-12'
  'Grade 12, UToronto'
  'Grade 12, going to UToronto'
  'UToronto CS in September'
)

hits=0
for pat in "${PATTERNS[@]}"; do
  if grep -niE "$pat" "$TMP" > /dev/null 2>&1; then
    if [ "$hits" -eq 0 ]; then
      echo "BLOCKED — PII / leak patterns detected in this diff:" >&2
      echo "" >&2
    fi
    echo "  pattern: $pat" >&2
    grep -niE --color=never "$pat" "$TMP" | head -3 | sed 's/^/    /' >&2
    echo "" >&2
    hits=$((hits + 1))
  fi
done

if [ "$hits" -gt 0 ]; then
  cat >&2 <<'EOF'
See AGENTS.md §7a — no PII or third-party content in committed artifacts.
Replace with a generic placeholder (Tanaka Taro / Acme Travel /
alex@example.com / etc.) at the source, then re-stage. If a pattern is
flagged but you believe it's app-critical (e.g. utoronto.ca in the academic-
email allowlist), either rephrase to avoid the trigger or update this script
to whitelist that specific usage.
EOF
  exit 1
fi

echo "PII check: clean."
