# Engineer-52 — Agent behavior eval harness (scenario-based regression suite)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_agent_failure_modes.md` — failure-mode taxonomy; scenarios are organized around these named modes
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — Ryuto's profile drives the canonical fixture user
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — read before any schema add

Reference shipped patterns:

- `lib/agent/orchestrator.ts` — chat loop entry point. The eval harness drives this with synthetic chat inputs.
- `lib/agent/self-critique.ts` (PR #230) — placeholder-leak detector. Eval assertions reuse it.
- `lib/agent/prompts/main.ts` — system prompt incl. OUTPUT GROUNDING, EMAIL REPLY WORKFLOW examples, TIMEZONE RULES, FUZZY MATCH ON ZERO HITS
- `tests/regenerate-drafts.test.ts` + `tests/sender-confidence.test.ts` — examples of unit tests that mock at the db layer. Eval harness mocks at a higher layer (the orchestrator's tool registry) so the LLM call is real but the data is fixture.
- `lib/agent/tool-registry.ts` — what tools the orchestrator can call; eval scenarios assert which ones get invoked
- `lib/agent/email/audit.ts` `email_audit_log` — eval runs leave breadcrumbs here for post-hoc inspection

---

## Strategic context

The 2026-05-12 sparring session shipped 30+ PRs hardening prompts against named failure modes (PLACEHOLDER_LEAK, WRONG_TZ_DIRECTION, METADATA_CONFUSED_FOR_CONTENT, SILENT_AUTOCORRECT, etc.). Each fix is documented in `feedback_agent_failure_modes.md`. The pattern that emerged:

1. Ryuto dogfoods a real workflow
2. Agent fails in some specific way
3. Sparring diagnoses → names the failure mode → strengthens prompt / adds tool / fixes heuristic
4. Ships fix
5. Ryuto re-tries → confirms

Step 5 is the only quality gate. There's no automated way to catch a regression of, say, `PLACEHOLDER_LEAK` if a future prompt change re-introduces it. The 1425-strong unit-test suite tests `selectModel()`, tool argument parsing, etc. — not "given this prompt, does the agent actually behave this way."

Engineer-52 builds the missing layer: **scenario-based agent eval harness**. Each scenario is a script that:
- Sets up a fixture user with known data (emails, calendar, assignments, facts)
- Sends a synthetic user message to the chat orchestrator
- Asserts what the agent does (which tools called, in what order) AND what the agent says (placeholder-leak free, contains expected entities/dates/etc.)

This is the **CI gate** for prompt changes. If a future PR weakens the OUTPUT GROUNDING rule, the eval suite catches it before merge.

Distinct from unit tests:
- Unit tests verify pure functions (`detectPlaceholderLeak("〇〇")` → has leak). Already shipped via PR #230.
- Agent evals verify end-to-end behavior (given email-reply intent, does the orchestrator's full loop produce a grounded draft). This is the new layer.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-52
```

---

## Scope — build in order

### Part 1 — Harness infrastructure

New directory: `tests/agent-evals/`.

New file: `tests/agent-evals/harness.ts`. Exports:

```ts
type EvalScenario = {
  name: string;                     // human-readable, matches a failure mode if applicable
  failureMode?: string;             // optional taxonomy reference (PLACEHOLDER_LEAK, etc.)
  fixture: {
    user: { id: string; timezone: string; locale: "ja" | "en"; name: string };
    facts?: Array<{ fact: string; category?: string }>;
    inboxItems?: Array<FixtureInboxItem>;
    calendarEvents?: Array<FixtureEvent>;
    assignments?: Array<FixtureAssignment>;
    entities?: Array<FixtureEntity>;
  };
  input: {
    chatHistory?: Array<{ role: "user" | "assistant"; content: string }>;
    userMessage: string;
  };
  expect: EvalAssertion[];
};

type EvalAssertion =
  | { kind: "tool_called"; name: string; minTimes?: number; maxTimes?: number; argsMatch?: (args: unknown) => boolean }
  | { kind: "tool_not_called"; name: string }
  | { kind: "tool_call_order"; sequence: string[] }  // must appear in this order, gaps allowed
  | { kind: "response_contains"; text: string; caseSensitive?: boolean }
  | { kind: "response_does_not_contain"; text: string }
  | { kind: "response_no_placeholder_leak" }  // uses detectPlaceholderLeak from PR #230
  | { kind: "response_matches"; regex: RegExp }
  | { kind: "custom"; check: (result: EvalRunResult) => { pass: boolean; message?: string } };

type EvalRunResult = {
  finalText: string;
  toolCalls: Array<{ name: string; args: unknown; resultPreview: string }>;
  iterations: number;
  durationMs: number;
};

async function runScenario(scenario: EvalScenario): Promise<EvalRunResult>;
function evaluateAssertions(result: EvalRunResult, assertions: EvalAssertion[]): EvalReport;
```

Harness implementation:

- Bootstrap an isolated test DB (in-memory if possible, or a per-run scratch schema in Neon). Insert fixtures.
- Stub the OpenAI client to use a real model? OR mock with deterministic responses? **Recommendation**: real OpenAI client (mini-tier model = $0.001 per scenario, ~$0.30 to run 300 scenarios). Determinism comes from low temperature + the scripted fixture; not bit-perfect repeatable but stable enough at the assertion granularity.
- Call `streamChatTurn` (or whatever the orchestrator's main entry point is) — collect the tool calls, the text deltas, the final text.
- Tear down fixtures after the run.

Tests for the harness itself in `tests/agent-evals/harness.test.ts` — assert that a trivially-passing scenario returns the right shape.

### Part 2 — Scenario library

New directory: `tests/agent-evals/scenarios/`. One file per failure mode + a few "happy path" scenarios.

Scenarios to ship in engineer-52 (one file per mode):

1. **`placeholder-leak-email-reply.ts`** — the アクメトラベル case from 2026-05-12.
   - Fixture: 1 inbox_item from a .jp recruiter (or .com with JP body) with 3 candidate slots, user in PT
   - Input: 「アクメとラベルとの面接日程に返信したい」
   - Assertions:
     - `tool_called: email_get_body` (mandatory)
     - `tool_called: infer_sender_timezone` (mandatory)
     - `tool_called: convert_timezone` at least 3x (each slot)
     - `response_no_placeholder_leak`
     - `response_contains: "アクメトラベル"` (transparent correction)
     - `response_contains: "JST"` + `response_contains: "PT"` (dual-TZ)
     - `response_does_not_contain: "〇〇"`
     - `response_does_not_contain: "ご提示いただいた日程"`

2. **`wrong-tz-direction.ts`** — sender's TZ correctly inferred + applied
   - Fixture: 1 inbox_item from a Japanese-body email, user TZ = America/Vancouver
   - Input: 「メール本文の時間、何時？」
   - Assertions:
     - `tool_called: infer_sender_timezone` returns Asia/Tokyo
     - convert_timezone called with `fromTz: "Asia/Tokyo"` (NOT America/Vancouver)
     - `response_contains: "JST"` AND `response_contains: "PT"` in the output
     - `response_does_not_contain: "PDT → JST"` (the wrong-direction signature)

3. **`silent-autocorrect-disclosure.ts`** — typo gets transparently fixed
   - Fixture: 1 entity named アクメトラベル
   - Input: 「アクメとラベル からのメールを探して」
   - Assertions:
     - tool_called: lookup_entity (first try with typo) → 0
     - tool_called: lookup_entity (retry with アクメ or similar shorter) OR email_search with shorter substring
     - `response_contains: "アクメトラベル"` AND `response_contains: "アクメとラベル"` (discloses the correction)
     - `response_contains: "のことですね"` OR similar disclosure pattern

4. **`metadata-confused-for-content.ts`** — agent doesn't stop at lookup_entity summary
   - Fixture: entity アクメトラベル with 1 linked email
   - Input: 「アクメトラベルからの最新メールの本文教えて」
   - Assertions:
     - `tool_call_order: ["lookup_entity", "email_get_body"]`
     - Response contains specific body content (e.g. a slot or a sentence from the body), not just subject

5. **`action-commitment-followthrough.ts`** — narrated action gets executed
   - Fixture: 1 inbox_item, user message "draft a reply"
   - Assertions:
     - Response that ends with "返信文を作ります" / similar narrative → MUST be followed by `tool_called: email_get_body` AND substantive draft content
     - NOT: narrative-only response with no tool follow-through

6. **`range-as-slot-pool.ts`** — scheduling-domain rule
   - Fixture: email with "10:00–11:00 の間" + "30分想定"
   - Input: 「10:30 で予約できる？」
   - Assertions:
     - `response_contains: "範囲内"` OR similar acknowledgement
     - `response_does_not_contain: "候補外"` (the rigid-endpoint failure mode)

7. **`happy-path-week-summary.ts`** — control case
   - Fixture: 3 calendar events this week, 2 assignments due this week
   - Input: 「今週どんな感じ？」
   - Assertions:
     - tool_called: calendar_list_events + assignments_list (or similar)
     - response_contains: each event title
     - response_no_placeholder_leak

8. **`happy-path-absence-mail.ts`** — control case
   - Fixture: tomorrow's class events with named professors
   - Input: 「明日のクラス全部休むメール送って」
   - Assertions:
     - tool_called: calendar_list_events (or classes_list)
     - response_contains: at least 1 professor name from the fixture
     - response_no_placeholder_leak

Each scenario file exports a default `EvalScenario` object. Loader iterates `import.meta.glob` over the directory.

### Part 3 — CI integration

`package.json` — new script:

```json
"eval:agent": "NODE_OPTIONS='--max-old-space-size=8192' tsx tests/agent-evals/run.ts"
```

`tests/agent-evals/run.ts` — orchestrator. Reads all scenarios, runs sequentially (or with low concurrency = 3 to avoid OpenAI rate limit), produces a report:

```
Scenario: placeholder-leak-email-reply (PLACEHOLDER_LEAK)
  ✅ tool_called: email_get_body (1x)
  ✅ tool_called: infer_sender_timezone (1x)
  ✅ tool_called: convert_timezone (3x)
  ✅ response_no_placeholder_leak
  ❌ response_contains: "アクメトラベル"
     Final text was: "Subject: Re: 次回面接のご連絡 ..."
     The transparent-correction disclosure didn't fire.
  Duration: 4.2s, 5 tool calls
```

Exit code 0 if all scenarios pass; 1 if any fail.

`.github/workflows/agent-evals.yml` — new workflow. Runs on PRs that touch `lib/agent/prompts/**`, `lib/agent/tools/**`, `lib/agent/orchestrator.ts`, or `lib/agent/self-critique.ts`. Requires `OPENAI_API_KEY` in repo secrets (already there for Vercel; mirror to GitHub Actions secrets).

Skips on PRs that don't touch agent files (cost optimization — most PRs don't need to re-run the agent eval).

### Part 4 — Eval result history

`lib/db/migrations/0043_agent_eval_runs.sql` + journal entry:

```sql
CREATE TABLE agent_eval_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commit_sha text NOT NULL,
  branch text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  total_scenarios integer NOT NULL,
  passed integer NOT NULL,
  failed integer NOT NULL,
  duration_ms integer NOT NULL,
  total_cost_usd real,
  raw_report jsonb NOT NULL  -- per-scenario breakdown
);
CREATE INDEX agent_eval_runs_commit_idx ON agent_eval_runs(commit_sha);
```

The CI workflow writes a row per run for post-hoc trend analysis. Optional but small.

---

## Out of scope

- **LLM-as-judge eval** — using a stronger model to grade the response qualitatively. Cost ↑, value uncertain at α; revisit if regex-based assertions miss too many regressions.
- **Production traffic replay** — replaying real user conversations through the eval. Privacy + cost concern; α scale doesn't justify.
- **A/B eval** — running two versions of the prompt side-by-side. Useful for prompt experiments but separate engineer.
- **Continuous eval (cron-driven)** — running scenarios daily against prod-deployed orchestrator. Useful for model-drift detection (when OpenAI silently changes the underlying model behavior). Future engineer.

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing 1425+ unit tests still pass
3. `pnpm eval:agent` — all scenarios pass
4. Test by introducing a regression: revert one of the prompt strengthening commits locally, run `pnpm eval:agent`, confirm the relevant scenario fails. Restore commit.
5. CI workflow runs on PR; passing run cached + viewable in Actions

---

## Commit + PR

Branch: `engineer-52`. Push, sparring agent creates the PR.

Suggested PR title: `feat(eval): agent behavior eval harness — scenario-based regression suite for named failure modes (engineer-52)`

---

## Deliverable checklist

- [ ] `tests/agent-evals/harness.ts` — runScenario + evaluateAssertions + types
- [ ] `tests/agent-evals/harness.test.ts` — harness self-tests
- [ ] `tests/agent-evals/scenarios/` × 8 scenario files (one per named mode + 2 happy paths)
- [ ] `tests/agent-evals/run.ts` — CLI runner
- [ ] `package.json` — `eval:agent` script
- [ ] `.github/workflows/agent-evals.yml` — CI workflow (gated on agent-file path filter)
- [ ] `lib/db/migrations/0043_agent_eval_runs.sql` + journal entry (optional table for history)
- [ ] `lib/db/schema.ts` — `agentEvalRuns` table (if Part 4 included)
- [ ] Tests per Verification section
- [ ] Live: regression-injection test confirms eval catches it
