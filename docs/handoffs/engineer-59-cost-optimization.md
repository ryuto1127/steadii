# Engineer-59 — Per-user cost optimization (audit + structural gating)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md` — the unit economics targets that drive this wave
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_sparring_engineer_branch_overlap.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_vercel_external_peers.md` — agent-side changes risk /api/chat regression; verify post-deploy

Reference shipped patterns:

- `lib/integrations/openai/client.ts` — central `openai()` client (cost call site)
- `lib/agent/email/classify-risk.ts` — L1 risk classifier (uses Mini per memory; verify)
- `lib/agent/email/classify-deep.ts` — L2 deep classifier (high tier only)
- `lib/agent/email/agentic-l2.ts` — agentic tool-using loop (highest per-call cost)
- `lib/agent/email/embeddings.ts` + `lib/agent/entity-graph/embedding.ts` + `lib/agent/entity-graph/extractor.ts` — embedding + extract paths
- `lib/agent/email/ingest-recent.ts:114-175` — the per-email gating site that decides what runs after L1
- `app/api/cron/*` — cron handlers (cron itself is cheap; what they INVOKE is the cost)
- Existing `recordUsage` function — every LLM call already logs taskType + tokens to DB. Activity log dashboard already surfaces some of this (engineer-48 / `/app/settings/activity-log`).
- `feedback_qstash_orphan_schedules.md` — Upstash console is where cron CADENCES live (not in repo); spec calls out console-side changes for Ryuto.

---

## Strategic context — the cost gap

Ryuto's 2026-05-14 spend: **\$1.50/day for 2 users** = **\$22/user/month**. Unit-economics target per `project_decisions.md`:

- Free tier: \$1.50/mo total token cost (loss-leader)
- Paying tier (Student/Pro): \$5/mo token cost in credit-metered features + ≤\$2/mo server overhead = **\$7/mo ceiling**

Current is **3-15× over target**. Today's number includes ~600 eval calls from engineer-53/54/56 verification runs, so tomorrow's baseline will be lower — but the structural gap is real.

Before changing anything, **audit where the cost actually goes** using `recordUsage` data. Don't optimize from intuition. Then attack the largest drivers.

---

## Scope — build in order

### Part 1 — Audit (read existing usage data)

Add a script `scripts/cost-audit.ts` (or extend `scripts/dogfood-stats.ts`) that queries `recordUsage` data and outputs:

- Total token spend by `taskType` for the last 24h / 7d / 30d
- Per-user breakdown (top spenders)
- Per-model breakdown (Mini vs full vs Nano)
- Per-route breakdown (chat / cron-* / webhook)
- Tokens per call (avg / p50 / p95) — surfaces overly chatty paths
- The 10 most expensive single LLM calls (commit_sha + chat_id) — surfaces specific runaway runs

Run against prod data, paste the output into the engineer-59 PR description. Use the output to **prioritize Parts 2–6** by actual impact.

Without this audit, the rest is guesswork.

### Part 2 — Skip embedding + entity-graph extract on \`auto_low\` bucket

`lib/agent/email/ingest-recent.ts` calls `embedAndStoreInboxItem` and `resolveEntitiesInBackground` for EVERY new email regardless of bucket. Low-tier items (newsletters, transactional, no-reply) don't need vector embeddings or entity-graph rows — they get auto-archived or stay invisible.

Gate both calls on `result.bucket !== "auto_low"`. Estimated savings: 30-50% of embedding + entity-extract cost for users with high low-tier ratio (typical inbox = 60-80% noise).

Test: existing `tests/ingest-recent.test.ts` (if exists) — add a fresh test that confirms auto_low items get a row but skip embed + entity.

### Part 3 — Agentic L2 trigger gating

Current condition (per memory): `users.preferences.agenticL2 = true` → agentic L2 fires on every classify-deep result. That's 5-10 LLM calls per high-tier email.

Refine the trigger so agentic L2 fires ONLY when its tool-using behavior earns its cost:

- Reply-intent emails (scheduling, RSVP, ask-clarifying) → agentic L2
- Read-only informational (course announcement, system notification, FYI) → skip agentic L2; the standard classify-deep summary is enough
- Already-classified by L1 with high confidence → may skip L2 entirely

Implementation: extend `lib/agent/email/agentic-l2.ts` entry point with a fast pre-check that inspects `result.bucket`, `result.confidence`, and (cheap heuristic) the subject + first 200 chars of body for reply-intent markers. Skip path emits the standard non-agentic deep-pass output.

Estimated savings: 50-70% of agentic-L2 cost (most non-reply high-tier emails are informational).

### Part 4 — Reduce hourly digest cron cadence (Ryuto manual + DEPLOY.md update)

Current QStash schedule (per snapshot):
- `/api/cron/digest` `0 * * * *` — every hour
- `/api/cron/weekly-digest` `0 * * * *` — every hour

Hourly digest invocations × 2 users = 48/day baseline. Each invocation calls LLM if the user crosses a digest boundary; many will fire LLM unnecessarily.

Update DEPLOY.md to document the cadence change. **Ryuto changes the actual Upstash schedules manually** (per `feedback_qstash_orphan_schedules.md` — QStash console is outside repo):
- `digest`: hourly → `0 7,19 * * *` (twice a day — morning + evening digest windows)
- `weekly-digest`: hourly → `0 9 * * 0` (Sunday 9am only)

This is a doc + comm change; the route handlers themselves don't need code changes. **DO NOT change the cron route's `force-dynamic` or its handler logic — the LLM gating inside each handler should already short-circuit when there's nothing to digest. If it doesn't, that's a separate Part 4a fix.**

### Part 5 — Prompt caching

OpenAI supports prompt caching: tokens at the start of the prompt that repeat across calls get a 50% cache hit discount (Mini) / 75% (full).

Steadii's system prompt is large (`lib/agent/prompts/main.ts` is ~250 lines). Every chat orchestrator call and most cron LLM calls pay full input-token price for this every time.

Audit which call sites would benefit:
1. Chat orchestrator (every iteration) — biggest win
2. Per-email classify-deep — moderate win
3. Persona-learner / style-learner cron — moderate win
4. One-shot tools (syllabus-extract, mistake-explain) — minimal benefit (less repeat)

Implementation: structure the OpenAI calls so the system prompt + tool definitions form the cacheable prefix. The OpenAI SDK auto-caches messages ≥ 1024 tokens with consistent prefix.

Estimated savings: 30-40% of input-token cost on chat orchestrator + classify-deep.

### Part 6 — Model tier audit + verification

Verify every LLM call uses the correct tier per `project_decisions.md`:
- Default (chat, tool calls): GPT-5.4 Mini
- Complex (mistake_explain, syllabus_extract, L2 draft): GPT-5.4 (full)
- Simple (chat_title, tag_suggest): GPT-5.4 Nano
- Voice cleanup: GPT-5.4 Mini

Grep for `model:` calls + cross-reference `selectModel(taskType)` usage. Any direct hardcoded model strings should be replaced with `selectModel(taskType)` so future tier changes are one-line edits.

Estimated savings: variable — depends on whether any path is currently using full when Mini would do.

### Part 7 — Cost telemetry dashboard

Engineer-48's `/app/settings/activity-log` already surfaces some usage data. Extend it with:

- "Today / this week / this month" total spend rollups
- Per-task-type breakdown chart
- Per-user breakdown (admin view)
- "Top 10 expensive runs" table (linkable to the specific chat)

Data source: the existing `recordUsage` table. No new schema needed.

Why this matters: ongoing cost monitoring vs the once-a-quarter audit. Ryuto should be able to spot a regression within a day, not at end-of-month.

### Part 8 — Failure-mode taxonomy

Add to `feedback_agent_failure_modes.md`:

```markdown
### `UNGATED_AGENT_WORK`

**Shape:** A code path performs LLM work on every input regardless of whether the work is justified for that input class. Example: embedding every auto_low email, agentic L2 on every high-tier informational notification, hourly digest cron firing LLM on idle hours.

**Root cause:** Initial implementations bias toward "always run" for simplicity; gating gets added later when costs surface.

**Fix:** Audit via `recordUsage` data; gate at the trigger site (bucket / intent / cadence) rather than inside the LLM call (which still costs the input-token round-trip). Engineer-59.
```

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-59
```

IMPORTANT before checkout: `git status` — may overlap with engineer-58 if that's in flight. See `feedback_sparring_engineer_branch_overlap.md`.

## Verification

- `pnpm typecheck` clean
- `pnpm test` full suite green + new gating tests
- `pnpm eval:agent` no regressions on the existing scenarios (gating skips should not affect agent behavior on the cases the evals test)
- `pnpm tsx scripts/cost-audit.ts` (the new script from Part 1) runnable against prod
- After deploy + 24h of normal usage: re-run cost-audit and confirm token spend has dropped — target the per-user numbers in `project_decisions.md`

## Out of scope

- Local LLM routing (explicitly locked-out per `project_decisions.md`)
- Self-hosting / OSS model — same
- OpenAI batch API for non-realtime crons (engineer-60 if needed)
- v2.0 Privacy Tier work — far future
- Removing features to save cost — the goal is the SAME features at lower per-op cost

## Memory entries to update on completion

- `feedback_agent_failure_modes.md` — new `UNGATED_AGENT_WORK` entry + cross-link to the gating sites
- `project_decisions.md` — if any of the gating changes the unit-economics math, update the margin lines accordingly
