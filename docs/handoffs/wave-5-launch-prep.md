# Wave 5 — final α wave: auto-archive default-ON + launch ops + onboarding edge

**Read `project_wave_5_design.md` (in user memory) FIRST.** That file is the locked design spec. If anything in the handoff conflicts with the spec, the spec wins.

This is the final α wave before public launch. Single PR per `feedback_handoff_sizing.md` — bundles auto-archive + infra hardening + onboarding edges. Some launch-prep work happens on a parallel Ryuto-only track (CASA Tier 2 / Google verification / Stripe KYC) — that's NOT in this handoff.

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Most recent expected: PR #121 (Wave 3) or any sparring inline hotfix landing after. If main isn't there, **STOP**.

Branch: `wave-5-launch-prep`. Don't push without Ryuto's explicit authorization.

---

## Strategic context

- `project_secretary_pivot.md` — pivot vision
- `project_wave_5_design.md` — locked spec (THIS WAVE)
- `project_wave_2_home_design.md` — queue-card archetypes you'll be extending for Type D auto-action surfacing
- `feedback_self_capture_verification_screenshots.md` — engineer self-captures, never asks Ryuto
- AGENTS.md §12 / §13

---

## Feature 1 — Auto-archive Tier 1 low-risk emails (default ON, with safety ramp)

The boldest product change since the secretary pivot. **Tier 1 (≥95% confidence low-risk) emails are auto-archived and DO NOT appear in queue or inbox by default.** Steadii silently filters noise like a real secretary.

### Behavior

- New email arrives → existing W1 classifier runs → if `tier='low'` AND classifier confidence ≥ 95% → auto-archive
- The email is NOT surfaced in queue, NOT surfaced in inbox primary view
- Audit log captures every auto-action in `auto_action_events` (or extend existing `audit_log`)
- Weekly digest section: "Steadii hid these (X items)" with one-line summaries; click → review with restore option
- Inbox UI: small filter chip "Hidden ({n})" — click reveals hidden items inline; per-row restore button
- Search ALWAYS includes hidden items (no surprise misses on sender/subject search)

### Confidence threshold

The current W1 classifier doesn't ship a numeric confidence score per email — it ships a discrete tier. For Wave 5:

- Add a confidence number to the classifier output (0.0 - 1.0)
- Plumb through `agent_drafts` schema and downstream callers
- Auto-archive only fires at `confidence >= 0.95`
- The `tier_low` row in queue from W1 still surfaces emails that classifier graded `low` but **below** 0.95 confidence — those stay visible

If the classifier prompt doesn't already produce a numeric confidence, extend it to do so. Update the parsing.

### Safety ramp (CRITICAL — do not skip)

α users haven't validated classifier accuracy yet. Hard-launching default-ON could erode trust on false positives. The ramp:

- **α first 2 weeks (post-Wave-5 ship)**: Settings toggle defaults to **OFF**. Existing users see queue/inbox unchanged. New users opt-in via Settings.
- **2 weeks post-Wave-5**: monitor confusion / "I missed important email" reports
  - If <5% of users report a false-positive incident → flip default to ON for new users (existing users keep their preference)
  - If ≥5% report incidents → tune threshold up to 0.97 or pause flip
- **Public launch**: default ON for new users

Implement the ramp as a launch-darkly-style flag controlled in code (e.g. `AUTO_ARCHIVE_DEFAULT_ENABLED` env var, or a server-side boolean function). Not a feature flag service — an env-controlled boolean that ships OFF, gets flipped to ON via a follow-up tiny PR after the 2-week validation.

### Settings UI

`app/app/settings/page.tsx` — add Inbox section if not present:
- "Hide low-risk emails (Steadii auto-archives noise)" toggle
- Help text: "Steadii silently archives marketing / no-reply / transactional emails so they don't clutter your queue. You can review hidden items in the weekly digest or via the Hidden filter in Inbox."
- During α first 2 weeks: ships OFF, user opts in
- After 2 weeks: ships ON for new users, existing keep their preference
- Toggle change is forward-looking (doesn't retroactively un-archive)

### Audit + recovery

- `auto_action_events` table (or extend existing audit table — engineer's call) captures: timestamp, user_id, email_id, action ('auto_archive'), classifier_confidence, tier_at_time
- Home's Recent activity footer renders these as Type D cards (subtle, low contrast, no nudge — already supported by Wave 2 queue-card system)
- Weekly digest extends: "Steadii hid {n} this week" section with one-line summaries; click → review w/ restore
- Inbox UI: Hidden filter chip + restore action

### Learning signal

When a user manually restores or interacts with a previously-hidden item:
- Tag as `user_restored=true` on `auto_action_events`
- Feed into classifier as negative signal for that pattern (similar sender / subject / domain)
- Future similar items get downgraded confidence (won't auto-hide if drops below 0.95)

This makes auto-archive get *better per user* over time, not stuck at one-size-fits-all.

### Cost

Lower than current. Fewer items reach user surfaces (no draft generation for items that get auto-archived). Net savings of ~$0.001-0.005 per hidden item, ~$0.05-0.25/user/month at typical noise volume.

---

## Feature 2 — Pre-public infra hardening

Engineering, not feature. Pre-public-launch readiness.

### Monitoring + alerts

- Sentry error-rate floor: alert if error count exceeds X/hour over Y minutes (define X/Y per route during impl — start conservative: 10 errors/hour on `/api/chat/*`)
- Performance: P95 latency on key paths (chat input → response, inbox load, calendar fetch)
- Cron health: each cron has a heartbeat row in DB; alert if missed by >2x interval

If integrating with a metrics service, prefer free-tier Sentry features over adding new infra. If Sentry's free tier doesn't cover what's needed, document the gap rather than ship paid infra.

### Soak test

- Run synthetic load against staging (or a separate test Vercel project) for 1 hour
- Drive: 50 concurrent users × normal usage pattern (mix of inbox load / chat / calendar / settings)
- Confirm: no memory leaks, no DB connection pool exhaustion, no unbounded queue growth
- Document P95 / P99 / error rate from soak as launch-readiness baseline in `docs/launch/soak-results.md`

### Error budget

- Define max acceptable error rate (e.g. 1% over 24h)
- If exceeded post-launch → automatic rollback or feature gating
- Documented procedure in `docs/launch/incident-response.md`

### DB backup verification

- Confirm Neon point-in-time recovery works (do a dry-run restore to a staging branch)
- Document restore procedure
- Ensure backup retention policy meets compliance need (>14 days)

### Rollback plan

- Document rollback procedure for the last N PRs
- Verify Vercel "promote previous deployment" actually works (test once)
- DB migration rollback path documented for any reversible schema changes

---

## Feature 3 — Onboarding edge cases

Polish onboarding to handle pre-public messy paths:

- **Skip flow recovery**: user who skipped Step 2 (integrations) gets a soft re-prompt after first useful interaction ("Connect calendar to get more from Steadii?")
- **Gmail token expiry**: when refresh fails persistently (e.g. user revoked), surface clear "re-connect" CTA in queue + Settings, don't silent-fail
- **Step 2 profile completion**: gentle nudges in Settings if name / preferred-language not set
- **First-week activation tracker**: internal metric (NOT user-facing) — % of α users who have hit the queue's first card by day 3 / 7. Use to validate Wave 2's onboarding wait pattern is delivering value. Surface in `/app/admin/dashboard` or similar.

These are smallish — bundle for ship efficiency.

---

## What's out of Wave 5

- Auto-execute Tier 2 / 3 (snooze / calendar reschedule auto-confirm / short reply auto-send) — post-α #4
- Application tracker (cut entirely from α)
- Relationship CRM (post-α, gated on integrations)
- New marketing pages / landing rebuild (existing landing is sufficient)
- Mobile app shell (post-α)

---

## Parallel Ryuto-only track (NOT in this PR)

These need Ryuto's manual action, possibly with sparring help. They proceed in parallel to engineer 22's PR work:

- **CASA Tier 2 verification application** (~$540, ~2-week turnaround) — required to lift Google OAuth's 100-test-user cap. Should start 2-3 weeks before expected public launch
- **Google OAuth app verification submission** — separate from CASA. App: unverified → verified
- **Stripe Payouts KYC completion** (still pending) — must be done before public launch
- **Privacy / Terms final review** — verify aligned with secretary pivot
- **App Store / external listings** — Product Hunt / HN prep if any

Sparring helps draft application forms / prep verification artifacts; the form-submission acts are Ryuto's.

---

## Verification

For each feature, capture screenshots @ 1440×900 in BOTH locales (EN + JA). Per AGENTS.md §13.

Required captures:
- Settings → Inbox section with auto-archive toggle (default OFF state during α first 2 weeks)
- Inbox with `Hidden ({n})` filter chip when there are hidden items
- Inbox showing hidden items inline after chip click
- Weekly digest preview with "Steadii hid these" section
- Home Recent activity footer with Type D auto-archive entries
- Onboarding Step 2 skip-then-reprompt path
- Onboarding profile-incomplete nudge in Settings

If any of these surfaces don't have realistic data, use mock fixtures in dev preview routes (`/app/dev/...` style, see Wave 2/3 examples).

---

## Tests

- `pnpm typecheck`: 2 pre-existing handwritten-mistake-save errors stay
- `pnpm test`: stay above 856 / 856 pass
- `pnpm i18n:audit`: must be 0 findings (post-polish-19 CI gate)

New tests:
- `tests/auto-archive-classifier.test.ts` — confidence threshold gating, learning signal
- `tests/auto-archive-integration.test.ts` — full flow: email arrives → classifier → archive → audit log
- `tests/onboarding-skip-recovery.test.ts` — Step 2 skip + re-prompt timing
- `tests/cron-heartbeat.test.ts` — heartbeat row insertion + missed-tick detection

---

## Final report format

Per AGENTS.md §12:

1. **Branch / PR name**: `wave-5-launch-prep`
2. **Summary**: per-feature what shipped + what's behind the safety ramp flag
3. **Verification screenshots**: list above, all 1440×900, EN + JA pairs
4. **Tests added**: 4+ new test files
5. **Memory entries to update**: any spec contradictions or learnings; especially `project_wave_5_design.md` if the safety ramp logic deviates from spec
6. **Out-of-scope flags**: anything for post-α queue (auto-execute Tier 2/3 specifically — flag if specific code paths look ready for it)
7. **Launch checklist deltas**: anything Ryuto needs to do (CASA / Google verification / Stripe / etc.) that came out of implementation discoveries

---

## Sequence after this PR

1. Wave 5 PR merges to main
2. **2-week α validation window** — auto-archive default OFF, monitor for issues, gather user feedback
3. Tiny follow-up PR flips `AUTO_ARCHIVE_DEFAULT_ENABLED` to true (or whatever the impl uses)
4. Parallel Ryuto track completes: CASA submission → wait for verification → Google OAuth verification → public launch ready
5. Public launch

---

## LLM cost

Wave 5 features themselves don't add LLM cost (auto-archive is rule-based + uses existing classifier output; hardening is non-LLM; onboarding is UI). Net cost change: slightly negative per user (fewer drafts generated for auto-archived emails).

If cost increases unexpectedly, gate behind the existing `users.pre_brief_enabled` cost-gate pattern from Wave 3 — don't introduce a new gating mechanism.
