# Engineer-58 — Tab-close resilience for chat agent runs

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_sparring_engineer_branch_overlap.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_vercel_external_peers.md` — this wave touches `lib/agent/orchestrator.ts`, verify `/api/chat` post-deploy

Reference shipped patterns:

- `app/api/chat/route.ts` — the streaming POST endpoint. Currently emits NDJSON / SSE-style events from the orchestrator's generator. Vercel aborts the route on client disconnect → orchestrator's generator stops yielding → next iteration's `await openai().chat.completions.create()` may finish or may get cancelled by the runtime.
- `lib/agent/orchestrator.ts` — the agent loop. Tool calls + LLM streams happen inside a `while (iterations < MAX_TOOL_ITERATIONS)` loop. DB updates happen row-by-row as the loop progresses.
- `lib/db/schema.ts` `messages` table — has `content`, `toolCalls`, `model`. Status is implicit (no row = pending, row with empty content = in-progress, row with content = done). Adding an explicit `status` column would simplify this layer.
- `app/app/chat/[id]/page.tsx` (or equivalent) — chat view that loads existing messages on mount.
- Existing QStash schedule pattern in `/api/cron/*` — for the deferred Part 3 below.

---

## Strategic context

The 2026-05-14 dogfood surfaced two related but distinct issues:

1. **PR #250 fixed the immediate symptom** — agent hit `MAX_TOOL_ITERATIONS = 10` mid-loop, and the forced-final-pass got skipped because mid-loop narration tripped the 20-char threshold. Bumped to 18 + 80 chars. The user staying on the tab now sees a complete response.

2. **The deeper architectural question Ryuto raised** — "サイトを離れたら止まってしまいますか? バックグラウンドで動き続けませんか?" — is not solved by PR #250. Today: client closes tab → Vercel aborts the route → agent run interrupted. User comes back later → sees the half-finished message in DB with no way to resume.

This wave addresses (2) with a **lightweight approach** suitable for α: don't fully refactor to a queue-based architecture; instead make the agent disconnect-resilient + give the UI a way to pick up where it left off.

Full QStash-based job queue refactor is engineer-59+ scope (post-α). The lightweight approach gets us 80% of the value at 10% of the cost.

---

## Scope — build in order

### Part 1 — Agent ignores client disconnect

`app/api/chat/route.ts` (or wherever the orchestrator gets invoked):

- Read `request.signal` (the Web Fetch API `AbortSignal` Vercel forwards). Currently the orchestrator's generator implicitly cooperates with this signal — when the runtime aborts the route, the OpenAI fetch inside the generator gets cancelled.
- Override this behavior: **the orchestrator's run completes regardless of the client connection**. Once the user submits a message, the agent's work commits to running to completion.
- Implementation: instead of piping the orchestrator's events directly into the streaming response, fork the orchestrator run into a "fire-and-forget" coroutine that owns its lifecycle. The streaming response observes the same event stream (e.g. via an internal pub/sub or by reading from the DB) but its abortion doesn't kill the agent.
- Concretely: `waitUntil` from Vercel's edge runtime can hold a Promise alive past the response. Or for Node runtime, just don't tie the orchestrator's lifecycle to the response stream.

Set `export const maxDuration = 300` (Vercel max for hobby tier; 800 for pro). The agent has up to 5 min to complete regardless of client.

### Part 2 — Explicit message status + UI resume

Add a `status` column to the `messages` table:

```sql
ALTER TABLE messages ADD COLUMN status text NOT NULL DEFAULT 'done';
-- new values: 'pending' (job created, work not started), 'processing'
-- (orchestrator running), 'done' (final content committed), 'error'
-- (orchestrator threw), 'cancelled' (rare — user explicitly aborted).
```

Migration: additive, defaults to `'done'` so existing rows remain valid.

Orchestrator updates the status as it runs:
- Insert assistantMessage row with `status = 'processing'` at loop start
- On normal completion: `status = 'done'`
- On error throw: `status = 'error'` + persist the error message into `content`
- The forced-final-pass path sets `'done'` after writing the synthesized text

Update the chat view:
- On mount AND on `visibilitychange` event (tab focus return), refetch the message list
- For any message with `status = 'processing'`, render the in-progress state (chip with current tool calls + spinner where draft would go) and poll every 2 seconds for status change OR receive new content
- Once status flips to `'done'` or `'error'`, stop polling and render the final state
- The poll endpoint can be a thin `/api/chat/messages/[id]/status` returning `{ status, content, toolCalls }`

This addresses "user navigates away mid-run, comes back later" — they see the completed (or in-progress) state without having to re-trigger anything.

### Part 3 — Cross-tab / cross-device pickup (DEFERRED — engineer-59)

For α, polling is enough. Post-α we may want:
- Server-Sent Events from the message status endpoint (continuous push of content updates as they happen, no poll overhead)
- WebSocket-based chat for true real-time
- Push notifications when a long agent run completes ("Steadii finished your reply draft")

All of these are post-α. Don't ship them in this wave. Mention in the new failure-mode entry as future work.

### Part 4 — Failure-mode taxonomy

Add to `feedback_agent_failure_modes.md`:

```markdown
### `AGENT_RUN_LOST_ON_DISCONNECT`

**Shape:** User submits a chat message that triggers a long agent run (≥30 seconds for a multi-slot reply). User closes the tab or navigates away. When they return, the assistant message is half-finished — some tool calls visible, no draft body, no way to resume.

**Root cause (pre-engineer-58):** Vercel aborts the route on client
disconnect → orchestrator's OpenAI streams get cancelled → loop
terminates mid-iteration. DB has whatever was persisted before the
abort, which may be just the tool-call envelope without the final
draft text. The UI has no signal that the run was incomplete vs
intentionally ended.

**Fix:** Agent ignores client disconnect (`waitUntil` / fire-and-
forget pattern in /api/chat). Explicit `messages.status` column +
UI poll on `'processing'` rows. Engineer-58.
```

### Part 5 — Self-critique not needed

This wave is infrastructure-level — no prompt rules, no detectors, no new eval scenarios. The existing scenarios already validate agent behavior on complete runs; this wave only changes when "complete" can happen relative to client connection.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-58
```

IMPORTANT: this wave touches `app/api/chat/route.ts` AND `lib/agent/orchestrator.ts` AND `lib/db/schema.ts`. After deploy, verify `/api/chat` does not 500 — see `feedback_vercel_external_peers.md` for the recurring lambda-packaging risk on agent-orchestrator changes.

## Verification

- `pnpm typecheck` clean
- `pnpm test` full suite green
- `pnpm eval:agent` — all scenarios pass (none of them care about disconnect handling, but verify nothing regressed)
- Manual: in dev preview, start a long agent run, close the tab mid-run, reopen the chat 30 seconds later → expected: completed response visible
- Manual: server logs show the orchestrator continuing past client disconnect (look for "client disconnected, continuing" log line if you add one)
- Migration 0044 (or next available index) applied to prod per `feedback_prod_migration_manual.md`

## Out of scope

- Full QStash queue refactor (engineer-59)
- Server-Sent Events / WebSocket push (engineer-59)
- Push notifications for completed long runs (post-α)
- Cancellation UX (user-initiated abort button) — possible but not needed for α
- Multi-tab live sync — the poll mechanism inherently does eventual-consistency multi-tab

## Memory entries to update on completion

- `feedback_agent_failure_modes.md` — new `AGENT_RUN_LOST_ON_DISCONNECT` entry
