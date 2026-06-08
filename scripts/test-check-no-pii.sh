#!/usr/bin/env bash
# Self-check for scripts/check-no-pii.sh.
#
# Proves the two coverage paths added to close the PR #329 gap:
#   1. `--text FILE` mode (used by CI for the PR title/body).
#   2. commit-message scanning in `--range A..B` mode (the exact incident
#      shape: clean file diff, leak in the commit MESSAGE).
# Plus a regression guard that a leak in the file CONTENT still fails.
#
# Dependency-free bash + a throwaway temp git repo. Uses ONLY the synthetic
# leak token below and clean synthetic text — never real PII (AGENTS.md §7a).
#
# Exit 0 iff every case behaves as expected; non-zero otherwise. CI-friendly.

set -uo pipefail

# Synthetic leak token. Trips the universal `@gmail.com` shape pattern and is
# NOT in the script's ALLOWLIST_REGEX. Do not substitute a "realistic" sample.
LEAK="jordan.lee.demo@gmail.com"
# Synthetic foreign-academic leak token. Trips the `.ac.<cc>` academic-email
# shape pattern; the domain is made-up ("some university") and the local part is
# not an allowlisted placeholder word, so it is NOT subtracted by ALLOWLIST_REGEX.
# Guards the harden-the-scanner change that catches `tanaka.pro@u-tokyo.ac.jp`.
ACADEMIC_LEAK="demo.person@some-univ.ac.jp"
# Clean synthetic line. `alex@example.com` is allowlisted/by-design.
CLEAN_LINE="Fix queue dedup; contact alex@example.com"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
SCRIPT="$REPO_ROOT/scripts/check-no-pii.sh"
PATTERNS="$REPO_ROOT/scripts/pii-patterns-universal.txt"

if [ ! -f "$SCRIPT" ] || [ ! -f "$PATTERNS" ]; then
  echo "FAIL: cannot locate scanner or patterns under $REPO_ROOT/scripts" >&2
  exit 2
fi

failures=0
report() {
  # report <pass:0/fail-expected> <actual-exit> <expect-zero:1|0> <label>
  local actual="$1" expect_zero="$2" label="$3"
  if [ "$expect_zero" -eq 1 ]; then
    if [ "$actual" -eq 0 ]; then
      echo "ok: $label (exit 0 as expected)"
    else
      echo "FAIL: $label (expected exit 0, got $actual)" >&2
      failures=$((failures + 1))
    fi
  else
    if [ "$actual" -ne 0 ]; then
      echo "ok: $label (non-zero exit as expected: $actual)"
    else
      echo "FAIL: $label (expected non-zero exit, got 0)" >&2
      failures=$((failures + 1))
    fi
  fi
}

TEXT_DIR="$(mktemp -d -t pii-selfcheck-text-XXXXXX)"
cleanup_text() { rm -rf "$TEXT_DIR" 2>/dev/null || true; }
trap cleanup_text EXIT

# ---- Case 1: --text CLEAN -> exit 0 -------------------------------------
printf '%s\n' "$CLEAN_LINE" > "$TEXT_DIR/clean.txt"
bash "$SCRIPT" --text "$TEXT_DIR/clean.txt" >/dev/null 2>&1
report "$?" 1 "--text clean input passes"

# ---- Case 2: --text LEAK -> non-zero -----------------------------------
printf 'PR body line\n%s\n' "$LEAK" > "$TEXT_DIR/leak.txt"
bash "$SCRIPT" --text "$TEXT_DIR/leak.txt" >/dev/null 2>&1
report "$?" 0 "--text synthetic-leak input fails"

# ---- Case 2b: --text foreign-academic LEAK -> non-zero -----------------
# Regression guard for the academic-email shape pattern (the
# tanaka.pro@u-tokyo.ac.jp dev-preview leak that previously slipped through).
printf 'attendee: %s\n' "$ACADEMIC_LEAK" > "$TEXT_DIR/academic-leak.txt"
bash "$SCRIPT" --text "$TEXT_DIR/academic-leak.txt" >/dev/null 2>&1
report "$?" 0 "--text synthetic foreign-academic leak fails"

# ---- Commit-message + diff cases in a throwaway repo --------------------
TMP_REPO="$(mktemp -d -t pii-selfcheck-repo-XXXXXX)"
cleanup_all() { rm -rf "$TEXT_DIR" "$TMP_REPO" 2>/dev/null || true; }
trap cleanup_all EXIT

GIT=(git -C "$TMP_REPO" -c user.email=ci@example.com -c user.name=ci -c commit.gpgsign=false)

"${GIT[@]}" init -q
mkdir -p "$TMP_REPO/scripts"
cp "$SCRIPT" "$TMP_REPO/scripts/check-no-pii.sh"
cp "$PATTERNS" "$TMP_REPO/scripts/pii-patterns-universal.txt"

# Base commit: clean content + clean message.
printf '%s\n' "$CLEAN_LINE" > "$TMP_REPO/notes.txt"
"${GIT[@]}" add -A
"${GIT[@]}" commit -q -m "chore: base commit with clean content"

# Range over only the single newest commit, so each case is independent and a
# leak baked into one case's history can't contaminate the next.
run_tip() {
  ( cd "$TMP_REPO" && bash scripts/check-no-pii.sh --range "HEAD~1..HEAD" >/dev/null 2>&1 )
}

# ---- Case 3: clean message + clean diff -> exit 0 -----------------------
printf 'second clean line; ping alex@example.com\n' >> "$TMP_REPO/notes.txt"
"${GIT[@]}" add -A
"${GIT[@]}" commit -q -m "chore: add another clean line"
run_tip
report "$?" 1 "--range clean message + clean diff passes"

# ---- Case 4: clean diff, LEAK in commit MESSAGE -> non-zero -------------
# (the exact PR #329 incident shape)
printf 'third clean content line\n' >> "$TMP_REPO/notes.txt"
"${GIT[@]}" add -A
"${GIT[@]}" commit -q -m "chore: clean diff but leak in message

Reported by ${LEAK}"
run_tip
report "$?" 0 "--range clean diff but synthetic leak in commit MESSAGE fails"

# ---- Case 5 (regression): LEAK in file CONTENT, clean message -> non-zero
printf 'leaked contact: %s\n' "$LEAK" >> "$TMP_REPO/notes.txt"
"${GIT[@]}" add -A
"${GIT[@]}" commit -q -m "chore: clean message but leak in file content"
run_tip
report "$?" 0 "--range synthetic leak in file CONTENT still fails"

# ---- Case 5b (regression): SCRUBBING a committed leak passes -------------
# A leak-scrub commit DELETES a line containing a leak (Case 5 just committed
# one). The range/diff scan must look at ADDED content only, so the '-' removal
# line is NOT flagged — otherwise every leak-scrub PR would fail on its own
# deletion (the exact reason this very PII fix could not be committed).
grep -vF "$LEAK" "$TMP_REPO/notes.txt" > "$TMP_REPO/notes.txt.tmp" \
  && mv "$TMP_REPO/notes.txt.tmp" "$TMP_REPO/notes.txt"
"${GIT[@]}" add -A
"${GIT[@]}" commit -q -m "chore: scrub the leaked contact line"
run_tip
report "$?" 1 "--range scrubbing a committed leak passes (added-only diff)"

# ---- Case 6 (regression): --range with NO second arg -> non-zero ---------
# Guards against the fail-OPEN where the EXIT cleanup trap's trailing `rm`
# (exit 0) masked the missing-arg guard's non-zero status.
bash "$SCRIPT" --range >/dev/null 2>&1
report "$?" 0 "--range with no second arg fails (does not exit 0)"

# ---- Case 7 (regression): --text with NO second arg -> non-zero ----------
bash "$SCRIPT" --text >/dev/null 2>&1
report "$?" 0 "--text with no second arg fails (does not exit 0)"

echo ""
if [ "$failures" -gt 0 ]; then
  echo "SELF-CHECK FAILED: $failures case(s) did not behave as expected." >&2
  exit 1
fi
echo "SELF-CHECK PASSED: all cases behaved as expected."
