# Engineer-41 — Agentic L2: LLM-driven, tool-using email reasoning

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_qstash_orphan_schedules.md`

Reference shipped patterns:

- `lib/agent/orchestrator.ts` — the chat agent's tool-using loop. Engineer-41 reuses this exact pattern. Study the iteration cap, tool-call accumulation, error degradation, forced final-pass behavior.
- `lib/agent/email/l2.ts` — current single-shot L2 pipeline. New code lives next to it; existing code stays as the fallback path.
- `lib/agent/email/classify-deep.ts` — single-shot deep pass. The new agentic loop replaces it conceptually but does NOT delete it.
- `lib/agent/email/persona-learner.ts` — pattern for structured LLM extraction + DB upsert. New tools use similar structure.
- `lib/agent/tools/email.ts`, `lib/agent/tools/email-thread.ts` — chat-agent tools that already wrap email read APIs. The new L2 tools can reuse these helpers internally.

---

## Strategic context

Ryuto challenge 2026-05-11: "人間レベルの秘書は LLM 主導でないと無理。rule ベースで countless situation を捌くのは不可能。"

The truth: Steadii's brain (`classify-deep.ts`) IS already LLM. What's rule-based is the **orchestration around it** — the prompt is single-shot, context is statically assembled, and downstream actions (draft, action_items extraction) are fixed in the code path. Real situations don't fit this mold:

- Email asks "pick one of these 3 slots" → Steadii needs to actually CHECK the user's calendar for each slot before drafting a reply
- Email mentions a time in JST → Steadii needs to INFER the sender's timezone from prior correspondence + user calendar offsets, ask the user when uncertain, persist the answer
- Email is ambiguous → Steadii needs to surface a QUESTION to the user, not silently guess and ship a bad draft

These behaviors require the LLM to drive the next-step decision dynamically — i.e., **tool use**. The chat agent already has this loop; engineer-41 brings it to L2.

This is not a small change. It's the architecture shift Ryuto laid out: **brain = LLM, sensors/effectors = code**. The agentic L2 is the brain, the new tools are the sensors and effectors, and the existing single-shot L2 stays as a fallback (feature-flagged off for users not yet ready for the higher cost path).

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected commit: PR #193 (Wave 1 — L2 full body + JA bug + mini downgrade). If main is behind that, **STOP**.

Branch: `engineer-41-agentic-l2`. Don't push without Ryuto's explicit authorization.

---

## What changes

### Part 1 — Agentic L2 orchestrator (~400 LOC)

New file `lib/agent/email/agentic-l2.ts`:

- Exported function `runAgenticL2(input)` with the same `DeepPassResult` shape as current `runDeepPass` (action + reasoning + actionItems) PLUS new fields:
  ```ts
  {
    // existing
    action, reasoning, retrievalProvenance, actionItems,
    // new
    confirmationQuestions: ConfirmationQuestion[],    // surfaces as Type F cards
    inferredFacts: InferredFact[],                    // persisted to agent_contact_personas
    availabilityChecks: AvailabilityCheck[],          // used by draft phase
    schedulingDetected: boolean,                      // for downstream branching
  }
  ```
- Implementation mirrors `lib/agent/orchestrator.ts`:
  - Initialize conversation with system prompt + user email context
  - Loop with `tool_choice: "auto"`, max 10 iterations
  - Each iteration: collect tool calls from streaming response, execute, append results, continue
  - On no-tool-calls iteration → final response, break
  - Cap exhaustion → forced final-pass with `tool_choice: "none"` (per orchestrator.ts pattern)
- Model: GPT-5.4 full (driver), per-tool model selection inside each tool
- Streaming events: emit `tool_call_started` / `tool_call_result` for observability (same shape as chat orchestrator), audit log per iteration

The agentic loop is the brain. It doesn't directly write to agent_drafts — it returns the structured result, and the existing `l2.ts` persists it as before.

### Part 2 — Tool registry for L2 (~600 LOC)

All new tools live under `lib/agent/email/l2-tools/`:

- `extract_candidate_dates.ts` — given an email body, returns structured candidate dates with timezone hints:
  ```ts
  {
    candidates: [
      { date: "2026-05-15", startTime: "10:00", endTime: "11:00", timezoneHint: "JST", confidence: 0.95, sourceText: "2026/5/15 (金) 10:00 〜 11:00" },
      ...
    ]
  }
  ```
  - Uses LLM (mini) for parsing — date formats are too varied for regex
  - Timezone hint inferred from explicit markers ("JST", "EST", "(金)" / "(Fri)" patterns)
  - Returns empty array if no dates detected

- `infer_sender_timezone.ts` — combines data-derived + LLM:
  ```ts
  {
    timezone: "Asia/Tokyo" | null,
    confidence: number,
    source: "calendar_offset_inference" | "domain_heuristic" | "llm_body_analysis" | "persona_locked",
    samples: number,
  }
  ```
  - Step 1: check `agent_contact_personas.structured_facts.timezone` for locked value → return high confidence if present
  - Step 2: query past sent emails to this recipient + matching user calendar events → compute time offset across samples
  - Step 3: if neither, ask LLM to analyze the email body + domain
  - Returns null + low confidence when truly uncertain (caller decides whether to ask user)

- `check_availability.ts` — wraps existing calendar tool:
  ```ts
  input: { slots: [{ start: ISO, end: ISO }], userTimezone, displayTimezone }
  output: { results: [{ slot, isAvailable, conflictingEvents: [...], displayTimes: { user: "5/14 18:00 PT", sender: "5/15 10:00 JST" } }] }
  ```
  - Reads from existing `listEventsInRange` in `lib/calendar/events-store.ts`
  - Converts between timezones for display
  - Returns dual-timezone strings for downstream prompt use

- `lookup_contact_persona.ts` — read from `agent_contact_personas`:
  ```ts
  { relationship, facts, structuredFacts: { timezone, response_window, ... }, lastExtractedAt }
  ```

- `queue_user_confirmation.ts` — surfaces a Type F card (engineer-42 territory; for now writes to a new `agent_confirmations` table that engineer-42 will pick up):
  ```ts
  input: { question: string, options: string[], context: { topic, senderEmail, inferredValue } }
  output: { confirmationId, status: "queued" }
  ```
  - Inserts row into `agent_confirmations` (schema in Part 4)
  - Does NOT block — the agentic loop returns "I asked the user, will use inferred value for now" and continues

- `detect_ambiguity.ts` — LLM judge for "should we ask?":
  ```ts
  input: { context, decision, confidence }
  output: { ambiguous: boolean, suggestedQuestion: string | null }
  ```

- `write_draft.ts` — calls existing `runDraft` with the assembled context:
  ```ts
  input: { senderEmail, ..., availabilityHints, persona, ... }
  output: { subject, body, kind }
  ```
  - This is the "effector" — the LLM-driver decides WHEN to call it (only when action === "draft_reply")

Each tool has its own `.test.ts`. Tools are pure functions invoked by the orchestrator's tool-dispatch layer.

### Part 3 — Wire agentic L2 into pipeline (~150 LOC)

`lib/agent/email/l2.ts`:

- Read `users.preferences.agenticL2` (new key). Default `false` — flip to `true` for Ryuto's dogfood account first.
- Inside the high-risk branch (where `runDeepPass` currently fires), branch:
  - If `agenticL2 === true` → call `runAgenticL2(input)`, persist its richer output onto `agent_drafts` + `agent_confirmations` + `agent_contact_personas` as appropriate
  - Else → existing `runDeepPass` path unchanged (fallback)
- Both paths produce the same minimum `DeepPassResult` shape so downstream code (draft phase) doesn't care which ran

### Part 4 — `agent_confirmations` schema (~50 LOC migration)

New table `agent_confirmations`:

```sql
CREATE TABLE agent_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic text NOT NULL,                       -- e.g. "timezone", "sender_role", "language_preference"
  sender_email text,                          -- nullable; some confirmations are not sender-specific
  question text NOT NULL,                     -- LLM-generated question shown to user
  inferred_value text,                        -- the value Steadii is asking the user to confirm/correct
  options jsonb,                              -- structured options when multi-choice
  status text NOT NULL DEFAULT 'pending',     -- pending / confirmed / corrected / dismissed
  resolved_value text,                        -- user's answer
  resolved_at timestamptz,
  originating_draft_id uuid REFERENCES agent_drafts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_confirmations_user_status_idx ON agent_confirmations (user_id, status, created_at);
```

Migration file `lib/db/migrations/0035_agentic_l2.sql`. **Add the matching journal entry in `lib/db/migrations/meta/_journal.json`** — the engineer-39 incident showed this is non-optional. Schema for `agent_contact_personas.structured_facts` (already in 0034) is reused for fact persistence.

### Part 5 — Structured facts upgrade for personas (~100 LOC)

`lib/agent/email/persona-learner.ts` + L2 inferred-facts persistence:

- Add `structured_facts jsonb` column to `agent_contact_personas` via the 0035 migration (or extend the existing free-form `facts` field — engineer choice, pick whichever is less disruptive).
- Shape:
  ```ts
  {
    timezone: { value: string, confidence: number, source: string, samples: number, confirmedAt: ISO | null },
    response_window_hours: { value: string, confidence: number, ... },
    primary_language: { value: "ja" | "en", confidence: number, ... }
  }
  ```
- `runAgenticL2`'s `inferredFacts` output flows into this table.
- When a confirmation card is resolved, `confirmedAt` flips and `confidence` upgrades to 1.0.
- L2 prompts read this and inject as "Known about this contact" block.

### Part 6 — Feature flag + dogfood enable (~30 LOC)

`users.preferences.agenticL2: boolean | undefined` — opt-in.

- Settings page: add a "Beta features" section with a toggle (EN + JA copy).
- Backfill: set Ryuto's account to `true` directly via SQL in the deploy notes.

---

## Files

- `lib/agent/email/agentic-l2.ts` (NEW, ~400 LOC)
- `lib/agent/email/l2-tools/` (NEW directory)
  - `extract_candidate_dates.ts` (~80 LOC)
  - `infer_sender_timezone.ts` (~150 LOC — most complex, blends data + LLM)
  - `check_availability.ts` (~80 LOC)
  - `lookup_contact_persona.ts` (~50 LOC)
  - `queue_user_confirmation.ts` (~80 LOC)
  - `detect_ambiguity.ts` (~60 LOC)
  - `write_draft.ts` (~80 LOC — thin wrapper around existing `runDraft`)
  - `index.ts` — registry export
- `lib/agent/email/l2.ts` — branch on feature flag (~30 LOC)
- `lib/agent/email/agentic-l2-prompt.ts` — system prompt + helper (~100 LOC)
- `lib/db/migrations/0035_agentic_l2.sql` + journal entry (~50 LOC)
- `lib/db/schema.ts` — `agent_confirmations` table + `structured_facts` column (~50 LOC)
- `app/app/settings/page.tsx` — Beta toggle (~50 LOC)
- `lib/i18n/translations/en.ts` + `ja.ts` — Beta section copy (~15 LOC)
- Tests (~500 LOC across the 7 new tools + agentic loop integration)

Total: ~1500 LOC. Largest spec to date. The 7 new tool files are independent and small; the loop driver is the only piece with non-trivial logic.

---

## Tests

Unit tests for each tool (mock LLM + DB):
- `extract-candidate-dates.test.ts` — multiple date formats (JP/EN, slash/dash, timezone tokens), empty body, malformed
- `infer-sender-timezone.test.ts` — locked persona returns high confidence; calendar offset inference computes correct delta; LLM fallback when no data
- `check-availability.test.ts` — slot in event range → unavailable; slot outside → available; multi-timezone display
- `lookup-contact-persona.test.ts` — existing row returns structured; missing row returns null
- `queue-user-confirmation.test.ts` — inserts row, returns id
- `detect-ambiguity.test.ts` — high-confidence decision → not ambiguous; conflicting signals → ambiguous + suggested question

Integration test: `agentic-l2-loop.test.ts` — mocked LLM returning predetermined tool-call sequences, asserts:
- Tool calls executed in order
- Loop terminates on no-tool-calls
- Cap exhaustion triggers forced final-pass
- Final output shape matches DeepPassResult + new fields

Aim: 1101 → ~1130+. `pnpm test` + `pnpm tsc --noEmit` clean.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- Settings → Beta features section showing the agentic-L2 toggle (EN + JA)
- After flipping the toggle for a test scenario: an interview-scheduling email (令和トラベル type) produces a draft that includes specific time choices grounded in the user's actual calendar availability — capture the DraftDetailsPanel + reasoning text
- A confirmation question appears in a new queue surface (Type F preview — final UI lands in engineer-42; for now even a Sentry log entry showing `queue_user_confirmation` was called counts as verify)

---

## Out of scope

- **Type F queue card UI** — engineer-42's territory. Engineer-41 writes the rows to `agent_confirmations` but doesn't render them. Engineer-42 picks up the rows + builds the Type F card.
- **Real-time unread filter for Type C** — engineer-43 (formerly 40D).
- **Gmail Push / Pub/Sub** — engineer-43.
- **Pre-brief reach expansion (MS Outlook + iCal)** — engineer-43.
- **Backfill agentic L2 for existing drafts** — not needed; new emails flow through the new path, old drafts stay on their original reasoning.

---

## Critical constraints

- **Migration is manual** post-merge per `feedback_prod_migration_manual.md`. Sparring will run; engineer must include "pnpm db:migrate against prod required" in PR description.
- **Journal entry is mandatory** per the engineer-39 incident — `lib/db/migrations/meta/_journal.json` MUST gain entry 35 alongside the 0035 SQL file. Verify by `pnpm db:migrate` on a fresh local DB before declaring done.
- **No Upstash schedule changes** in this engineer (engineer-42 / 43 may add).
- **Feature flag default false** — keeps all existing users on the single-shot L2 until Ryuto explicitly enables. Cost spike risk is bounded to opt-ins.
- **Cost ceiling**: agentic L2 averages ~$0.10/email vs $0.03 single-shot. At α 30% deep-pass rate × 100 users × 20/day = 600 deep passes × $0.10 = $60/day = $1800/mo if everyone is opted in. With dogfood = only Ryuto opted in = ~$3/day, trivial.
- **Don't commit changes to `.claude/launch.json`**.
- **Vitest can zombie** — `pkill -9 -f vitest` recovery.

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-41-agentic-l2`
- New tests + total count delta from 1101 baseline
- Production LOC vs test LOC split
- Migration applied confirmation (sparring runs)
- Smoke test on a real scheduling email (Ryuto's account opt-in) — capture the new behavior: candidate dates parsed, availability checked, draft includes specific time choices
- Cost observation: actual $/email for the agentic path on the smoke-test run
- **Memory entries to update**: `sparring_session_state.md` updated by sparring post-merge.
