# Engineer-49 — Adaptive behavior: dynamic confirmation thresholds + periodic check-in

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — risk-tiered model (the thresholds being made dynamic)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md` — confirmation-mode setting + auto-send eligibility rules
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — read before any migration
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — drives test cases (Ryuto's communication pattern)

Reference shipped patterns:

- `lib/db/schema.ts` — `agentDrafts` (`status`, `action`, `riskTier`), `agentContactPersonas`, `userFacts` (now lifecycle-aware via engineer-48), `userFeedback` (per-draft sentiment / explicit feedback)
- `lib/agent/email/feedback.ts` — `loadRecentFeedbackSummary` already exists; aggregates user-feedback rows per-sender. Engineer-49 extends with confidence scoring.
- `lib/agent/email/l2.ts` `autoSendEligible` calculation — currently a static gate (medium tier × draft_reply × non-empty body). Engineer-49 layers the learned promotion on top.
- `lib/agent/email/send-enqueue.ts` — where auto-send currently fires. Hook for the new "always-send" promotion path.
- `lib/agent/proactive/scanner.ts` + `rules/` — Part 2's monthly check-in proposal is a new proactive rule.
- `app/app/settings/how-your-agent-thinks/page.tsx` — closest existing trust surface; Part 2 adds a UI to view + tune learned thresholds.
- `lib/agent/preferences.ts` `getUserConfirmationMode` (verify) — current confirmation mode comes from `users.preferences.confirmationMode`. Engineer-49's learned signals are an additive nuance per-sender, NOT a replacement.

---

## Strategic context

Engineer-48 closed the foundational quality gaps (memory lifecycle + retrieval reranker + observability). Engineer-49 closes two of the remaining 4 from the 2026-05-12 agent-quality research:

- **Dynamic confirmation thresholds (gap G in research)**: Steadii's risk-tier confirmation today is static. If Ryuto has approved 8 drafts in a row from his project mentor with no edits, the 9th should auto-send (he's effectively telegraphing "I trust you for this sender"). Conversely, if 3 drafts to a sender got dismissed, future drafts to that sender should re-elevate to high tier even if L1 thinks they're medium.
- **Periodic check-in (gap F)**: Human-EA pattern from research — regular check-ins where the assistant explains "here's what I did, here's what I think you'd want me to do differently" build trust + catch drift. Steadii does end-of-week digest today; this engineer adds a monthly-cadence "boundary re-adjustment" surface where Ryuto can tune the learned thresholds + revoke / extend per-sender trust.

Both lean on engineer-48's lifecycle (we don't want stale signals driving promotion) + reranker (we want the confidence signal in `userFeedback` to be high-quality, not noisy).

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-49
```

---

## Part 1 — Per-sender confidence signal

### Schema (migration 0040)

Add a new table tracking the learned per-sender / per-action signal:

```ts
export const senderConfidence = pgTable(
  "sender_confidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    senderEmail: text("sender_email").notNull(),                  // lowercased
    actionType: text("action_type")                                // 'draft_reply' | 'notify_only' | etc.
      .$type<AgentDraftAction>()
      .notNull(),

    approvedCount: integer("approved_count").notNull().default(0),   // user clicked Send (incl. auto-send via this path)
    editedCount: integer("edited_count").notNull().default(0),       // user sent BUT edited the body first
    dismissedCount: integer("dismissed_count").notNull().default(0), // user dismissed
    rejectedCount: integer("rejected_count").notNull().default(0),   // user explicitly flagged "don't send things like this"

    consecutiveApprovedCount: integer("consecutive_approved_count").notNull().default(0),
    consecutiveDismissedCount: integer("consecutive_dismissed_count").notNull().default(0),

    // Computed at signal-update time; cached for fast read.
    // 0.0..1.0 — higher means more autonomy permitted for this sender × action.
    learnedConfidence: real("learned_confidence").notNull().default(0.5),

    // Promotion tier (mutually exclusive enum):
    //   'baseline'      — default; defer to L1/L2 risk_tier + autonomy_send_enabled
    //   'auto_send'     — bypass medium-tier confirmation, auto-send with the 10s undo
    //   'always_review' — force high-tier confirmation even if L2 picks medium
    promotionState: text("promotion_state")
      .$type<"baseline" | "auto_send" | "always_review">()
      .notNull()
      .default("baseline"),
    promotionLockedAt: timestamp("promotion_locked_at", { withTimezone: true, mode: "date" }),
    promotionLockedReason: text("promotion_locked_reason"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userSenderActionIdx: uniqueIndex("sender_confidence_user_sender_action_idx")
      .on(t.userId, t.senderEmail, t.actionType),
  })
);
```

Migration 0040 + journal entry per `feedback_prod_migration_manual.md`.

### Signal update flow

New file: `lib/agent/learning/sender-confidence.ts`.

Hooks:

1. **On draft approval** (`approveDraftAction` server action):
   - INCREMENT `approvedCount`, INCREMENT `consecutiveApprovedCount`, RESET `consecutiveDismissedCount`
   - If user edited body before sending: also INCREMENT `editedCount`
   - Recompute `learnedConfidence` (see formula below)
   - Maybe promote (see promotion rules below)

2. **On draft dismissal** (`dismissDraftAction`):
   - INCREMENT `dismissedCount`, INCREMENT `consecutiveDismissedCount`, RESET `consecutiveApprovedCount`
   - Recompute confidence
   - Maybe demote

3. **On user_feedback `kind='reject'`** (existing feedback table):
   - INCREMENT `rejectedCount`
   - Force `promotionState = 'always_review'` if `rejectedCount >= 2` in the past 30 days
   - Lock until user manually clears via settings

### Confidence formula

```
total = approvedCount + dismissedCount + rejectedCount + editedCount × 0.3
positive = approvedCount + editedCount × 0.3
confidence = positive / max(total, 5)   // 5 is the "we need this many samples" floor
clamped = clamp(confidence, 0, 1)
```

- < 5 samples → confidence stays near 0.5 baseline (no premature promotion)
- High `editedCount` is a soft-negative (user trusts but corrects, so it counts partial)
- Rejected is a hard-negative — single reject ≈ 1 dismissal

### Promotion rules

Auto-promote to `auto_send` when ALL of:
- `consecutiveApprovedCount >= 5`
- `learnedConfidence >= 0.85`
- `rejectedCount == 0` (in past 30 days)
- `actionType == 'draft_reply'` (only drafts auto-send; notify_only, ask_clarifying never)
- User has `autonomySendEnabled === true` globally

Auto-demote to `always_review` when ANY of:
- `consecutiveDismissedCount >= 3`
- `rejectedCount >= 2` (past 30 days)

State stays `baseline` otherwise.

### Wire into auto-send eligibility

`lib/agent/email/l2.ts` `autoSendEligible` calc — read `sender_confidence` for the sender × action. If `promotionState === 'auto_send'`, BYPASS the existing medium-tier-only gate (so high-tier drafts can also auto-send from a trusted sender). If `promotionState === 'always_review'`, FORCE `autoSendEligible = false` regardless.

Audit-log every promotion / demotion: `action='sender_confidence_promoted'` / `'_demoted'` with the new state + the trigger condition.

### Tests

- `tests/sender-confidence.test.ts` —
  - 5 approvals in a row → auto_send promotion
  - 3 dismissals in a row → always_review demotion
  - Single reject doesn't trigger demote (need 2)
  - User clears promotion lock → state returns to baseline
  - Confidence floor: 4 approvals + 0 negatives → confidence stays ≤ 0.85 (5-sample floor)
  - Edited counts as 0.3 positive (so 5 edited-but-sent ≈ 1.5 effective positives)

---

## Part 2 — Monthly check-in proposal + tuning UI

### New proactive rule `monthly_boundary_review`

New file: `lib/agent/proactive/rules/monthly-boundary-review.ts`.

Fires once per month per user (state tracked via `users.preferences.lastMonthlyReviewAt`). Generates a Type C card with body:

```
{N} 件の承認、{M} 件の dismissal、{K} 件の reject を今月処理しました。
変えたい行動はありますか？

- 自動送信: {AUTO_SEND_COUNT} 件の送信先で発動
- 強制レビュー: {ALWAYS_REVIEW_COUNT} 件の送信先で発動

→ 詳細を見て調整: /app/settings/agent-tuning
```

Detail-page link goes to a new tuning page (see below). User can dismiss the card with no action (everything stays as learned); take action by visiting the page.

### Tuning page `/app/settings/agent-tuning`

New file: `app/app/settings/agent-tuning/page.tsx`.

Sections:

1. **Auto-send senders** — list of senders × actions where `promotionState='auto_send'`. Each row: sender, action, confidence, sample count, last-action timestamp. "Revoke" button reverts to `baseline`.

2. **Always-review senders** — same shape, for the `always_review` state. "Forgive" button reverts to baseline (resets `rejectedCount` for that sender × action).

3. **Pending learning** — senders with 2-4 samples (almost-promoted, almost-demoted). Visibility into where the learner is leaning.

4. **Reset all** — destructive, with confirm dialog. Clears all `sender_confidence` rows. Restart from scratch.

Server actions: `revokePromotionAction`, `forgiveSenderAction`, `resetAllSenderConfidenceAction`.

### i18n keys

Under `settings.agent_tuning.*` for the page, `proactive.monthly_review.*` for the card copy. EN + JA.

### Tests

- `tests/monthly-boundary-review.test.ts` — fires once per month, skips if recent
- `tests/agent-tuning-actions.test.ts` — revoke restores baseline, forgive clears reject count, reset clears all rows for user (NOT cross-user)

---

## Out of scope (engineer-50+)

- **CoS-mode monthly strategic digest** (engineer-50) — different shape from this engineer's monthly check-in card. The check-in here is about boundary tuning. CoS-mode is about high-level strategic synthesis ("here's where you are this term").
- **Cross-source relational reasoning** (engineer-51)
- **Adaptive lifecycle decay** (learning per-user how fast facts go stale) — fixed for now
- **Negative-feedback summarization** (LLM-generated "you tend to dismiss X-type drafts") — engineer-52+ candidate; the data is captured here but interpretation is deferred

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new ones
3. **Migration 0040** applied to prod via `pnpm tsx scripts/migrate-prod.ts` (sparring)
4. **Live dogfood**:
   - Approve 5 drafts in a row from the same sender → check audit log for `sender_confidence_promoted` event → confirm next draft auto-sends without confirmation
   - Dismiss 3 drafts from another sender → confirm `always_review` promotion → next draft gets high-tier UI even if L2 says medium
   - After ~30 days (or with backdated test data): monthly check-in card appears in queue; clicking detail opens tuning page

---

## Commit + PR

Branch: `engineer-49`. Push, sparring agent creates the PR.

Suggested PR title: `feat(agent): dynamic confirmation thresholds + monthly boundary check-in (engineer-49)`

---

## Deliverable checklist

- [ ] `lib/db/schema.ts` — sender_confidence table
- [ ] `lib/db/migrations/0040_*.sql` + journal entry
- [ ] `lib/agent/learning/sender-confidence.ts` — signal update + promotion logic
- [ ] Hooks in approve / dismiss / feedback action server actions
- [ ] `lib/agent/email/l2.ts` `autoSendEligible` — read promotion state
- [ ] `lib/agent/proactive/rules/monthly-boundary-review.ts` — new rule
- [ ] Register in `lib/agent/proactive/scanner.ts`
- [ ] Add `'monthly_boundary_review'` to `AgentProposalIssueType`
- [ ] `app/app/settings/agent-tuning/page.tsx` + supporting components + actions
- [ ] Sidebar link from `/app/settings`
- [ ] `lib/i18n/translations/{ja,en}.ts` — new keys
- [ ] Tests per Verification section
- [ ] Live dogfood verified
