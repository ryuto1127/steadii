# Phase 8 — Proactive Agent (Cross-source detection + Multi-action proposals + Chat-aware suggestions)

Engineer-side handoff. The biggest scope change since Phase 6 — this
turns Steadii from a reactive "answers when asked" agent into a
proactive partner that monitors user data, surfaces issues, and
offers actions. Aligned with the locked 5-year vision: "the default
productivity tool for every university student" (per
`memory/project_steadii.md`) and the moat statement: depth of
integrated student context (per `memory/project_agent_model.md`).

---

## Why this exists

The existing agent is reactive: it triages incoming Gmail, runs
chat tools when asked, and generates drafts on demand. It does NOT
notice when the user's calendar, syllabus, mistakes, and assignments
imply a problem the user hasn't surfaced themselves.

Ryuto's example:

> Calendar に旅行の予定を入れておいたら、シラバス内の試験と被ったら
> notification で休む場合の手続きの仕方を出させる、それか教授に
> email を作る。

This is what Phase 8 ships. Plus the related "syllabus → calendar
auto-import" workflow, plus chat-aware action suggestions, all
glued together by a unified "Steadii noticed" notification surface.

---

## Locked design decisions (sparring → 2026-04-26)

Treat as canonical. Do NOT re-litigate.

### D1 — Scanner trigger model: event-driven + daily cron fallback

The scanner runs:

- **Immediately on user actions that change the data**:
  - Calendar event created / updated / deleted (Google Calendar
    webhook OR Steadii-side write hook)
  - Syllabus uploaded
  - Assignment added / due_at edited
  - Mistake note added / class_id changed
  - Inbox email arrived (existing ingest path can chain into the
    scanner for that user)
- **Daily cron** as a catch-all (covers cases where data didn't
  change but a deadline drifted into the "warning window")

Implementation: a `runScanner(userId, trigger)` server function called
from each write hook + a QStash daily cron. Avoid running the same
scan twice within 5 minutes (debounce per user) to handle rapid
sequential edits.

**Do NOT** ship a fixed-interval cron (e.g., every 2h) — it's
strictly worse than event-driven for both UX (latency) and cost
(wasted scans).

### D2 — Dedup window: 24 hours per (issue_type + source_record_ids hash)

Once an issue is surfaced and dismissed, suppress identical
re-surfaces for 24 hours. Identity = `issue_type + sha256(sorted
source_record_ids)`. The same issue at a different time scope (e.g.,
"deadline_during_travel" detected for a different deadline) is a
different issue, not a dedup target.

### D3 — Notification channels: in-app inbox + 7am digest only

Proactive issues land in:
- The existing `/app/inbox` list (a new section "Steadii noticed"
  alongside the email-driven items)
- The existing 7am digest email (one extra line per
  unresolved-this-week proposal, capped at 5)

Do NOT add per-issue email notifications — that's how trust dies.

### D4 — Sensitivity: balanced fixed in α

No user-facing sensitivity slider in α. The detection rules
themselves carry implicit sensitivity (e.g., "exam within 7 days"
is the threshold; we don't surface "exam within 30 days"). Post-α
can add a Settings → "Steadii alertness" slider if observation
demands it.

### D5 — Autonomous execution: never

Steadii NEVER executes a proposed action without the user's
explicit click. The existing staged-autonomy feature (which can
auto-send medium-risk *email drafts*) does NOT apply here.
Proactive proposals are always opt-in.

### D6 — False-positive learning: reuse polish-7 feedback table

When the user dismisses a proposal without action, append a row to
`agent_sender_feedback` (the table polish-7 introduced). The
"sender" column for proactive proposals carries the originating
trigger source (e.g., `proactive:calendar.created` or
`proactive:syllabus.added`) so the same dismissal pattern teaches
the scanner just like email dismissals teach the L2 classifier.
The scanner LLM (when generating action options) consults the same
feedback at proposal-generation time.

### D7 — Cost: ~30 credits / user / day budget

Each proposal generation is one LLM call (~5-10 credits using
GPT-5.4 Mini for routing + Mini for proposal generation —
upgrades to GPT-5.4 only when the issue is high-stakes). 1 user
hits ~3-6 proposals/day across all sources → ~30 credit ceiling.
Free 300/mo → 10/day allowance per user (enough for α dogfood with
a wide margin). Pro 1000/mo → 33/day (no concern).

Detection rules themselves are pure SQL + JS (no LLM) — free.

### D8 — Conflict types: 5 hardcoded rules in α

1. **Time conflict**: calendar event overlaps a class time slot
   (from `classes` table)
2. **Exam conflict**: calendar event during a syllabus-listed exam
   window
3. **Deadline-during-travel**: assignment `due_at` falls within a
   multi-day calendar event
4. **Exam under-prepared**: syllabus exam in <7 days AND no chat /
   mistake / study-session signal for that class in the prior 14 days
5. **Workload over capacity**: 7-day rolling window where total
   estimated assignment hours > 30

Each rule lives in `lib/agent/proactive/rules/<name>.ts` as a pure
function: `(snapshot: UserSnapshot) => DetectedIssue[]`. Easy to add
more later by dropping in another rule file + registering it.

### D9 — Action option universe: existing tools, no LMS

When proposing actions, the LLM picks from this set (no others):

- `email_professor` — Gmail send tool
- `reschedule_event` — Google Calendar update tool
- `delete_event` — Google Calendar delete tool
- `create_task` — Google Tasks / Steadii task creation
- `chat_followup` — opens a new Steadii chat seeded with the issue
  context (user can iterate)
- `add_mistake_note` — for "exam under-prepared" type, adds a
  prompt to study X
- `dismiss` — always available, marks proposal resolved with
  `resolved_action='dismissed'`

LMS-specific actions (Canvas absence form, manaba 欠席届, etc) are
**explicitly out of scope for α** — Phase 9 territory.

### D10 — Syllabus → Calendar auto-import with dedup

When `syllabus.upload` completes (existing ingest path):

1. Extract structured events from the syllabus:
   - Lectures (recurring, weekly per `schedule[]`)
   - Exams (single-event, with date+time)
   - Assignment deadlines (single-event, all-day OK)
2. For each extracted event, check Google Calendar for a likely
   match:
   - Same date or within ±1 hour
   - Title fuzzy-match (case-insensitive substring of class name
     OR class code OR exam keyword)
3. Per match outcome:
   - **Confident match** (same time + title contains class code):
     skip silently, log to `audit_log`
   - **Confident no-match**: add the event with title prefix
     `[Steadii] {class_code} {event_label}` and a description that
     references the syllabus row
   - **Ambiguous** (time matches but title differs, OR title
     matches but time differs by >1h): see D12 below — surface to
     user as a notification asking to confirm

After processing, single notification: "Math II シラバスから N 件追加、
M 件は既存と確認のため保留中です。" with a link to the inbox proposals.

### D11 — Communication-first: every automated action notifies

Every automated action (background scan, syllabus auto-add, learning
update) ALWAYS leaves a user-visible trace:

- **Inbox notification** (low-priority "Steadii did X" item) when
  Steadii took action without asking (auto-add of confident-match
  syllabus events, learning bias updates, etc.)
- **Inbox proposal** (medium-priority, requires user click) when
  Steadii has a suggestion (proactive conflict, ambiguous import)
- **Weekly summary** (post-α candidate, optional now) — "Steadii
  watched X events this week, surfaced Y issues, Z resolved"

The principle: NEVER do something silent that affects user state.
Glass-box brand extends from "agent reasoning shown" to "agent
background actions logged + visible."

### D12 — Ambiguity → ask user, not silent decision

When the scanner / auto-import is uncertain (confidence < 0.8 on the
match decision), surface to the user:

```
[Steadii noticed]

シラバスに「中間試験 5/16 14:00」とあります。
Calendar に既に「5/16 14:00 Math 試験」があります。

これは同じものですか?

[✓ 同じ — link]   [+ 別 event として追加]   [× cancel]
```

The "ambiguous import" type is a distinct `agent_proposals.issue_type`
('syllabus_calendar_ambiguity') with three action options. Same
inbox surface, same dismissal mechanic.

NEVER auto-merge or auto-dup-add in the ambiguous case.

### D13 — Chat-aware proactive suggestions

While the user is chatting (any chat surface — `/app/chat/[id]` or
home dashboard chat), the agent's response should include
proactive action suggestions whenever the user's text implies an
opportunity:

```
User: "明日大学に行けないかも"
Agent: "了解しました。明日 (5/14) の予定を見ると、Math II と
       English Literature があります。以下を行いますか?

       [📧 田中先生 (Math II) に欠席連絡 draft]
       [📧 Smith 先生 (English) に欠席連絡 draft]
       [📅 明日の class block を calendar に absent mark]
       [📝 後で課題を確認する reminder 追加]"
```

**Implementation**:

- Extend the chat system prompt with a "proactive suggestions" rule
  set: "When the user describes a situation in which Steadii has a
  tool that can help, end your response with a structured set of
  proposed action buttons (each tied to one tool call). Don't
  invent capabilities. Don't push if the user just wants to vent."
- Reuse the `proposed_actions` shape from D9 in the chat agent's
  response so the same UI button component renders both in chat and
  in inbox proposals.
- Each button click → tool execute (with confirmation flow per D5
  for any destructive action).

Cost: marginal — the chat agent is already running an LLM call per
turn; the proactive suggestion just changes the system prompt
shape, not the call count.

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

Most recent expected: polish-7 (`feat(agent): 2-category triage +
per-user learning + read tracking`). If main isn't at that or later,
**STOP**.

Branch: `phase8-proactive-agent`. Don't push without Ryuto's
explicit authorization.

---

## Schema additions

```typescript
// lib/db/schema.ts — add three tables, extend one

// 1. New: agent_events — every meaningful change that should trigger
//    a scan. Inserted by the write hooks (calendar / syllabus /
//    assignment / mistake / inbox), processed by the scanner.
export const agentEvents = pgTable("agent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  source: text("source")
    .$type<
      | "calendar.created" | "calendar.updated" | "calendar.deleted"
      | "syllabus.uploaded" | "syllabus.deleted"
      | "assignment.created" | "assignment.updated" | "assignment.deleted"
      | "mistake.created" | "mistake.updated"
      | "inbox.classified"
      | "cron.daily"
    >()
    .notNull(),
  sourceRecordId: text("source_record_id"),  // calendar event id, syllabus id, etc.
  status: text("status")
    .$type<"pending" | "analyzed" | "no_issue" | "error">()
    .notNull()
    .default("pending"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
}, (t) => ({
  userPendingIdx: index("agent_events_user_pending_idx").on(
    t.userId,
    t.status,
    t.createdAt
  ),
}));

// 2. New: agent_proposals — what the scanner surfaces to the user.
export const agentProposals = pgTable("agent_proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  triggerEventId: uuid("trigger_event_id").references(() => agentEvents.id, {
    onDelete: "set null",
  }),

  issueType: text("issue_type")
    .$type<
      | "time_conflict"
      | "exam_conflict"
      | "deadline_during_travel"
      | "exam_under_prepared"
      | "workload_over_capacity"
      | "syllabus_calendar_ambiguity"
    >()
    .notNull(),
  issueSummary: text("issue_summary").notNull(),    // 1-line for inbox list
  reasoning: text("reasoning").notNull(),            // glass-box explanation
  sourceRefs: jsonb("source_refs")
    .$type<{ kind: string; id: string; label: string }[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),

  // [{ key, label, description, tool, payload }]
  // `tool` ∈ D9 set; `payload` is pre-filled args for the tool.
  actionOptions: jsonb("action_options")
    .$type<ActionOption[]>()
    .notNull(),

  // Dedup: hash of (issueType + sorted source_record_ids).
  dedupKey: text("dedup_key").notNull(),

  status: text("status")
    .$type<"pending" | "resolved" | "dismissed" | "expired">()
    .notNull()
    .default("pending"),
  resolvedAction: text("resolved_action"),  // which option key the user picked
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  viewedAt: timestamp("viewed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),  // 7 days out
}, (t) => ({
  userPendingIdx: index("agent_proposals_user_pending_idx").on(
    t.userId,
    t.status,
    t.createdAt
  ),
  dedupIdx: uniqueIndex("agent_proposals_dedup_idx").on(t.userId, t.dedupKey),
}));

// 3. ActionOption shape (TS type, not a table)
export type ActionOption = {
  key: string;          // "email_professor", "reschedule", etc.
  label: string;        // "📧 田中先生に欠席連絡 draft"
  description: string;  // 1-line "what happens when I click"
  tool:
    | "email_professor"
    | "reschedule_event"
    | "delete_event"
    | "create_task"
    | "chat_followup"
    | "add_mistake_note"
    | "dismiss";
  payload: Record<string, unknown>;  // tool-specific pre-filled args
};

// 4. Extend agent_sender_feedback (polish-7) — accept proactive
//    sources alongside email senders. The "sender" column already
//    exists; add a discriminator if not present:
// senderEmail can carry "proactive:calendar.created" etc. as a
// pseudo-sender, or add a new column. Engineer's call.
```

Migration: generate via `pnpm db:generate`. New tables don't break
anything existing. Add appropriate indexes per the table comments.

---

## Module map (where each piece lives)

```
lib/agent/proactive/
  scanner.ts                 — main entry: runScanner(userId, trigger)
  snapshot.ts                — gather UserSnapshot from DB (calendar,
                               syllabus, classes, assignments, mistakes)
  rules/
    time-conflict.ts         — Rule 1
    exam-conflict.ts         — Rule 2
    deadline-during-travel.ts — Rule 3
    exam-under-prepared.ts   — Rule 4
    workload-over-capacity.ts — Rule 5
    syllabus-calendar-ambiguity.ts — D12 ambiguity
  rules/index.ts             — registry, exports ALL_RULES array
  proposal-generator.ts      — LLM call: issue → action options
  feedback-bias.ts           — read polish-7 feedback table for
                               this user/source, return a hint string
                               for the proposal LLM
  syllabus-import.ts         — D10: extract events from syllabus +
                               match to existing calendar + propose
                               or auto-add per confidence

lib/agent/chat/
  proactive-suggestions.ts   — extends existing chat system prompt
                               with the D13 rule set; no new tools

app/api/agent/proposal/[id]/
  resolve/route.ts           — POST: { actionKey } → executes the
                               chosen tool, marks proposal resolved
  dismiss/route.ts           — POST → marks dismissed + writes
                               feedback row

components/agent/
  proposal-card.tsx          — inbox-list rendering for a proposal
                               (Star + 1-line summary)
  proposal-detail.tsx        — full detail view: reasoning + sources +
                               action menu (used in /app/inbox/[id]
                               when the id corresponds to a proposal,
                               not an agent_draft)
  proposed-actions.tsx       — the button row (shared with chat)
```

---

## Inbox surface unification

The Inbox list today renders rows from `agent_drafts` (joined to
`inbox_items`). After Phase 8 it ALSO renders rows from
`agent_proposals`.

Two implementation paths:

A. **Polymorphic list query**: union both sources in the page query,
   normalize to a common shape, render with a `kind` discriminator
   ("draft" vs "proposal"). One unified scroll list.

B. **Sectioned list**: "Steadii noticed" header above proposals,
   "Inbox" header below for drafts. Two queries.

Engineer's call. (B) is simpler and matches Ryuto's mental model
("a section of proactive items"). Either way, sort within each
group: pending first, then resolved/dismissed (muted).

The detail page route `/app/inbox/[id]/page.tsx` should:

1. Try resolving `id` as `agent_drafts.id` first (existing behavior)
2. If no match, try `agent_proposals.id`
3. Render the appropriate detail component

Or: introduce a new route `/app/inbox/proposals/[id]` to keep the
two paths cleanly separate. Engineer's call.

---

## Notification (D11) implementation

Two flavors of "Steadii did X" notification:

1. **Action notification** (Steadii took action without asking):
   - Insert a row in `agent_proposals` with
     `status='resolved'`, `resolvedAction='auto'`,
     `issueType='auto_action_log'` (new), `viewedAt=null` so it
     surfaces in the inbox until the user opens it.
   - Detail page shows: "Steadii did X. Reasoning: Y. [Undo (if
     applicable)] [OK]"
   - The inbox row is muted-styled (this is informational, not a
     pending decision).

2. **Proposal notification** (Steadii has a suggestion):
   - Existing `agent_proposals.status='pending'` flow.
   - Surfaces as bold + Star pill in inbox.

The 7am digest already has a "What's pending" section; add a
"Steadii noticed" subsection above it that lists unresolved
proposals (max 5). Same pattern as draft proposals, different action
options.

---

## Chat proactive suggestions (D13) implementation

Touches:
- `lib/agent/prompts/chat.ts` (or wherever the chat system prompt
  lives — verify by grep)
- The existing chat agent loop (the place that turns user message
  → LLM call → response with possible tool calls)

Add to system prompt (English, per locked decision; agent responses
themselves follow user's input language):

```
PROACTIVE SUGGESTIONS

When the user's message implies a situation in which one of your
tools can help — even when they didn't explicitly ask — end your
response with a structured set of proposed action buttons. Each
button maps to exactly one tool call.

Examples of when to suggest:
- "明日大学に行けないかも" (anywhere — class? meeting? OK to ask)
- "test 勉強する時間ない" → study block, mistake review
- "課題のアイデア浮かばない" → syllabus reference, similar
  problems from mistakes
- "あの先生のメール返してないかも" → inbox lookup, draft
- "週末旅行する" → conflict scan against calendar / syllabus

When NOT to suggest:
- The user is venting and clearly doesn't want action ("疲れた")
- The user already explicitly asked for the action ("calendar に X
  追加して")
- The action would require LMS or other unavailable tool

Format the suggestions in your response as a final list of
buttons, one tool call each. Don't invent tools. Be specific
(reference real names, classes, dates from context).
```

Render: the chat UI today already supports tool calls inline. Extend
to render "proposed actions" as a button row at the end of an
agent message. Click → triggers the tool's confirmation flow per D5.
No new tools needed.

---

## Tests (engineer pace, ship + smoke)

- Each rule in `lib/agent/proactive/rules/`: unit-test against
  fixture `UserSnapshot`s. Both positive (rule fires) and negative
  (rule doesn't fire) cases.
- `scanner.ts`: integration test — given a user with calendar event
  + syllabus + assignment fixtures, scanner produces correct
  `agent_proposals` rows.
- Dedup: scan the same data twice → only one proposal row.
- Action options: `proposal-generator.ts` LLM mock returns the
  right `ActionOption[]` shape for sample issues.
- D10 syllabus import: 3 cases (confident match → skip, no match →
  auto-add, ambiguous → propose).
- D13: chat system prompt produces proposed actions for a sample
  user message; doesn't produce them for a "venting" message.
- E2E: simulate "user uploads syllabus → 4 events extracted → 3
  added to calendar, 1 ambiguous → user gets ambiguity proposal in
  inbox → user picks 'same as existing' → resolved, no duplicate
  added".

---

## PR plan

Suggested 4 PRs, total ~5 engineer-days at memory pacing (1-2 days
at Claude Code speed).

### PR 1 — Schema + scanner foundation (~1.5 days)
- `agentEvents` + `agentProposals` tables + migration
- `lib/agent/proactive/snapshot.ts`
- `lib/agent/proactive/scanner.ts` skeleton (no rules yet)
- Write hooks: insert agentEvents row on calendar/syllabus/etc. mutation
- QStash daily cron for `cron.daily` events

### PR 2 — Rules + proposal generation (~1.5 days)
- 5 rule modules under `rules/`
- `proposal-generator.ts` (LLM call, prompt, ActionOption shape)
- `feedback-bias.ts` (polish-7 integration)
- Unit tests per rule

### PR 3 — UI surfaces (~1.5 days)
- Inbox list extension to render proposals
- Proposal detail page route
- Action menu (`proposed-actions.tsx`) shared component
- Action resolve / dismiss endpoints
- Notification (D11) — action-log proposal type
- 7am digest "Steadii noticed" subsection

### PR 4 — Syllabus auto-import + chat proactive (~1 day)
- D10 syllabus → calendar import with dedup + ambiguity proposal
- D13 chat system prompt extension
- Final completion report at
  `docs/handoffs/phase8-proactive-agent-completion-report.md`

---

## Out of scope (post-α)

- LMS-specific actions (Canvas absence form, manaba 欠席届, etc) —
  Phase 9
- User-facing sensitivity slider — depends on α observation
- Cross-user signal aggregation in the learning loop ("students
  generally dismiss type-X alerts") — Phase 10
- Auto-execution of any proposed action — explicitly rejected per D5
- Per-issue email notification (separate from digest) — explicitly
  rejected per D3
- Weekly summary email of "Steadii watched X / surfaced Y" — D11
  candidate, defer to post-α
- Webhook-based real-time Google Calendar sync (vs polling) — defer

---

## Constraints

- Locked decisions in `memory/project_decisions.md`,
  `memory/project_agent_model.md`, and
  `memory/project_pre_launch_redesign.md` are sacred. Phase 8
  extends but does not contradict them. Note the `agent_model.md`
  L3 deferral was already revised in polish-7 (α-lite shipped); this
  work unit further extends the proactive surface.
- `verbatim preservation is universal` (project_decisions.md) —
  applies to mistake / syllabi text. Proactive proposals can
  paraphrase issue summaries but action option labels and
  reasoning should preserve user-data verbatim where it appears
  ("5/16 14:00 'Math 試験'" — don't normalize the title).
- Pre-commit hooks must pass. No `--no-verify`.
- Conversation Japanese with Ryuto; commits + PR body English.
- Don't push without Ryuto's explicit authorization.
- Action options must use existing tools only — see D9 for the
  closed set. No new external integrations.

---

## Context files to read first

- `lib/agent/email/pending-queries.ts` — `PENDING_ACTIONS` will
  extend to include proactive proposals
- `lib/digest/build.ts` — 7am digest needs the "Steadii noticed"
  subsection
- `app/app/inbox/page.tsx` — list extension
- `app/app/inbox/[id]/page.tsx` — detail page polymorphism (or
  separate route for proposals)
- `lib/agent/email/feedback.ts` (polish-7) — reuse for the proactive
  feedback bias
- `lib/integrations/google/calendar.ts` — calendar update / delete /
  list functions for actions
- `lib/syllabus/extract.ts` — already extracts structured events
  (used by D10 syllabus auto-import)
- `lib/agent/prompts/main.ts` and any chat-prompt module — D13
  extension target
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md`
  — action taxonomy (revised 2026-04-26 to add `notify_only`); D5
  staged-autonomy carve-out
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md`
  — credit / model routing; D7 budget
- `AGENTS.md`, `CLAUDE.md` if present

---

## When done

After PR 4 lands, report back with:

- All 4 PR URLs + commit hashes
- Verification log:
  - Each of the 5 rules fires on a fixture user
  - Syllabus upload triggers extract → 3 confident-match skips, 1
    ambiguous proposal
  - Scanner runs end-to-end on event-driven trigger; daily cron
    catches data drift cases
  - Chat agent surfaces proactive buttons on "明日大学に行けないかも"
    and similar; doesn't on "疲れた"
  - Dismiss → polish-7 feedback row written; subsequent same-issue
    suppressed for 24h then re-eligible
  - Inbox + 7am digest show proactive proposals correctly
- Deviations from this brief + one-line reason for each
- Open questions for the next work unit (likely landing redesign
  showing this in action, then α invitation)

The next work unit (landing redesign with demo video showing the
proactive flow Ryuto outlined) picks up from there.
