# Polish — Critical-path findings before α invite (6 fixes, 1 PR)

Sparring-side critical-path code review (2026-04-29) surfaced 9 findings; 3 turned out to be false alarms after deeper verification. The remaining 6 are bundled here as a single pre-α polish PR. Order roughly by user-visibility: onboarding > admin > internal consistency > polish.

α target: 10 JP students, Apr-May 2026. All 6 must land before invitations go out per Ryuto's directive.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `polish-critical-path-pre-alpha`. Don't push without Ryuto's explicit authorization.

A parallel cleanup PR (`cleanup-notion-dead-modules`, scope reduced to option 1) may be in flight on `cleanup-notion-dead-modules` branch — different files, no overlap.

---

## Fix 1 — CRITICAL — Onboarding page is English-hardcoded

### Symptom

`app/(auth)/onboarding/page.tsx` renders step titles + progress dots in English regardless of user locale. The JP α cohort lands on "Connect Google" / "Add more sources" instead of localized strings — first impression breaks the JP/EN parity promise.

### Evidence

- `page.tsx:14` — `const TOTAL_STEPS = 2;` (fine, just a number)
- `page.tsx:57` — Step 1 title hardcoded English (likely "Connect Google")
- `page.tsx:86` — Step 2 title hardcoded English (likely "Add more sources" / "Optional integrations")
- No `getTranslations()` import or `t()` call usage anywhere in the file

### Fix

Localize via `next-intl`'s server-side `getTranslations` API (the rest of the app already uses this pattern — `grep -rn "getTranslations" app/` for examples). Add the new keys to `lib/i18n/translations/en.ts` and `lib/i18n/translations/ja.ts`. Suggested key namespace: `onboarding.step1_title`, `onboarding.step2_title`, `onboarding.step1_description`, `onboarding.step2_description`, plus any other hardcoded strings the file currently has.

JA copy suggestions (Ryuto can revise):

- Step 1 title: "Google を接続"
- Step 1 description: "Steadii はメール / カレンダー / タスクから学業の文脈を読みます。"
- Step 2 title: "他のサービス（任意）"
- Step 2 description: "Microsoft 365 / iCal / Notion を後でも追加できます。"

Verify the page renders correctly in both locales — switch `Accept-Language` header or `users.preferred_locale` for testing.

### Verify

- Sign in fresh with `Accept-Language: ja` → step titles in JA
- Sign in with `Accept-Language: en` → English unchanged
- ProgressDots renders both states, no layout shift

---

## Fix 2 — HIGH — `/app/admin` doesn't link to `/app/admin/waitlist`

### Symptom

`/app/admin/waitlist` exists with the full approve-and-auto-email flow (`approveWaitlistAction` → Stripe Promotion Code + Resend bilingual email). But the main `/app/admin/page.tsx` doesn't link to that subroute, so Ryuto can't discover the approval UI from the admin dashboard — must remember the URL and type it.

### Fix

Add a prominent link / card to the waitlist subroute in `app/app/admin/page.tsx`. Suggested placement: near the existing "Invite codes" or top-of-page section. Show the count of `waitlist_requests.status = 'pending'` as a badge so Ryuto sees inbound pressure at a glance.

```tsx
<Link href="/app/admin/waitlist" className="...">
  <span>Waitlist requests</span>
  <Badge>{pendingCount} pending</Badge>
</Link>
```

(Pseudo — match the existing Tailwind / shadcn shape on the admin page.)

### Verify

- Sign in as admin → `/app/admin` shows the waitlist link with pending count
- Click → lands on `/app/admin/waitlist` with the approval UI
- Approve a test row → email fires (mock or real, your call)

---

## Fix 3 — HIGH — Access redirect param naming inconsistent

### Symptom

`lib/auth/config.ts:138` redirects pending waitlist users with `?already-submitted=1`, while denied users go through `?reason=denied`. Two different patterns, makes downstream consumption (`/access-pending` and `/access-denied` page reads) brittle.

### Fix

Standardize on `?reason=<state>`. Suggested values: `pending`, `denied`, `not-requested`. Update both:

- `lib/auth/config.ts:138` (and the surrounding redirect logic in the signIn callback) to emit the new param shape
- `/access-pending/page.tsx` (line ~15 reads the current `?already-submitted` param) — switch to `?reason=pending`
- `/access-denied/page.tsx` — already uses `?reason=` per the existing convention; just verify it stays consistent

Don't break the existing access-denied flow during the change.

### Verify

- Submit a waitlist request, sign in before approval → redirects with `?reason=pending` to `/access-pending`, page renders correctly
- Sign in without ever submitting → `?reason=not-requested` to `/access-denied`
- Sign in after explicit denial → `?reason=denied` to `/access-denied`

---

## Fix 4 — MEDIUM — Currency picker lock UX not surfaced

### Symptom

`lib/billing/currency.ts:24-39` `resolveCheckoutCurrency` persists the user's currency choice on first checkout. After that, the user can't switch (Stripe is mono-currency per subscription, hard limit). The billing UI doesn't surface this lock — user might wonder why the currency selector is gone or stuck.

### Fix

In `app/app/settings/billing/page.tsx`, when `users.preferred_currency` is set, display a small caption below the price line explaining the lock. Suggested copy:

- EN: "Pricing locked to {USD/JPY} for this account. Reach out to support to change currency."
- JA: "このアカウントは {USD/JPY} 表記で固定されています。変更はサポートまでご連絡ください。"

Caption should be muted / `text-small text-muted` shape, not a primary surface.

### Verify

- Fresh user (no `preferred_currency`) → no caption, currency picker behaves as today
- Existing user with persisted currency → caption shows in their currency

---

## Fix 5 — MEDIUM — Google Tasks scope loss detection gap

### Symptom

`app/app/calendar/page.tsx:115` filters errors with a broad regex `/scope|not connect/i.test(tasksRes.error)`. If the user's Google Tasks scope is silently revoked (e.g. they deauthorized in Google account settings), the calendar page just shows no tasks and no warning — they don't know they need to re-grant.

### Fix

Either:

- (a) Tighten the error detection to specifically catch scope-revoked errors (Google API returns `403 PERMISSION_DENIED` with an `errors[].reason: "insufficientPermissions"` shape) and surface a banner: "Google Tasks disconnected — reconnect to see your tasks here."
- (b) Add a periodic scope-health probe (cron-side or page-side) that ping-tests the Tasks scope and writes a status flag to the user row. Surface the flag.

Option (a) is simpler and α-sufficient. Option (b) is more robust but adds complexity. Pick (a) unless you have time for (b).

### Verify

- Manually revoke Google Tasks scope on a test account → next page load shows the "disconnected" banner with a reconnect CTA
- Re-grant scope → banner disappears, tasks appear

---

## Fix 6 — MEDIUM — Ingest-sweep cron cooldown bypass mechanism undocumented

### Symptom

`app/api/cron/ingest-sweep/route.ts:15-19` comment says "auto-ingest's 24h cooldown was designed for the page-render path; cron bypasses". But the code at line 35+ just calls `ingestLast24h(userId)` without any visible bypass logic. Reader has to dig into `ingestLast24h` to find where the cooldown is checked / skipped.

### Fix

Add a 1-2 line code-level reference in the comment:

```
// auto-ingest's 24h cooldown was designed for the page-render path; cron
// bypasses it. The bypass lives in `ingestLast24h(userId, { source: "cron.sweep" })`
// — when source is "cron.*", the function skips the cooldown check at line N.
```

Verify the actual mechanism is correct (read `ingestLast24h` to confirm) — if the bypass mechanism doesn't exist as the comment claims, that's a deeper bug; surface as a follow-up but don't try to fix in this PR.

### Verify

- Code-only fix; no runtime behavior change
- `pnpm typecheck` passes

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization

## Verification plan

After implementing all 6:

1. `pnpm typecheck` — clean
2. `pnpm test` — all green
3. Manual smoke per fix-section verify steps
4. Lighthouse `/` + `/app` (signed in) — no perf regression vs current main

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_decisions.md` "α access control flow": if the redirect param naming changed, note the new convention there for future reference (or write "none" if memory is silent on param details — current memory only says the redirect happens, not the exact param shape)
- `project_steadii.md` α launch readiness: bump status to reflect critical-path fixes shipped
- Otherwise "none"

Plus standard report bits (branch, commits, verification log, deviations).

The next work unit after this is Ryuto's α launch ops (Stripe / QStash / Sentry / smoke / invite codes — Phase 1-5 of the ops checklist) followed by α invitation send.
