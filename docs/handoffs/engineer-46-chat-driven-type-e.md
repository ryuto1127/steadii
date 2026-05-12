# Engineer-46 — Chat-driven Type E resolution ("Steadii と話す" button)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md` — Type E card lives here
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — risk-tiered model
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — Ryuto's location (Vancouver, PDT/PST)

Reference shipped patterns:

- `components/agent/queue-card.tsx:928` — `QueueCardERender`. Currently has 3 actions: submit / ask-later / reject. PR #208 added the "Steadii に送る" copy + toast.
- `components/agent/queue-list.tsx:208` — `onSubmit` wiring for Type E. Mirror this for the new `onTalkInChat` prop.
- `app/app/queue-actions.ts:277` — `queueSubmitClarificationAction`. Engineer-45 (PR #212) added immediate L2 re-run on freeText submit; chat-driven path is the multi-turn alternative.
- `lib/agent/orchestrator.ts` (or `lib/agent/prompts/main.ts` — engineer-45 enhanced this) — chat tool-using loop + system prompt with user TZ injection.
- `lib/agent/tools/convert-timezone.ts` — engineer-45's deterministic TZ tool. Available to every chat session, including the new clarification-chat path.
- `lib/agent/email/agentic-l2.ts` + `agentic-l2-prompt.ts` — agentic L2 entry + prompt with engineer-45's TZ rules.
- `components/chat/chat-view.tsx` — main chat UI. The new session lands here.
- `app/app/chat/[id]/page.tsx` (verify the path) — chat session page. Reuse as-is.
- `lib/db/schema.ts` — `chat_messages` + `chat_sessions` (verify naming). New chat session row gets a seed message.

---

## Strategic context

Ryuto's 2026-05-12 transcript: when Steadii needs clarification on an inbox email, the current Type E card forces a single-shot text input. For nuanced cases (the 令和トラベル interview thread had 12+ turns of TZ disambiguation, slot selection, AM/PM, etc.), one input field is not enough. The user wants to **chat with Steadii to determine the email content collaboratively**, not stuff everything into a single textarea.

Engineer-45 (PR #212) shipped the foundation: agent now has `convert_timezone` tool + system prompt with user TZ + scheduling-domain rules + immediate L2 re-run on the existing single-shot submit path. Engineer-46 layers the **multi-turn chat path** on top — same agent, same tool kit, new entry point + a tool to finalize the conversation back into the queue.

Design principle: **keep both paths**. Single-shot textarea for quick yes/no answers; chat-driven path for nuanced multi-turn cases. Each user picks per situation.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-46
```

---

## Scope

### Part 1 — "Steadii と話す" button on Type E cards

Edit `components/agent/queue-card.tsx` `QueueCardERender`.

New button between "Steadii に送る" and "後で聞く":

```
[Steadii に送る]  [Steadii と話す]  [後で聞く]  [却下]
```

EN: "Talk to Steadii". Mirror the styling of the existing pill row.

New i18n keys (EN + JA): `queue.card_e.talk_in_chat` = "Steadii と話す" / "Talk to Steadii".

Wire a new optional prop `onTalkInChat?: () => Promise<void>` on `QueueCardERender`. Plumb through `components/agent/queue-list.tsx`'s server-action props.

### Part 2 — Server action: `startClarificationChatAction`

New action in `app/app/queue-actions.ts`:

```ts
export async function startClarificationChatAction(
  rawCardId: string
): Promise<{ chatId: string }>;
```

What it does:
1. Auth check + parse card id (existing `parseCardId` helper)
2. Load the original `agent_drafts` row (status='pending', action='ask_clarifying')
3. Load the underlying `inbox_items` row for context
4. Create a new `chat_sessions` row tied to the userId
5. Insert a seeded system message + a first assistant message:
   - **System** (hidden from UI render — flagged `role='system'` per existing pattern): contains the agentic-L2 continuation context (see Part 4)
   - **Assistant** (visible — `role='assistant'`): renders Steadii's clarifying question as the first turn. Pull from `agent_drafts.reasoning` or `agent_drafts.draft_body` (whichever holds the question — verify)
6. Persist a back-link from `chat_sessions` → original `agent_drafts.id` so the chat can resolve it later (new column `chat_sessions.clarifying_draft_id uuid nullable` — small migration)
7. Return `{ chatId }`. Queue-list calls `router.push(\`/app/chat/${chatId}\`)`.

Server-action returns Promise<{ chatId }> rather than redirecting because the client wants the id to push to.

### Part 3 — Schema migration

`chat_sessions` (verify table name) — add:

```sql
ALTER TABLE chat_sessions ADD COLUMN clarifying_draft_id uuid REFERENCES agent_drafts(id) ON DELETE SET NULL;
CREATE INDEX chat_sessions_clarifying_draft_idx ON chat_sessions(clarifying_draft_id) WHERE clarifying_draft_id IS NOT NULL;
```

Drizzle migration + `meta/_journal.json` entry per `feedback_prod_migration_manual.md`. Sparring will run `pnpm db:migrate` against prod after merge.

### Part 4 — Seeded chat orchestrator context

Edit `lib/agent/prompts/main.ts` (or wherever the chat system prompt assembles) to detect a clarification session (presence of `chat_sessions.clarifying_draft_id` non-null) and prepend a context block to the system message:

```
You are continuing an agentic L2 email-reasoning session that paused because you needed clarification from the student. The original email is attached below. Your previous reasoning identified the ambiguity as:

  {agent_drafts.reasoning}

Original email:
  From: {senderEmail} ({senderDomain})
  Subject: {subject}
  Body: {body up to 8000 chars}

Sender TZ: {inferSenderTzFromDomain result, if non-null}

Your job: ask the student short, specific questions to gather just enough info to make a decision. When you have enough, call write_draft to draft the reply, then call resolve_clarification with the result so the original Type E card closes.

Iteration cap: 8 turns. Be efficient — don't re-ask things the email already answered.
```

`write_draft` is already an agentic L2 tool. Wire it into the chat orchestrator's tool list when the session is a clarification session — likely a runtime tool-list mutation based on session type.

### Part 5 — New chat tool: `resolve_clarification`

New file: `lib/agent/tools/resolve-clarification.ts`.

Tool definition:

```ts
name: "resolve_clarification"
description: "Finalize a clarification chat by creating a new email draft and closing the original ask_clarifying card. Call this only after you've gathered enough info from the student AND called write_draft. The student's chat thread becomes the audit trail."
```

Input schema (zod):
- `originalDraftId: string` — passed via session context, but accept as input for explicitness
- `newAction: "draft_reply" | "ask_clarifying" | "notify_only" | "no_op"` — usually draft_reply by this point
- `draftBody: string` — the resolved reply body (from write_draft output)
- `draftSubject: string`
- `draftTo: string[]`
- `draftCc: string[]`
- `reasoning: string` — natural-language explanation (engineer-45's tool-name-forbid rules apply)

What it does:
1. Auth check (chat orchestrator owns the userId in context)
2. Verify the original draft exists, belongs to user, status='pending', action='ask_clarifying'
3. Transaction:
   - INSERT new `agent_drafts` row with the resolved values, status='pending', source=original.inboxItemId
   - UPDATE original `agent_drafts` SET status='dismissed'
   - INSERT `email_audit_log` entry linking both (subAction='clarification_resolved_via_chat')
4. Return `{ newDraftId, status: "resolved" }`

Register in `lib/agent/tool-registry.ts` — but ONLY available when chat session has `clarifying_draft_id`. Otherwise the tool isn't in the agent's tool list.

### Part 6 — UI polish: link back to the original card

The chat view should show a small banner at the top: "解決中の確認カード: {original card title}" with a "↩ キューに戻る" link. EN: "Resolving clarification: {title}". Click navigates back to `/app`. Small thing; pure UX.

New i18n keys (EN + JA): `chat.clarification_banner.title`, `chat.clarification_banner.back`.

---

## Out of scope

- **User-fact memory** (replacement for the dead "+ Steadii のメモに追加" pill from PR #210) — separate engineer-47.
- **Persistent "私の時刻指定は基本的に PT" preference** — would let the agent skip the TZ disambiguation question. Useful follow-up but outside this scope.
- **Voice input in the clarification chat** — should work automatically via existing /app/chat voice support. Confirm during dogfood; if broken, separate ticket.
- **Chat session resume after page reload** — sessions are persistent already; just verify the seeded context survives a refresh.
- **Push notifications when the chat resolves** — Type C / queue surface refresh is sufficient.
- **Multi-card batching** — one chat session per clarifying card. Resolving multiple cards in one chat is future scope.

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new tests for:
   - `startClarificationChatAction` — creates session with right seed; back-link column populated
   - `resolve_clarification` tool — dismisses original draft + inserts new one in a transaction; audit log linked
   - Chat orchestrator includes `resolve_clarification` in tool list only for clarification sessions
3. **Live dogfood**:
   - Find a Type E card in the queue (use Ryuto's actual queue if one is present, else seed one via SQL on dev)
   - Click "Steadii と話す" — chat opens with the email context + Steadii's first turn rendering the original clarifying question
   - Reply naturally; verify Steadii either drafts the reply (and closes the original card) or asks a follow-up
   - Confirm the new draft appears in the queue as a fresh card after `resolve_clarification` fires
4. Screenshot: Type E card with the new "Steadii と話す" button, the seeded chat thread first turn, and the resolved-into-queue new card.

---

## Commit + PR

Branch: `engineer-46`. Push, sparring agent creates the PR.

Suggested PR title: `feat(queue,chat): chat-driven Type E resolution — "Steadii と話す" button + seeded chat orchestrator + resolve_clarification tool (engineer-46)`

---

## Deliverable checklist

- [ ] `components/agent/queue-card.tsx` — new "Steadii と話す" button + `onTalkInChat` prop
- [ ] `components/agent/queue-list.tsx` — wires the new prop to `startClarificationChatAction` + router.push
- [ ] `app/app/queue-actions.ts` — new `startClarificationChatAction`
- [ ] `lib/db/migrations/<NNNN>_chat_clarifying_draft_link.sql` + journal entry
- [ ] `lib/db/schema.ts` — `chat_sessions.clarifyingDraftId` column
- [ ] `lib/agent/prompts/main.ts` — seeded context for clarification sessions
- [ ] `lib/agent/tools/resolve-clarification.ts` — new tool
- [ ] `lib/agent/tool-registry.ts` — register conditionally on session type
- [ ] `lib/i18n/translations/{ja,en}.ts` — new keys: `card_e.talk_in_chat`, `chat.clarification_banner.title`, `chat.clarification_banner.back`
- [ ] Chat view: banner with back-to-queue link
- [ ] Tests for all of the above
- [ ] Live dogfood verified
