# Engineer-36 — Regenerate AI drafts admin action (re-run L2 over open drafts)

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md`

Reference shipped patterns:

- `lib/agent/email/reclassify.ts` — close analogue: per-user admin sweep, per-row UPDATE + audit. **L1 only**.
- `lib/agent/email/l2.ts` — `processL2(inboxItemId)` is the INSERT path. We need an UPDATE-in-place sibling.
- `lib/agent/email/classify-deep.ts` — `runDeepPass` is the L2 reasoning entry point. Already accepts `locale`.
- `lib/agent/email/draft.ts` — `runDraft` is the body-generation step.
- `app/app/settings/connections/actions.ts` line 184 — `reclassifyAllInboxAction` server action. Mirror the shape.
- `app/app/settings/connections/page.tsx` line 219-240 — Settings → Gmail section, the `reclassifyAllInboxAction` button. Add the new button below it.

---

## Strategic context

PR #168 (L2 reasoning locale) and PR #170 (fanout retrieval quality — drop unrelated syllabus/mistakes for non-academic emails) only take effect on **newly classified emails**. Legacy `agent_drafts` rows keep their old reasoning (English even when `users.preferences.locale='ja'`) and old provenance (e.g. recruiting emails citing `syllabus-1 64%`).

`reclassifyAllInboxAction` (PR #161) re-runs L1 (bucket / risk / sender role) but does NOT touch L2 outputs (`agent_drafts.reasoning`, `retrieval_provenance`, `draft_body`). So legacy drafts stay frozen.

User need: an admin button that refreshes existing drafts with the latest L2 logic + locale + fanout — without losing draft id (which `user_feedback` and approvals reference via FK).

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected commit: `e409da6` (PR #170, fanout retrieval quality) or any sparring inline after this handoff doc lands. If main is behind that, **STOP**.

Branch: `engineer-36-regenerate-drafts`. Don't push without Ryuto's explicit authorization.

---

## What changes

### 1. `lib/agent/email/regenerate.ts` (NEW, ~120 LOC)

Two exported functions:

```ts
export async function regenerateDraft(draftId: string): Promise<RegenerateOutcome>
export async function regenerateAllOpenDrafts(userId: string, opts: { limit: number }): Promise<RegenerateAllOutcome>
```

`regenerateDraft(draftId)`:

1. SELECT the draft + linked inbox_item (single query with join, or two cheap queries).
2. Skip-and-return if draft status is not in `('pending', 'paused')` — sent/approved/dismissed/expired are out of scope.
3. Skip-and-return if draft `riskTier !== 'high'` AND draft `riskTier !== 'medium'` — low items have no L2 output to refresh anyway. (Defensive: in practice no draft row should exist for low-risk.)
4. `assertCreditsAvailable(userId)` — bubble `BillingQuotaExceededError` to caller (the loop will short-circuit on first hit).
5. Re-fetch fanout via `fanoutForInbox({ phase: "deep", ... })` for high-risk, or `phase: "draft"` for medium.
6. Re-run `runDeepPass(...)` for high-risk only (medium has no deep pass; reuse risk reasoning).
7. Re-run `runDraft(...)` if the action is `draft_reply` (deep's `decidedAction` for high, implicit for medium).
8. UPDATE the existing `agent_drafts` row in place: `reasoning`, `retrievalProvenance`, `draftSubject`, `draftBody`, `draftTo`, `draftCc`, `action`, `updatedAt`. Keep all other columns (especially `id`, `qstashMessageId`, `gmailDraftId`, `userId`, `inboxItemId`).
9. Audit log entry: `action: "email_l2_regenerated"`, `result: "success"`, `resourceId: draftId`, detail with `before/after` of `action` field + `reasoning_locale_changed: boolean`.

**Critical**: no INSERT into `agent_drafts`. The whole point is preserving the draft id so `user_feedback.agent_draft_id` and any pending approval flows stay valid.

**No risk pass re-run**. The risk pass already executed when the draft was first written, and re-running it could change the tier (which would upset downstream invariants like queued QStash messages). Trust the stored `risk_tier` column.

`regenerateAllOpenDrafts(userId, { limit })`:

- SELECT `id` FROM `agent_drafts` WHERE `user_id = userId` AND `status IN ('pending', 'paused')` ORDER BY `created_at DESC` LIMIT `limit + 1` (the +1 is so we know if there's more queued).
- Loop sequentially, calling `regenerateDraft(id)`. Catch `BillingQuotaExceededError` → break with `creditsExhausted: true` in the outcome.
- Catch any other error per-row → Sentry + audit `email_l2_regenerated` with `result: "failure"` + detail, continue.
- Return `{ scanned, refreshed, skipped, creditsExhausted, hasMore }` where `hasMore = (totalEligible > limit)`.

### 2. `app/app/settings/connections/actions.ts` (NEW server action, ~25 LOC)

```ts
export async function regenerateDraftsAction() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;

  const out = await regenerateAllOpenDrafts(userId, { limit: 10 });
  revalidatePath("/app/inbox");
  revalidatePath("/app/settings/connections");
  redirect(
    `/app/settings/connections?regenerate=ok` +
      `&scanned=${out.scanned}` +
      `&refreshed=${out.refreshed}` +
      `&exhausted=${out.creditsExhausted ? 1 : 0}` +
      `&more=${out.hasMore ? 1 : 0}` +
      `#inbox`
  );
}
```

Cap = 10 to stay within Vercel server-action timeouts. ~10 drafts × ~10s = 100s worst case — still tight on free tier (60s). If first measurements show this is hot, drop cap to 5 and surface "Run again to continue" more aggressively.

### 3. `app/app/settings/connections/page.tsx` (UI button, ~30 LOC)

Add a second form below the existing `reclassifyAllInboxAction` form (line 220-239), inside the same Gmail `<section>`:

```tsx
{gmailConnected && (
  <form action={regenerateDraftsAction} className="mt-3">
    <button type="submit" title={t("regenerate_drafts.help")} className="rounded-lg border ...">
      {t("regenerate_drafts.button")}
    </button>
    <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
      {t("regenerate_drafts.help")}
    </p>
    {regenerateOk && (
      <p className="mt-2 rounded-md bg-[hsl(var(--surface-raised))] p-2 text-xs">
        {regenerateExhausted
          ? t("regenerate_drafts.exhausted", { refreshed: regenerateRefreshed })
          : regenerateMore
          ? t("regenerate_drafts.more", { refreshed: regenerateRefreshed })
          : t("regenerate_drafts.done", { refreshed: regenerateRefreshed })}
      </p>
    )}
  </form>
)}
```

Mirror the param-parsing pattern used for `reclassifyOk` (line 48-50).

### 4. i18n keys (`lib/i18n/translations/en.ts` + `ja.ts`)

Under the existing `connections.reclassify_inbox` block, add a sibling `regenerate_drafts`:

```ts
regenerate_drafts: {
  button: string;       // EN: "Regenerate AI drafts" / JA: "下書きを最新の AI で再生成"
  help: string;         // EN: "Re-runs L2 reasoning + draft body over your open inbox drafts using the latest classification logic and your current language preference. Up to 10 drafts per click. Costs the usual L2 credits."
  done: string;         // EN: "Regenerated {refreshed} drafts."
  more: string;         // EN: "Regenerated {refreshed} drafts. More queued — click again to continue."
  exhausted: string;    // EN: "Regenerated {refreshed} drafts before credits ran out. Top up to continue."
}
```

Make sure the type definition at en.ts line 1305-1314 is updated too — the type schema is a structural index that all locales must satisfy.

### 5. Tests (`tests/regenerate-drafts.test.ts`, NEW)

- Setup: seed a user with 3 drafts (1 pending high-risk, 1 paused medium-risk, 1 sent — should be skipped).
- Mock `runDeepPass` + `runDraft` to return canned values so tests don't hit OpenAI.
- Assert: `regenerateAllOpenDrafts(userId, { limit: 10 })` returns `{ scanned: 3, refreshed: 2, skipped: 1, ... }`.
- Assert: the sent draft's `reasoning` column is unchanged.
- Assert: the pending draft's `reasoning` column matches the new mock value.
- Assert: the draft's `id`, `userId`, `inboxItemId`, `qstashMessageId`, `gmailDraftId` are all preserved across the UPDATE.
- Add a 4th case: credit-gate exhaustion mid-loop → `creditsExhausted: true` + `refreshed < scanned`.

---

## Files

- `lib/agent/email/regenerate.ts` (NEW, ~120 LOC)
- `app/app/settings/connections/actions.ts` (add `regenerateDraftsAction`, ~25 LOC)
- `app/app/settings/connections/page.tsx` (button + result banner, ~30 LOC)
- `lib/i18n/translations/en.ts` (type + strings, ~10 LOC)
- `lib/i18n/translations/ja.ts` (strings, ~5 LOC)
- `tests/regenerate-drafts.test.ts` (NEW, ~150 LOC)

No schema changes. No migration.

Total LOC: ~340 (the test file dominates; production code is ~190 LOC).

---

## Tests

- New `regenerate-drafts.test.ts` (4-5 cases: status filtering, draft-id preservation, locale propagation, credit exhaustion mid-loop)
- Existing 991 tests must stay green
- Aim: **996+** total

Run locally with `pnpm test` before opening the PR. If vitest hangs (known recurring zombie), `pkill -9 -f vitest` and re-run (codified in `feedback_prod_migration_manual.md` adjacent context).

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- `/app/settings/connections` showing the new "Regenerate AI drafts" button below "Re-classify inbox" — both EN and JA
- Click the button, confirm the success banner renders with `{refreshed}` count
- `/app/inbox/[id]` for a previously classified draft → expand DraftDetailsPanel → confirm reasoning text is in the user's current locale (test with `users.preferences.locale='ja'` user)
- For a non-academic recruiting email that previously cited `syllabus-1`: expand details → confirm syllabus pills are gone after regeneration (PR #170's fanout fix takes effect)

---

## Out of scope

- Background processing via QStash. If 10-per-click + "click again to continue" is too clunky, that's the next iteration — but not this engineer.
- Re-running the **risk pass**. Only deep + draft refresh. Tier classification is left frozen (changing tier mid-life would invalidate queued sends).
- Regenerating drafts in `sent` / `approved` / `dismissed` / `expired` status. Out of scope by definition.
- Bulk per-user feedback: `user_feedback` rows continue to point at the same `agent_draft_id`. The user's prior accept/reject signals stay attached.
- Cross-user: action is strictly `auth().user.id`-scoped.
- Drafts pre-W2 (no `risk_tier` set). Defensive: skip them in `regenerateDraft` with a `skipped` increment.

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-36-regenerate-drafts`
- New tests: `regenerate-drafts.test.ts` with case count, total test count delta
- Production LOC vs test LOC split
- Per-row latency observation (rough): ms or seconds per `regenerateDraft` call in the test environment
- Screenshot pairs: Settings page EN + JA, success banner EN + JA, optionally an inbox/[id] before/after for one regenerated draft
- **Memory entries to update**: `sparring_session_state.md` updated by sparring after merge; no `project_decisions.md` change unless a new tier-flow rule lands.
