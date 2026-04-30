# Hotfix — Onboarding Skip → /app ↔ /onboarding redirect loop (α blocker)

## Symptom

Ryuto's dogfood (2026-04-30): test account in incognito + new Google account → reach onboarding Step 2 → click Skip → infinite redirect loop between `/app` and `/onboarding`. Section B of dogfood handbook is blocked.

## Hypothesis (most likely)

The skip server action stamps `users.onboardingIntegrationsSkippedAt = new Date()` then redirects to `/app`. The `/app/layout.tsx` reads `getOnboardingStatus`, which queries `users` table and reads `onboardingIntegrationsSkippedAt` to derive `integrationsStepCompleted`. The value should be `true` post-skip, but `/app/layout` keeps observing `false` (so it bounces to `/onboarding`), and `/onboarding/page.tsx` observes `true` (so it bounces back to `/app`).

For both routes to disagree on the SAME function with the SAME input, one of the following is happening:

1. **Neon connection pool / read replica lag** — write goes to primary, read on the next request hits a stale connection
2. **Next.js layout cache** — `/app/layout.tsx` has no `export const dynamic = "force-dynamic"`. Layouts can be statically optimized; the cached redirect from a previous render serves repeatedly
3. **React `cache()` / Server Component memoization spanning more than one request** (less likely)

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `hotfix-onboarding-skip-loop`. Don't push without Ryuto's explicit authorization.

## Fix — three defensive layers

### Layer 1 (most important): `revalidatePath` after the DB write in the skip action

`app/(auth)/onboarding/actions.ts:113-121` `skipIntegrationsStepAction`:

```ts
import { revalidatePath } from "next/cache";

export async function skipIntegrationsStepAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  await db
    .update(users)
    .set({ onboardingIntegrationsSkippedAt: new Date() })
    .where(eq(users.id, session.user.id));

  // Invalidate any cached layout / page that depends on onboarding state.
  revalidatePath("/app", "layout");
  revalidatePath("/onboarding");

  redirect("/app");
}
```

This nukes any Next.js-side cached render of /app's layout (and /onboarding's page) for the post-redirect navigation.

### Layer 2: `export const dynamic = "force-dynamic"` on `/app/layout.tsx`

Top of `app/app/layout.tsx` — add (above the export default):

```ts
export const dynamic = "force-dynamic";
```

This ensures the layout is never statically optimized, so every request re-evaluates `getOnboardingStatus` against the live DB. Same pattern is already on `app/app/page.tsx:21`.

While you're there, also add to `app/(auth)/onboarding/page.tsx` for symmetry.

### Layer 3: Sweep all server actions that mutate state then redirect

Same race could exist in other flows. Quick grep:

```
grep -rn "redirect\(" app/\(auth\)/onboarding/actions.ts \
  app/app/admin/waitlist/actions.ts \
  app/app/settings/billing/cancel/actions.ts
```

For each action that does `await db.update(...) ... redirect(...)`, add `revalidatePath` for the destination's layout BEFORE the redirect. List file:line of any other actions you patched in your final report.

Defer the broader sweep across `lib/agent/*` server actions for post-α — those don't bounce between auth-gated layouts in ways that would loop visibly.

## Verify

- Reproduce Ryuto's flow: incognito + new test-user Google account → /onboarding Step 2 → Skip → lands on /app cleanly (no loop)
- Open DevTools Network during the test — should see one `POST /onboarding` (action) → `303` redirect to `/app` → `200` for /app. NO subsequent redirect back to /onboarding.
- Sign out + sign in fresh again with the same account → /app/layout sees `integrationsStepCompleted = true`, doesn't redirect to /onboarding
- Manually visit /onboarding → page detects complete → redirects to /app (one-way, no loop)

If the loop persists after Layer 1 + 2: the issue is deeper (Neon read replica). Investigation steps:
- Add `console.log(JSON.stringify(status))` to `/app/layout.tsx` and `/onboarding/page.tsx` server-side, deploy preview, check Vercel logs during the loop attempt → see what each route observes
- If they observe different values: Neon serverless driver is the culprit. Workaround: switch to `@neondatabase/serverless`'s `Pool` with `connectionString` that pins to primary, or use the HTTP driver explicitly for write-after-read consistency

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- This is α blocker — ship as soon as verified, don't bundle other work

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- Likely "none" — this is a defensive infra fix that doesn't change locked decisions. If you discovered the Neon read-replica root cause, add a line under `project_steadii.md` "Infra" section noting the constraint (write-then-immediate-read on Vercel serverless requires `revalidatePath` or pinned-primary connection).

Plus standard report bits.
