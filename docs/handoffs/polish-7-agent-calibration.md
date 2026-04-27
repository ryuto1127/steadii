# Polish-7 — Agent calibration: 2-category triage + per-user learning + Gmail-style read

Engineer-side handoff for the agent calibration work unit. ~3
engineer-days (memory-paced; Claude Code may finish in half a day).

---

## Why this exists

α dogfood surfaced two systemic problems in the L2 triage:

1. **Over-drafting.** The L2 classify path proposes `draft_reply` for
   emails that don't actually need a reply (newsletters, system
   notifications, FYI announcements). Users dismiss these constantly,
   but Steadii forgets — there's no learning loop yet.
2. **No "important but no reply" affordance.** Some emails matter to
   the student (grade posted, scholarship awarded, important uni
   announcement, professor course-wide FYI) but require zero outgoing
   action. Today they either get a misplaced `draft_reply` or fall
   into the same `archive` bucket as spam-adjacent stuff. There's no
   way to surface them as "important, read this" without the misleading
   draft form attached.

Plus a third unrelated UX gap:

3. **No "read" state.** Once a user clicks into an email's detail
   page, the list view should treat it like Gmail: regular weight,
   muted color, no longer demands attention. Today the bold/regular
   distinction is driven only by `isPendingDraft`, which doesn't track
   whether the user has actually seen the item.

---

## Goal — the 2-category mental model

After this work unit, the agent picks up only two kinds of email and
ignores everything else:

- **Category A — Reply-needed.** Sender expects a response (question,
  request, scheduling, etc.). Agent generates a draft (`draft_reply`)
  or asks for context (`ask_clarifying`).
- **Category B — Important, no reply.** Sender doesn't expect a
  response, but the content is consequential to the student:
  university official notifications (grades, scholarship results,
  legal status, deadlines), professor course-wide announcements,
  scholarship office FYIs. Agent uses a NEW action `notify_only`
  (see below). No draft, no clarification, just "read this when
  you have a moment."
- **Category C — Skip entirely.** Newsletters, promo, automated
  system notifications, courtesy CC's. Agent uses `archive` /
  `no_op`. These rows still exist in the DB for analytics but render
  as muted/skipped in the list (current behavior is fine; just don't
  draft for them).

Ryuto's framing during the polish-7 sparring:

> 私が想定するのは a と b です。a (大学からの公式通知 — 成績、奨学金等)
> + b (教授からの read but no reply needed 系 — announcement)。

---

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -3
```

Expected most recent: polish-6 (`feat(inbox-detail): full email body
+ per-action UX`). If main isn't at that or later, **STOP**.

Branch: `polish-7-agent-calibration`. Don't push without Ryuto's
explicit authorization.

---

## Work breakdown — 4 layers

### Layer 1 — L2 prompt tightening (reduce over-drafting)

File: `lib/agent/email/classify-risk.ts` (and any draft-step prompt
file — verify by grep).

Tighten the system prompt with explicit rules:

```
Reply is needed ONLY when ALL of these hold:
  - Sender expects a response from the student (a question, a request,
    a scheduling proposal, a confirmation)
  - The student is the primary audience (not BCC'd, not group blast
    where 100 others received it)
  - Action is on the student's side (not "FYI", not "we will do X
    for you")

If reply is NOT needed, choose one of:
  - notify_only — content matters to the student but no reply needed.
    Use for: grade posted, scholarship awarded, legal status update,
    course-wide professor announcement, important office FYI.
  - archive — newsletter, promo, automated system notification,
    courtesy CC. Don't surface to user.
  - no_op — explicitly nothing to do; same effect as archive but
    semantically different (e.g., the agent recognized this but has
    no action to propose).

If unsure between draft_reply and archive, default to archive.
If unsure between draft_reply and notify_only, default to notify_only.
The cost of a missed draft is one user-driven send (cheap). The cost
of a wrong draft is user trust (expensive).
```

The prompt should include 4-6 fewshot examples of correct
classifications spanning all 4 actions (`draft_reply`,
`ask_clarifying`, `notify_only`, `archive`).

Verify the change didn't break existing tests in
`tests/agent-rules*.test.ts` or `tests/classify-risk*.test.ts`. If
fewshots conflict with existing test fixtures, update fixtures with
clear comments explaining the new policy.

### Layer 2 — New `notify_only` action

#### 2.1 Schema

The `agent_drafts.action` field is a `text` column with TS-side
union. Extend the union:

```typescript
// lib/db/schema.ts (or wherever AgentDraftAction lives)
export type AgentDraftAction =
  | "draft_reply"
  | "ask_clarifying"
  | "notify_only"   // NEW
  | "archive"
  | "snooze"
  | "no_op"
  | "paused";
```

No migration needed (text column accepts the new value). Verify the
existing `agent_drafts.action` CHECK constraint (if any) — if it's
typed as a Postgres ENUM rather than free text, a migration adding
the new value IS needed. Engineer's call to inspect.

#### 2.2 PENDING_ACTIONS update

`lib/agent/email/pending-queries.ts` — `notify_only` should count as
pending (so it surfaces in inbox bold + sidebar badge + bell + digest):

```typescript
export const PENDING_ACTIONS: ReadonlyArray<AgentDraftAction> = [
  "draft_reply",
  "ask_clarifying",
  "notify_only",  // NEW — important even though no reply
];
```

Verify this propagates to:
- sidebar pending-count badge
- notification bell top-N high-risk popover
- inbox-list `compareInboxRows` (sort pending first)
- inbox-list pending-row typography (bold + foreground)
- digest email picker (`lib/digest/build.ts` — also needs this list
  update)
- `lib/agent/email/pending-queries.ts:countPendingDrafts`,
  `loadTopHighRiskPending` — both use `inArray(...PENDING_ACTIONS)`

#### 2.3 UI surfaces

`/app/inbox/page.tsx` (list):

The list already treats pending rows distinctly. Add a small icon
or label to distinguish `notify_only` from `draft_reply` /
`ask_clarifying`:

```tsx
const isImportantNoReply = item.agentDraftAction === "notify_only";
```

Render alongside the existing "Question" pill (for `ask_clarifying`):

```tsx
{isImportantNoReply ? (
  <span
    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[hsl(var(--primary)/0.4)] bg-[hsl(var(--primary)/0.06)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[hsl(var(--primary))]"
    title="Steadii flagged this as important. No reply needed."
  >
    <Star size={10} strokeWidth={2} fill="currentColor" />
    Important
  </span>
) : null}
```

Use `Star` from lucide-react. Same row-styling rules as other
pending types (bold + foreground, same hover behavior).

`/app/inbox/[id]/page.tsx` (detail):

For `notify_only`:
- `NextActionBanner` already gets a fall-through case via
  `next-action-banner.tsx`. Add the new variant:

```typescript
case "notify_only":
  return {
    icon: <Star size={14} strokeWidth={1.75} fill="currentColor" />,
    title: "Important — no reply needed.",
    body: "Steadii flagged this so you don't miss it. Read and dismiss.",
    tone: "primary",
  };
```

- `ReasoningPanel` header should already do the right thing if
  `reasoningHeader(action)` is extended:

```typescript
case "notify_only":
  return "Why this is important";
```

- DraftActions and ClarificationReply: do NOT render for
  `notify_only`. The user just reads + dismisses. The existing
  Dismiss-only path in `DraftActions` post-polish-5 (when action !==
  draft_reply) already handles this correctly — just verify the
  conditional in `app/app/inbox/[id]/page.tsx` lines around the
  ClarificationReply / DraftActions branches handles the new value
  cleanly (i.e., neither renders for `notify_only`).

#### 2.4 i18n

Update `lib/i18n/translations/{en,ja}.ts` if the action labels are
referenced from translation keys. Most of the new copy in this work
unit lives in components (NextActionBanner, list pills) which are
EN-only at α; matching JA copy is welcome but not required. Engineer
judges based on existing patterns in those files.

### Layer 3 — Per-user learning from dismissals

The L3 user-feedback loop. Locked decision in
`memory/project_agent_model.md` was "deferred until ≥100 users";
revising that here for α purposes — Ryuto wants the lite version
shipped now because over-drafting is acute in dogfood.

#### 3.1 New table

```typescript
// lib/db/schema.ts
export const agentSenderFeedback = pgTable(
  "agent_sender_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderEmail: text("sender_email").notNull(),
    senderDomain: text("sender_domain").notNull(),

    // What the agent proposed
    proposedAction: text("proposed_action")
      .$type<AgentDraftAction>()
      .notNull(),

    // What the user did with it
    userResponse: text("user_response")
      .$type<"dismissed" | "sent" | "edited" | "auto_sent">()
      .notNull(),

    inboxItemId: uuid("inbox_item_id").references(() => inboxItems.id, {
      onDelete: "set null",
    }),
    agentDraftId: uuid("agent_draft_id").references(() => agentDrafts.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userSenderIdx: index("agent_sender_feedback_user_sender_idx").on(
      t.userId,
      t.senderEmail
    ),
    userDomainIdx: index("agent_sender_feedback_user_domain_idx").on(
      t.userId,
      t.senderDomain
    ),
  })
);
```

#### 3.2 Write hooks

Insert a feedback row at the moments the user reveals their judgment:

- **Dismiss button** (in DraftActions) → `userResponse: "dismissed"`
- **Send button** confirmed past the 20s undo window →
  `userResponse: "sent"`
- **Edit and save** → `userResponse: "edited"`
- **Auto-sent** (staged-autonomy) → `userResponse: "auto_sent"`

These hooks live wherever each action's server-action sits (search
for `audit_log` `action: 'draft.dismissed'` etc. — same pattern,
just add the parallel insert into `agent_sender_feedback`).

#### 3.3 Read at L2 classify time

`lib/agent/email/classify-risk.ts` — when building the user content
for the L2 classify prompt, query the user's recent feedback for
this sender (last 30 days, top 5 most recent):

```typescript
const recentFeedback = await db
  .select({
    proposedAction: agentSenderFeedback.proposedAction,
    userResponse: agentSenderFeedback.userResponse,
    createdAt: agentSenderFeedback.createdAt,
  })
  .from(agentSenderFeedback)
  .where(
    and(
      eq(agentSenderFeedback.userId, userId),
      or(
        eq(agentSenderFeedback.senderEmail, senderEmail),
        eq(agentSenderFeedback.senderDomain, senderDomain)
      ),
      gte(
        agentSenderFeedback.createdAt,
        sql`now() - interval '30 days'`
      )
    )
  )
  .orderBy(desc(agentSenderFeedback.createdAt))
  .limit(5);
```

If results found, inject into the prompt as a structured block:

```
Recent feedback from the student for this sender (last 30 days):
- 3x: agent proposed draft_reply, user dismissed
- 1x: agent proposed notify_only, user dismissed
Use this signal to bias toward the user's revealed preference. If
the student has dismissed N drafts from this sender without sending,
prefer notify_only or archive over draft_reply.
```

If no feedback found, omit the block entirely (don't show "no
feedback" — wastes tokens).

#### 3.4 Settings UI surface (transparency)

Per the locked Settings → Agent Rules → "Learned contacts"
subsection (`project_agent_model.md` Section "Settings UI design"):
the existing UI shows learned contacts. Extend to also show
recent-feedback rows so the user can:

- See: "For sender X, you dismissed 3 of 4 drafts → Steadii biases
  toward archive"
- Reset: button to clear feedback for a sender (handle accidental
  dismissals)

This is the transparency arm. If the existing Settings → Agent
Rules → Section B (learned contacts) is already wired, add the
recent-feedback view alongside it. If not yet implemented, scope a
minimal version (read-only list, no reset for v1).

### Layer 4 — Gmail-style "read" tracking

#### 4.1 Reuse / add column

Check `inbox_items.reviewedAt` — it might already exist (verified in
schema during sparring; semantics may already cover this). If so,
populate it on detail-page open. If `reviewedAt` is reserved for
something else (e.g., admin-initiated review), add a new column
`viewedAt`:

```typescript
viewedAt: timestamp("viewed_at", { withTimezone: true }),
```

#### 4.2 Write hook

`/app/inbox/[id]/page.tsx` — on render, set viewedAt if not already
set:

```typescript
if (!inbox.viewedAt) {
  await db
    .update(inboxItems)
    .set({ viewedAt: new Date() })
    .where(eq(inboxItems.id, inbox.id));
}
```

Idempotent — on subsequent visits, skip the update.

#### 4.3 Read state in list

`/app/inbox/page.tsx` — extend the list query to select `viewedAt`,
compute `isUnread = !viewedAt`, and use:

```typescript
const isAttention = pending || isUnread;
```

Use `isAttention` (not `pending` alone) for the bold typography
gate. Read non-pending rows go to the muted style.

Sorting: prefer pending rows first, then unread non-pending, then
read non-pending. Within each group, newest first (existing
behavior).

`compareInboxRows` in `lib/agent/email/pending-queries.ts` should
take a 3-state group key now, not 2. Update accordingly + tests.

#### 4.4 Migration

If a new `viewedAt` column is needed, generate a Drizzle migration:

```bash
pnpm db:generate
# Review the generated SQL, name appropriately
```

Otherwise (if `reviewedAt` is reused), no migration needed — just
the new write hook.

---

## Tests

For each layer, add at least minimal coverage:

- Layer 1: classify-risk fixtures with the 4 new action paths,
  verifying the prompt's fewshots produce correct decisions on
  representative inputs (mock OpenAI client).
- Layer 2: `notify_only` flows end-to-end —
  `agent_drafts.action='notify_only'` row → list bold + Star pill →
  detail page renders NextActionBanner "Important — no reply
  needed" + no draft form → Dismiss works.
- Layer 3: feedback table writes correctly on dismiss / send /
  edit; classify prompt's recent-feedback block is built correctly
  when rows exist + omitted when empty.
- Layer 4: reviewedAt/viewedAt write happens on detail-page render;
  list view typography + sort respects the new 3-state grouping.

---

## Constraints

- Locked decisions in `memory/project_decisions.md` and
  `memory/project_agent_model.md` are sacred. The L3 deferral was
  explicitly scoped to ≥100 users; this work unit revises that for
  α-quality reasons. Note the revision in commit message.
- Pre-commit hooks must pass; do not `--no-verify`.
- Conversation Japanese; commits + PR body English.
- Don't push without Ryuto's explicit authorization.
- `verbatim preservation is universal` — applies to mistake notes /
  syllabi, not directly to this work, but the spirit (don't
  silently drop user content) means: don't auto-archive user
  emails, only suggest. The user always confirms.

---

## Context files to read first

- `lib/agent/email/classify-risk.ts` (Layer 1 prompt edit)
- `lib/agent/email/pending-queries.ts` (Layer 2 + 4 query updates)
- `lib/agent/email/draft.ts` if exists (Layer 1 draft-step prompt)
- `lib/digest/build.ts` (PENDING_ACTIONS sync)
- `app/app/inbox/page.tsx` (Layer 2 + 4 list UI)
- `app/app/inbox/[id]/page.tsx` (Layer 2 + 4 detail UI)
- `components/agent/next-action-banner.tsx` (Layer 2 banner variant)
- `components/agent/reasoning-panel.tsx` (Layer 2 header variant)
- `components/agent/draft-actions.tsx` (Layer 3 dismiss/send hooks)
- `lib/db/schema.ts` (inbox_items, agent_drafts, new
  agent_sender_feedback)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md`
  (note the L3 deferral revision in commit message)
- AGENTS.md, CLAUDE.md if present

---

## When done

PR title: `feat(agent): 2-category triage + per-user learning + read tracking (polish-7)`

Report:
- PR URL + commit hash
- Verification log:
  - L2 prompt-shape snapshot test passes new fewshots
  - `notify_only` end-to-end (DB row → list pill → detail banner)
  - feedback row writes on each user response type
  - read state propagates to list typography + sort
- Deviations from this brief + one-line reason for each
- Open questions for the next work unit

The next work unit (likely α invitation send + observation cadence)
picks up from there.
