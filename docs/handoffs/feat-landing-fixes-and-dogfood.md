# Feat — Landing demo fixes + dogfood execution (engineer 16)

Two visual-fix items + a structured pre-α verification pass. Bundle is correct per `feedback_handoff_sizing.md` (0/4 split criteria; both items are landing/marketing surface, dogfood is verification of recently-shipped work).

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
git checkout -b feat-landing-fixes-and-dogfood
```

Branch: `feat-landing-fixes-and-dogfood`. Don't push without Ryuto's explicit authorization.

Read `AGENTS.md` first (especially §12 — final report MUST include "Memory entries to update", and **§13 — capture verification screenshots yourself via `preview_resize` + `preview_screenshot` at 1440×900 desktop viewport**).

---

## Item A — Voice demo motion: text streams IN from outside the chat box

### Bug

Engineer 15 (PR #102) implemented a "snake motion" inside `components/landing/voice-demo.tsx`, but the character spans live INSIDE the chat-box container which has `overflow-hidden`. Result: characters never visibly originate from outside the box. Ryuto's spec (clarified 2026-04-30) is:

1. Text/voice flows in from **outside** the chat box (visible left of it).
2. Streams **into** the chat box.
3. After entering, settles in place.

### Fix

The character animation needs to start at a position visibly LEFT of the chat box, then animate inward across the box's left edge. Approaches (engineer picks based on layout consequences):

- **Option 1 (preferred)**: lift the character span layer OUT of the `overflow-hidden` chat box. Position the chars absolutely on a parent layer that spans wider than the chat box. Animate `translateX` from a negative value (e.g. -30vw) toward the chars' final positions inside the chat box. The chat box itself stays styled as before; the chars just visually traverse from outside-left into it. Use `z-index` to ensure the box's border + background reads as a destination ("settling inside").
- **Option 2**: keep chars inside the chat box but allow a temporary `overflow: visible` window during the snake-in phase, then clip back to `overflow: hidden` once settled. CSS-only with `clip-path` can stage this without a JS toggle.

The "settled" final state should match what's already in place (chars laid out left-aligned inside the chat box, cursor blink at the end, holographic border idle).

Animation timing stays roughly the same (6s loop, frames 4-5s for the snake-in). The visible difference: the user can see characters approaching from the left BEFORE they enter the box, instead of suddenly appearing inside.

### Verification (per AGENTS.md §13)

- `preview_resize` to 1440×900 → `preview_screenshot` at multiple animation frames (use `preview_eval` to pause / step the CSS animation if helpful via `document.querySelectorAll('.voice-demo-char').forEach(...)`).
- Confirm screenshot: at the start of the snake phase, at least one character is visibly LEFT of the chat box's left border.
- Attach 2-3 screenshots in the PR body (entry phase, mid-flow, settled).

---

## Item B — Hero animation language consistency (i18n)

### Bug

`components/landing/hero-animation.tsx` mixes hardcoded EN and JP strings:

- Line 361: `Extracting syllabus…` (EN)
- Lines 371-373: `取り込みました。シラバス: Math II (Linear Algebra). スケジュール項目: 7件` (JP)

On the EN landing (`mysteadii.com` default locale), the JP block surfaces inappropriately. Same issue in reverse on the JP landing.

### Fix

1. Audit `components/landing/hero-animation.tsx` for ALL hardcoded user-visible strings (EN + JP). Likely there are more than just the two flagged lines.
2. Move every string to `lib/i18n/translations/en.ts` + `lib/i18n/translations/ja.ts` under a stable key path (e.g. `landing.hero_animation.extracting`, `landing.hero_animation.extracted_summary`).
3. Replace the hardcoded strings with `t()` calls via `useTranslations("landing.hero_animation")` (or whatever scope makes sense).
4. Audit `components/landing/voice-demo.tsx` and the other `app/(marketing)/_components/*.tsx` for the same pattern — landing surface should be 100% locale-aware after this PR.

The JP locale should keep semantically equivalent JP strings; the EN locale gets the EN versions. Don't translate the EN ones to JP-influenced phrasing — write idiomatic versions per locale (e.g. EN: `Imported. Syllabus: Math II (Linear Algebra). 7 schedule items.`).

### Verification

- `preview_resize` to 1440×900 → load `/` (default EN) → `preview_screenshot` of the hero scrolled-into-view.
- Switch locale via the locale toggle (`preview_click` on the toggle) → `preview_screenshot` of the hero in JP.
- Both screenshots should be 100% in their respective language. Attach both to PR.

---

## Item C — Pre-α dogfood execution (sections A, B, C, D, E, F, G, I, J, K, L, M, N)

Per memory `feedback_dogfood_engineer_vs_human.md` (saved 2026-04-30), the engineer runs the system-functionality sections of `docs/dogfood/dogfood-resources.md`. Section H (visual polish, subjective) stays with Ryuto and is skipped here.

The dogfood handbook is at `docs/dogfood/dogfood-resources.md` (untracked locally — it's a working doc; commit any annotations alongside this PR).

### How

For each of A, B, C, D, E, F, G, I, J, K, L, M, N:

1. Read the section's checklist in the handbook.
2. Run each check using the appropriate tool:
   - For UI flows: `preview_*` MCP at 1440×900.
   - For DB shape checks: read the schema + run a probe query via the Bash `psql` flow if a connection string is available; otherwise note "needs DB access" and skip.
   - For Sentry / Vercel logs: read the dashboard via WebFetch / API if you have credentials documented; otherwise note "needs Ryuto" and skip.
   - For Lighthouse: drive via `preview_eval` running `lighthouse` in DevTools mode if possible, else note as "Ryuto runs locally."
3. Record per-check result: `pass` / `fail` / `skip` with a one-line note. For `fail`, capture the screenshot or log excerpt as evidence.
4. After completing all sections, summarize in the handbook's "Issues found" block at the bottom + commit the annotated handbook with the PR.

### Auth

For auth-gated paths, use `preview_eval` to set the dev session cookie if Ryuto has documented one in `.env.local` or similar. If not, sign in via the dev login form (`preview_fill` on `/login`). If neither works, skip those sections with `needs auth setup` and surface in the report.

### Output to share with sparring

Per the handbook's "Output to share with sparring" section, the engineer's final report should include:
- Per-section result table (A through N excluding H, pass/fail/skip)
- Top-3 most concerning issues found, with severity (blocker / nice-to-have / cosmetic)
- Memory entries that need updating (per AGENTS.md §12)

If anything is too ambiguous to call "pass" or "fail," mark `INVESTIGATE` and surface in the report — sparring will judge with Ryuto's input.

---

## Out of scope

- Section H (visual polish) — Ryuto's eye, not engineer's
- Cleanup SQL at the bottom of the handbook — sparring runs it AFTER engineer 16 + Ryuto's H both complete (DB writes need extra caution, sparring handles)
- Any out-of-scope fixes discovered during dogfood that aren't handbook-related — flag in report, don't silently expand

## Constraints

- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Locale-aware strings: EN and JP both fully covered; no fallback drift
- Voice demo animation timing should stay close to current 6s loop (don't over-extend)

## Verification plan

1. `pnpm typecheck` — clean (modulo pre-existing 2 errors)
2. `pnpm test` — green (modulo pre-existing 1 failure)
3. **Self-captured screenshots** (per §13):
   - Voice demo: 3 frames showing the outside → in → settled motion
   - Hero animation: EN locale + JP locale showing locale-consistency
4. Dogfood per-section results table populated in the PR body

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_voice_input.md` — if the voice demo redesign meaningfully changes the locked UX spec, note the deviation.
- `project_steadii.md` — if dogfood surfaces phase-state issues (e.g. a "shipped" item is actually broken), flag the entry.
- Any new tech-debt issues surfaced during dogfood get added to the polish backlog in `project_voice_input.md` or `project_steadii.md` as appropriate.

Plus the dogfood per-section result table (in the PR body, not the handbook itself — handbook stays a template).
