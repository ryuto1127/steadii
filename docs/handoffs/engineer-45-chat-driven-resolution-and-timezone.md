# Engineer-45 — Chat-driven Type E resolution + immediate re-draft + timezone-aware slot proposals

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_ms_education_admin_consent.md` — why Teams API is dead-piled
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — risk-tiered confirmation model
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md` — Type E card lives here

Reference shipped patterns:

- `components/agent/queue-card.tsx:928` — `QueueCardERender` — the Type E card surface Ryuto interacts with.
- `components/agent/queue-list.tsx:208` — `onSubmit` wiring; toast on submit landed PR #208.
- `app/app/queue-actions.ts:277` — `queueSubmitClarificationAction` — current flow: logs audit, dismisses draft, **no immediate L2 re-run**. Comment on line 270 explicitly defers "deeper integration with the orchestrator (the user's answer driving an immediate re-draft) is Wave 3" — Wave 3 shipped but this part was never implemented.
- `components/chat/chat-view.tsx` — main chat UI; the new "Steadii と話す" path opens a chat session with seeded context.
- `lib/agent/orchestrator.ts` — chat tool-using loop. Mirror its pattern when re-running L2 with the user's freeText as added context.
- `lib/agent/email/agentic-l2.ts` — agentic L2 entry; `lib/agent/email/agentic-l2-prompt.ts` — prompt edited in PR #207 to forbid tool-name leaks.
- `lib/agent/email/l2-tools/check-availability.ts` (and sibling tool files in `lib/agent/email/l2-tools/`) — the dual-timezone slot return shape. Audit to confirm the draft prompt actually uses both TZs.
- `lib/agent/preferences.ts` — `getUserTimezone(userId)` already exists per memory; verify it's wired into the L2 / draft pipeline.

---

## Strategic context

Three Ryuto pain points (2026-05-12):

1. **Type E card "nothing happens"** — clicking the submit button logs the answer to audit but doesn't trigger any visible Steadii action. Comment at `queue-actions.ts:270` explicitly notes this gap. PR #208 added a toast but the underlying behavior is still "answer banked for later, no re-draft now".
2. **"chat しながら email 内容を決める"** — user wants to collaborate with Steadii via natural conversation when extra info is needed, not via a single-shot input field. The Type F confirmation card pattern is too rigid for the cases where Steadii itself is unsure what to ask.
3. **Timezone-aware scheduling** — Ryuto's local TZ should be respected when Steadii proposes slots in drafts. Even though the agentic L2 tools include `infer_sender_timezone` and `check_availability` returns dual-TZ display strings, it's unclear whether the draft body actually surfaces both TZs to the recipient.

The アクメトラベル interview email is the canonical test case:
- Email from JP recruiter (likely Asia/Tokyo TZ)
- Ryuto is in Vancouver (America/Vancouver — UTC-7/-8 depending on DST)
- Proposed slots in the email are listed in JST
- Draft must offer slots that work for BOTH parties + display both TZs

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-45
```

---

## Scope

### Part 1 — "Steadii と話す" button on Type E cards

New affordance on `QueueCardERender`: a third action alongside the existing submit / ask-later / reject buttons:

```
[Steadii に送る]  [Steadii と話す]  [後で聞く]  [却下]
```

EN equivalent: "Talk to Steadii". Place between submit and ask-later.

**Behavior**: clicking creates a new chat session, pre-populates it with the email context + Steadii's clarifying question + a system instruction telling the orchestrator to continue the agentic L2 reasoning loop with whatever the user provides. Navigates to `/app/chat/<new-session-id>`.

**Seeded chat shape**:

```
System (hidden from UI):
  You are continuing an agentic L2 email-reasoning session that paused
  because you needed clarification from the student. The original email
  is attached below. Your previous reasoning identified the ambiguity
  as: "<the issueSummary from the agent_drafts row>".
  
  Your job: ask the student short, specific questions to gather just
  enough info to make a decision. When you have enough, call write_draft
  to draft the reply, then call <new tool> resolve_clarification with
  the draft to mark the original ask_clarifying card resolved.

User (visible):
  「<the agent's question, rendered as Steadii's first message>」
```

Each turn: user replies, agent decides whether it has enough info; if yes, drafts + closes the original card; if no, asks the next question. Loop bound at 8 turns to avoid runaway costs.

**New chat tool**: `resolve_clarification` — wraps:
- `UPDATE agent_drafts SET status='dismissed' WHERE id=<original draft id>` (close the Type E card)
- `INSERT agent_drafts` for the newly-resolved draft, status='pending', so it shows up in the queue as a Type B/C/F card per the resolved action.
- `INSERT email_audit_log` entry tying both rows so the chat history is auditable.

Tool args: `originalDraftId`, `newAction`, `newDraftBody`, `newDraftSubject`, `newDraftTo`, `newDraftCc`, `reasoning`.

**Where to put the new context plumbing**:
- Add a new server action `startClarificationChatAction(draftId)` that creates the chat session, seeds the system message, and returns the session id.
- Wire `QueueCardERender` to a new prop `onTalkInChat`. `queue-list.tsx` calls the new action then `router.push("/app/chat/<sid>")`.

### Part 2 — Immediate re-draft on freeText submit (smaller fix, related)

Current `queueSubmitClarificationAction`: logs audit + dismisses draft. Nothing else.

New behavior: when `args.freeText.trim().length > 0`, after logging audit, **synchronously re-run L2** for the same inbox item with the user's text appended as additional context. The audit log entry becomes the "what the user told Steadii" record; the new agent_drafts row is the re-drafted reply.

Implementation:
- Append `args.freeText` to a new `inbox_items.userClarification` column (TEXT, nullable) — needs migration. Or: pass it through as a parameter to `processL2` via the new options arg.
- Re-call `processL2(inboxItemId, { userClarification: args.freeText })`.
- The agentic L2 prompt + agentic-l2.ts pass `userClarification` to the LLM in the user message so the loop knows the student already weighed in.

This makes the existing single-shot Type E flow actually do something visible immediately. Plus the new chat path (Part 1) gives a multi-turn alternative for harder cases.

**Schema migration** if you go the column route: standard pattern, include the `meta/_journal.json` entry per `feedback_prod_migration_manual.md`.

### Part 3 — Timezone-aware slot proposals

Audit + fix gaps. The agentic L2 tools already include `infer_sender_timezone` and `check_availability` (which returns dual-TZ display strings per the spec). The question is whether the **draft prompt itself** actually uses both TZs in the reply body.

Audit steps:
1. Read `lib/agent/email/draft.ts` and `lib/agent/email/agentic-l2-prompt.ts`. Trace how `check_availability` output flows into `write_draft`'s user message. Confirm both TZ strings are present.
2. If only one TZ surfaces: extend the draft prompt to instruct the model to render slots in **both** TZs whenever the sender's TZ != the student's TZ. Example: "5月15日(木) 10:00–10:30 JST / 5月14日(水) 18:00–18:30 PDT".
3. Verify `getUserTimezone(userId)` is called and threaded into the draft prompt as `Student TZ: <iana>`.

Test case: アクメトラベル — JST sender, PDT student, 30-minute interview slot. Draft body must show both TZs side-by-side for any candidate slot it proposes.

If `getUserTimezone` doesn't exist or isn't wired: search `lib/agent/preferences.ts` and the users.preferences schema. Add the helper if missing.

---

## Out of scope

- **Teams Assignments API integration** — still dead-piled (`feedback_ms_education_admin_consent.md`).
- **Adaptive question-count limit** — fixed 8-turn bound; future iteration could learn user's tolerance.
- **Voice input in the new chat thread** — existing voice path (PR #184 era) should auto-pick it up since /app/chat already supports voice; no extra work needed unless you find a gap.
- **Push notifications when a clarification chat finishes** — Type C card surface in the queue is enough for α.
- **Replace Type E single-shot submit entirely** — keep BOTH paths. Single-shot for quick yes/no answers, chat for nuanced cases. Removing the textarea would lose a fast affordance.

---

## Verification

After implementing:

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new tests for:
   - `startClarificationChatAction` creates session with correct seed
   - `resolve_clarification` tool dismisses original draft + creates new one
   - `queueSubmitClarificationAction` with freeText re-runs L2 with that text as context
   - Draft prompt renders dual-TZ when student TZ != sender TZ
3. **Live dogfood via preview**:
   - Log in as Ryuto's account, find the アクメトラベル row
   - Click the new "Steadii と話す" button — chat opens with the email context + Steadii's question as the first turn
   - Reply naturally; verify Steadii either drafts the reply (and closes the card) or asks a follow-up
   - Confirm the new draft appears in the queue with both TZs in the body if applicable
4. Screenshot: Type E card with the new "Steadii と話す" button; chat thread with the first agent turn; final draft body showing dual-TZ slots.

---

## Commit + PR

Branch: `engineer-45`. Push, sparring agent creates the PR.

Suggested PR title: `feat(queue,l2): chat-driven Type E resolution + immediate re-draft + dual-TZ slot proposals (engineer-45)`

Suggested body bullets:

- New "Steadii と話す" button on Type E cards — opens a chat session seeded with the email + Steadii's question; user clarifies via multi-turn conversation; agentic L2 resolves the original card with a new draft when it has enough.
- New `startClarificationChatAction` server action + `resolve_clarification` chat tool.
- `queueSubmitClarificationAction` now re-runs L2 with the freeText as added context (immediate re-draft instead of "wait for next email").
- Audit + fix dual-TZ slot rendering in draft bodies — Student TZ is now threaded into the prompt and required when sender TZ differs.
- N new unit tests.

---

## Deliverable checklist

- [ ] `QueueCardERender` — new "Steadii と話す" button + prop `onTalkInChat`
- [ ] `queue-list.tsx` — wires the new prop to `startClarificationChatAction` + router.push
- [ ] `app/app/queue-actions.ts` — new `startClarificationChatAction` server action
- [ ] `queueSubmitClarificationAction` — re-runs L2 with freeText as added context
- [ ] `lib/agent/orchestrator.ts` or sibling — handles the seeded clarification session
- [ ] `lib/agent/email/l2-tools/resolve-clarification.ts` (or in `tools/`) — new chat tool
- [ ] `lib/agent/email/agentic-l2-prompt.ts` — added handling for `userClarification` context, plus dual-TZ rendering instruction
- [ ] `lib/agent/email/draft.ts` — student TZ threaded into the draft prompt; dual-TZ slot strings required when sender TZ differs
- [ ] `lib/i18n/translations/{ja,en}.ts` — new keys `card_e.talk_in_chat` ("Steadii と話す" / "Talk to Steadii")
- [ ] Migration if you add `inbox_items.userClarification` (or skip the column, pass via processL2 options arg — your call)
- [ ] Tests for all of the above
- [ ] Preview dogfood verified
