# Engineer-62 — Structural fix for THREAD_ROLE_CONFUSED (new email_get_new_content_only tool + cascade-failure self-critique)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_agent_failure_modes.md` — full taxonomy; specifically the `THREAD_ROLE_CONFUSED` entry
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_sparring_engineer_branch_overlap.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_vercel_external_peers.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_dogfood_batched_end.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_role_split.md`

Reference shipped patterns:

- `lib/agent/tools/email.ts` — existing `email_get_body` tool. New tool sits next to it with the same `mutability: "read"` shape and identical access-control story.
- `lib/agent/prompts/main.ts` — EMAIL REPLY WORKFLOW MUST-rules (engineer-53 + sparring inline strengthening 2026-05-14). This wave revises rule 2 and the THREAD ROLE PARSING block under rule 9.
- `lib/agent/self-critique.ts` — `FORBIDDEN_TOKENS` + `buildPlaceholderLeakCorrection`. Engineer-62 adds 2 new detectors that read the orchestrator's tool-call history, not just the final text.
- `lib/agent/orchestrator.ts` — the self-critique retry pass. Detector signature widens to `(text, toolCallHistory) → leak` so the new detectors can inspect what was called.
- `tests/agent-evals/scenarios/quoted-block-extraction.ts` (sparring inline 2026-05-14, PR #257) — currently FAILS in eval. This wave is done when it passes.

---

## Strategic context — why prompt-only failed

The 2026-05-14 dogfood on the 令和トラベル round-2 reply produced this draft despite engineer-53's MUST-rule 9 + the sparring inline strengthening (PR #257):

```
第一希望：5月15日（金）10:00〜11:00
第二希望：5月22日（金）13:30〜14:00
第三希望：5月19日（火）16:30〜18:00
```

These are the **round-1** candidates from the **deepest `>>` quoted block** of the body. The recruiter's NEW message (top of body) proposed `5/20 18:00–18:45` and `5/21 15:00–15:45` — the agent ignored those.

Worse: once the agent decided "the candidate list is what's in quoted history," it cascaded through the other MUST-rules:
- **`WORKING_HOURS_IGNORED`** — no `convert_timezone` calls at all (engineer-54 MUST-rule 1 says EACH slot)
- **`SENDER_NORMS_IGNORED`** — no `infer_sender_norms` call (engineer-56 rule 3b)
- **`RANGE_END_NOT_CONVERTED`** — moot since zero conversions happened
- Tool call sequence visible in the chat: just `email_get_body` twice. None of the feasibility / TZ / sender-norms tools.

The cascade is the key insight: **once thread-role parsing fails, the agent treats the misread slots as "already-accepted previous candidates" and skips all the rules that gate slot acceptance**. Prompt instruction is too soft to break this cascade — the agent's reasoning has already convinced itself the slots are fine.

This wave's thesis: **enforce thread-role disambiguation at the TOOL level so the agent literally cannot see quoted content when extracting slots**, AND add self-critique detectors that catch the cascade failures (slot list emitted without TZ conversion calls).

---

## Scope — build in order

### Part 1 — `email_get_new_content_only` tool

New file `lib/agent/tools/email-get-new-content-only.ts`. Schema:

```typescript
{
  name: "email_get_new_content_only",
  description: "Get the sender's NEW message body with quoted history stripped — lines starting with `>` (any depth) and the email-client reply headers ('On YYYY-MM-DD ... wrote:', '-----Original Message-----', Outlook's '差出人: ... 送信日時: ...') are removed. Returns only the content the sender is communicating in THIS message. Use when you need to extract slots / candidate dates / deadlines / action items from a reply email where the new content sits above quoted history. Pair with email_get_body when you also need the prior-thread context (e.g. to write a contextual response that references earlier discussion).",
  mutability: "read",
  parameters: { inboxItemId: string },
}
```

Implementation:

1. Re-use the same DB fetch as `email_get_body` (look up `inbox_items.id` → load gmail body via the existing path).
2. Apply a quoted-block stripper:
   - Drop any line where `^\s*>+\s*` matches (any depth of `>`).
   - Drop "On … wrote:" / "On YYYY/MM/DD … <email> wrote:" headers (regex: `^On\s+.+?\s+wrote:\s*$`).
   - Drop "-----Original Message-----" / "----- Original Message -----" markers and everything after them.
   - Drop Outlook headers: `^差出人:.*$`, `^From:.*$` when surrounded by other typical reply headers, `^送信日時:.*$`, `^Sent:.*$`, `^宛先:.*$`, `^To:.*$`, `^件名:.*$`, `^Subject:.*$` — only when they appear in a contiguous block within the body (not at the top headers).
   - Strip trailing whitespace / collapse 3+ consecutive blank lines to 1.
3. Return `{ inboxItemId, originalBodyLength, newContentBodyLength, newContentBody }`.
4. If the stripping removes >95% of the body, treat as suspicious and ALSO return the original body with a flag `{ stripperFlagged: true, reason: "stripped >95% — possible structure unrecognized" }`. The agent can decide whether to fall back to `email_get_body`.

Tests: `tests/email-get-new-content-only.test.ts` with fixtures covering:
- Plain `>` quoted (the 2026-05-14 round-2 shape — verbatim fixture from `tests/agent-evals/scenarios/quoted-block-extraction.ts`)
- Multi-depth `>>>` (3-tier thread)
- Outlook-style "From: / Sent: / To: / Subject:" headers
- "-----Original Message-----" marker
- 日本語 reply with "差出人:" header
- Edge case: body with NO quoted content (return unchanged)
- Edge case: body that's almost entirely quoted (the stripper flag triggers)

### Part 2 — EMAIL REPLY WORKFLOW prompt revision

`lib/agent/prompts/main.ts` MUST-rule 2 currently says:

> **MUST call `email_get_body` BEFORE drafting any reply text.**

Revise to:

> **MUST call BOTH `email_get_body` AND `email_get_new_content_only` BEFORE drafting any reply text.**
>
> - `email_get_body` gives you the full thread context (you need this to understand the conversation history).
> - `email_get_new_content_only` gives you the sender's CURRENT message with quoted history stripped — **you MUST extract slots / candidate dates / deadlines / action items from this result, NEVER from `email_get_body`'s output**.
>
> The two-call pattern is the structural fix for `THREAD_ROLE_CONFUSED`: even if you're tempted to read the quoted block, the slot-extraction surface is `email_get_new_content_only` and quoted content is physically absent from it.

Also revise the THREAD ROLE PARSING block (under rule 9): keep it as a reasoning aid for OTHER intent classes (e.g. status questions about a thread), but for slot-extraction route through `email_get_new_content_only`.

### Part 3 — Cascade-failure self-critique detectors

The 2026-05-14 dogfood revealed that the orchestrator's existing self-critique runs on final-text only. The cascade failures (no `convert_timezone`, no `infer_sender_norms`) can't be detected from text alone — they require tool-call history.

Widen the detector signature in `lib/agent/self-critique.ts`:

```typescript
export type PlaceholderLeakDetection = {
  hasLeak: boolean;
  matched: string[];
};

export function detectPlaceholderLeak(
  text: string,
  toolCallHistory?: ReadonlyArray<{ toolName: string; status: string }>,  // NEW
): PlaceholderLeakDetection { ... }
```

Add 2 new detectors that fire when `toolCallHistory` is provided:

1. **`slot list without convert_timezone`** — if `text` contains ≥3 slot tokens (matching `/\d{1,2}[:時]\d{0,2}.*JST|PT|PDT|PST/` etc.) AND `toolCallHistory` has zero `convert_timezone` entries → flag. Corrective message: "You emitted a slot list without calling `convert_timezone`. Every displayed slot needs a dual-TZ form (sender + user) backed by a tool call (TIMEZONE RULES). Re-fetch and re-draft."

2. **`reply intent without email_get_new_content_only`** — if the user's message indicates reply intent (regex on common JA/EN reply triggers) AND the response contains slot dates AND `toolCallHistory` has `email_get_body` but NOT `email_get_new_content_only` → flag as `THREAD_ROLE_CONFUSED`-class risk. Corrective message: "You drafted a slot-list reply without calling `email_get_new_content_only` — slot extraction from `email_get_body`'s output risks THREAD_ROLE_CONFUSED. Re-call `email_get_new_content_only` and re-extract from the NEW content only."

Update orchestrator.ts to pass `toolCallHistory` to the detector. The retry pass (already allows tool calls per PR #235) can then call `email_get_new_content_only` on the corrective.

Unit tests in `tests/self-critique.test.ts` — extend the existing test file with cases that pass / fail each new detector.

### Part 4 — Update existing eval scenarios

Several existing scenarios assume `email_get_body` is the only body fetcher. Audit and update:

- `placeholder-leak-email-reply.ts`
- `email-reply-terse-typo.ts`
- `late-night-slot-pushback.ts`
- `quoted-block-extraction.ts` (PR #257, currently failing — this wave fixes it)
- `feasible-and-infeasible-mix.ts`
- `sender-norms-respected.ts`
- `empty-intersection-window.ts`

For each, the `expect` array should ALSO assert `{ kind: "tool_called", name: "email_get_new_content_only" }` for reply-intent scenarios. The existing assertions on `email_get_body` stay (both are required).

The harness's fixture-backed tool dispatcher needs a new `email_get_new_content_only` implementation that returns a fixture-stripped body. Add this to `tests/agent-evals/harness.ts` alongside the existing `email_get_body` mock — same fixture data, just run the stripper logic on it.

### Part 5 — Failure-mode taxonomy update

`feedback_agent_failure_modes.md` — update `THREAD_ROLE_CONFUSED` entry to note the engineer-62 structural fix landed. Add a new entry for the cascade pattern:

```markdown
### `THREAD_ROLE_CASCADE`

**Shape:** Once a thread-role-confused slot list lands in the agent's reasoning ("these are the candidate slots"), the agent skips ALL subsequent gating rules — no convert_timezone calls, no infer_sender_norms, no working-hours check — because it has internally classified the slots as "already-accepted previous candidates." The single mis-extraction cascades into 3-5 MUST-rule violations.

**Root cause:** Prompt-level enforcement is sequential reasoning; once the agent makes a wrong call early, subsequent rules' triggers don't fire because the agent's internal state has the wrong premise.

**Fix:** Engineer-62 — tool-level enforcement (`email_get_new_content_only` makes quoted slots physically invisible at extraction time) + self-critique detectors that check tool-call HISTORY (not just final text) to catch the cascade pattern (slot list emitted without convert_timezone is the canonical signal).
```

Also extend the `WORKING_HOURS_IGNORED` and `SENDER_NORMS_IGNORED` entries with cross-links to the new cascade detector.

### Part 6 — DB / migration

None. Both `email_get_body` and the new tool read the same `inbox_items` row.

### Part 7 — i18n

The new tool name surfaces in the chat chip via `lib/utils/tool-friendly-labels.ts`. Add JA + EN entries:

- `email_get_new_content_only`:
  - JA: `running: "新規本文を取得しています"`, `done: "新規本文を取得"`
  - EN: `running: "Reading new content only"`, `done: "Read new content only"`

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-62
```

IMPORTANT before checkout: `git status`. See `feedback_sparring_engineer_branch_overlap.md`.

## Verification

- `pnpm typecheck` clean
- `pnpm test` full suite green, +~10 new unit tests (stripper edge cases + cascade detector cases)
- `pnpm eval:agent` — every scenario passes; specifically `quoted-block-extraction` (currently failing) MUST go green. Cost ~\$0.02/run.
- Manual dogfood: re-trigger the 令和トラベル round-2 reply scenario. Expected: draft cites 5/20 + 5/21 NEW slots (NOT 5/15/5/19/5/22 quoted ones); convert_timezone called ≥4 times (2 slots × 2 endpoints); infer_sender_norms called once; SLOT FEASIBILITY CHECK / SENDER NORMS reasoning surfaced in the meta-prose; counter-proposal generated because the JST 5/20 18:00 / 5/21 15:00 are Vancouver night.

## Out of scope

- Voice agent path (uses different orchestrator; same failure mode possible but separate wave)
- Mobile UI changes
- Notion / Calendar tool surfaces — they don't have the quoted-block problem
- Reply-thread parsing across MORE than 3 levels of nesting — edge case; the stripper handles arbitrary depth via regex
- HTML email body parsing — Steadii uses Gmail's plain-text body; if HTML reply structure becomes a problem, separate wave

## Memory entries to update on completion

- `feedback_agent_failure_modes.md` — `THREAD_ROLE_CONFUSED` resolved + new `THREAD_ROLE_CASCADE` entry
- Cross-link the new `tests/agent-evals/scenarios/quoted-block-extraction.ts` from any related entries
