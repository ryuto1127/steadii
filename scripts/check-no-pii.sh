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
#   bash scripts/check-no-pii.sh --range A..B   # scans a commit range's diff
#                                                 AND each commit MESSAGE body
#                                                 in that range
#   bash scripts/check-no-pii.sh --text FILE    # scans an arbitrary text file
#                                                 (e.g. PR title + body)
#
# Coverage by mode:
#   staged  — staged file diff only. The commit message isn't written yet at
#             pre-commit time, so message scanning is intentionally out of
#             scope here; the CI `--range` path covers messages instead.
#   --all   — tracked working-tree contents only (no messages — it's a
#             working-tree scan, not a history scan).
#   --range — file diff + every commit-message body in A..B. This is the path
#             CI uses on PRs, so message leaks (the PR #329 incident shape)
#             are caught before merge.
#   --text  — any text blob. CI feeds the PR title + body through this so a
#             leak pasted into the PR description is caught even when the file
#             diff and commit messages are clean.
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

# Initialize TMP early so the EXIT trap's reference can't trip `set -u`
# (unbound variable) on the --text / --range paths before TMP is assigned.
TMP=""
PATTERNS_FILE="$(mktemp -t pii-patterns-XXXXXX)"
trap 'rm -f "$PATTERNS_FILE" "$TMP" 2>/dev/null' EXIT

load_patterns "$UNIVERSAL_FILE" > "$PATTERNS_FILE"
if [ -f "$LOCAL_FILE" ]; then
  load_patterns "$LOCAL_FILE" >> "$PATTERNS_FILE"
fi

# Self-exclusion: this script + its self-check + AGENTS.md + the pattern
# files themselves legitimately contain example pattern text (regex source,
# rule docs, the SYNTHETIC leak token used by the self-check). Don't flag
# them. NOTE: this pathspec exclusion applies to the diff / --all / range-diff
# scans only — commit-message and --text scans read content directly, not via
# git pathspec, so the synthetic token (which only lives in the test FILE)
# can't sneak through a message or PR body.
WHITELIST=(
  ':!scripts/check-no-pii.sh'
  ':!scripts/test-check-no-pii.sh'
  ':!scripts/pii-patterns-universal.txt'
  ':!scripts/pii-patterns.local.txt'
  ':!AGENTS.md'
)

# Allowlist: shapes that LOOK like leaks but are app-critical / by-design.
# These are subtracted from hits.
ALLOWLIST_REGEX='noreply@|no-reply@|notifications@|@example\.|@test\.|@your-domain\.example|@u-tokyo\.ac\.jp|@u\.sample-univ\.example\.edu|@uni\.edu|@school\.edu|@somecorp\.com|@stripe\.com|recruiter@acme|\b(me|you|user|users|friend|friends|foo|bar|baz|abc|xyz|someone|anyone|test|tester|hello|admin|sample|alex|tanaka|stu|prof|recruiter|stripe|noreply|no-reply|notifications)@|user:pass@|username:password@|user:password@|\$\{[^}]+\}:\$\{[^}]+\}@'

# Running total of pattern hits across everything scanned this run. Each
# scanned source (diff, a commit message, a text file) adds to it so a hit
# anywhere fails the whole run.
hits=0

# scan_file <file> <source_label>
# Scans <file> against every loaded pattern minus the allowlist, prints any
# findings under the BLOCKED header (printed once, lazily, with wording that
# names <source_label>), and increments the global `hits`. Single source of
# truth for the scan logic so diff / message / text paths can't drift.
scan_file() {
  local file="$1" source_label="$2" pat matched
  [ -f "$file" ] || return 0
  while IFS= read -r pat; do
    [ -z "$pat" ] && continue
    matched=$(grep -niE --color=never "$pat" "$file" 2>/dev/null | grep -viE "$ALLOWLIST_REGEX" || true)
    if [ -n "$matched" ]; then
      if [ "$hits" -eq 0 ]; then
        echo "BLOCKED — PII / leak patterns detected${BLOCKED_WHERE}:" >&2
        echo "" >&2
      fi
      echo "  source: $source_label" >&2
      echo "  pattern: $pat" >&2
      echo "$matched" | head -3 | sed 's/^/    /' >&2
      echo "" >&2
      hits=$((hits + 1))
    fi
  done < "$PATTERNS_FILE"
}

# BLOCKED_WHERE makes the report header source-aware instead of hardcoding
# "in this diff" for every mode.
BLOCKED_WHERE=" in this diff"

case "$MODE" in
  staged)
    TMP="$(mktemp -t pii-scan-XXXXXX)"
    git diff --cached --unified=0 -- "${WHITELIST[@]}" > "$TMP"
    scan_file "$TMP" "staged diff"
    ;;
  --all)
    TMP="$(mktemp -t pii-scan-XXXXXX)"
    # Scan tracked working-tree contents
    git grep -nIE '.' -- ':!*.lock' ':!*.svg' ':!*-lock.json' "${WHITELIST[@]}" > "$TMP" || true
    BLOCKED_WHERE=" in the working tree"
    scan_file "$TMP" "working tree"
    ;;
  --range)
    RANGE="${2:?range required for --range mode (e.g. main..HEAD)}"
    BLOCKED_WHERE=" in this range (diff + commit messages)"
    # 1) The file diff for the range.
    TMP="$(mktemp -t pii-scan-XXXXXX)"
    git diff "$RANGE" --unified=0 -- "${WHITELIST[@]}" > "$TMP"
    scan_file "$TMP" "diff ($RANGE)"
    # 2) Each commit MESSAGE body in the range. The diff scan above never
    #    sees these — the PR #329 incident leaked via the message + PR body
    #    while the diff was clean.
    MSG_TMP="$(mktemp -t pii-msg-XXXXXX)"
    while IFS= read -r sha; do
      [ -z "$sha" ] && continue
      short="$(git rev-parse --short "$sha")"
      subject="$(git log -1 --format=%s "$sha")"
      git log -1 --format=%B "$sha" > "$MSG_TMP"
      scan_file "$MSG_TMP" "commit $short (\"$subject\")"
    done < <(git log --format=%H "$RANGE")
    rm -f "$MSG_TMP" 2>/dev/null || true
    ;;
  --text)
    TEXT_FILE="${2:?file required for --text mode (e.g. pr-meta.txt)}"
    if [ ! -f "$TEXT_FILE" ]; then
      echo "ERROR: --text file not found: $TEXT_FILE" >&2
      exit 2
    fi
    BLOCKED_WHERE=" in the provided text (PR title/body)"
    scan_file "$TEXT_FILE" "PR title/body"
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    echo "Usage: $0 [staged | --all | --range A..B | --text FILE]" >&2
    exit 2
    ;;
esac

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
