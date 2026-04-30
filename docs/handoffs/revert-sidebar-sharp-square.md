# Revert — PR #93 Fix 9 sidebar sharp square (restore rounded 1:1)

PR #93 Fix 9 removed the `rounded-md` / `rounded-lg` from sidebar nav icon containers + the landing hero sidebar mock, making them sharp squares. Ryuto's original "正方形" directive meant **1:1 aspect ratio** (which they already were) — NOT sharp corners. Restore the rounding.

This was supposed to be addendum to PR #94 (engineer 9) but didn't make it into that PR's diff. Ship as a small standalone revert.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `revert-sidebar-sharp-square`. Don't push without Ryuto's explicit authorization.

## Fix

Restore the rounded classes that PR #93 Fix 9 removed. Per PR #93's commit body, the changes were:

> Removed `rounded-lg` from the nav-active highlight pill and the link container; removed `rounded-md` from the landing hero's sidebar mock

Reverse:

### `components/layout/sidebar-nav.tsx`

Find the nav-active highlight pill + the link container (the two element classNames PR #93 stripped). Restore `rounded-lg` on both.

Quick check via `git show 556c7d2 -- components/layout/sidebar-nav.tsx` (the PR #93 commit) to see the exact diff and reverse cleanly.

### `components/landing/hero-animation.tsx:185`

Restore `rounded-md` on the sidebar mock icon container.

Same approach: `git show 556c7d2 -- components/landing/hero-animation.tsx` for the precise spot.

## Constraint preserved

Aspect stays **1:1 squares** (already `h-7 w-7` = 28×28; no shape stretching). Only the corner radius comes back. Diamond brand mark at the top of the sidebar (a separate element) is unaffected — that stays diamond.

## Verify

- `/app/*` — sidebar nav active item highlight has rounded corners again, still 1:1 square
- `/` (landing) — hero animation sidebar mock matches: rounded 1:1 square
- Diamond brand mark unchanged at top of sidebar
- No other layout shifts

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_pre_launch_redesign.md` — the bullet "Sidebar nav icon containers (revised 2026-04-29): sharp square (no `rounded-*`)" should be **removed** (or revised to: "Sidebar nav icon containers: rounded square, 1:1 aspect ratio (`h-7 w-7` + `rounded-lg`). Brand mark at top stays diamond.")

Plus standard report bits.
