# Engineer-45 — Agent quality: TZ tool + system prompt + email TZ heuristic + immediate re-draft + dual-TZ slot proposals

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_ms_education_admin_consent.md` — why Teams API is dead-piled
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — risk-tiered confirmation model
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — Ryuto's location (Vancouver, PDT/PST) — drives the test case below
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md` — Type E card surface; relevant for Part 5

Reference shipped patterns:

- `lib/agent/orchestrator.ts` — chat tool-using loop. Where the chat agent's system prompt + tool dispatch lives.
- `lib/agent/tools/index.ts` (or `lib/agent/tool-registry.ts`) — chat tools register here.
- `lib/agent/tools/classes.ts` / `tools/calendar.ts` — example tool shape. Mirror this for the new `convert_timezone` tool.
- `lib/agent/email/agentic-l2.ts` + `lib/agent/email/agentic-l2-prompt.ts` — agentic L2 entry + prompt (already edited in PR #207 to forbid tool-name leaks).
- `lib/agent/email/l2-tools/check-availability.ts` and sibling tool files — agentic L2 tools.
- `lib/agent/email/draft.ts` — draft generator + its prompt; emits the body that hits the recipient. Dual-TZ rendering goes here.
- `lib/agent/preferences.ts` — `getUserLocale(userId)` + `getUserTimezone(userId)` (verify the latter exists; if not, add it; pulls from `users.preferences.timezone`).
- `app/app/queue-actions.ts:277` — `queueSubmitClarificationAction`. Comment at line 270 explicitly defers immediate L2 re-run to "Wave 3" — Wave 3 shipped but this part was never built. This handoff finally builds it.
- `lib/agent/email/l2.ts` — `processL2` entrypoint; add an options arg to accept `userClarification` text.

---

## Strategic context

Ryuto shipped a chat transcript on 2026-05-12 with the 令和トラベル interview email. The chat agent failed in 8 distinct ways across one conversation:

1. First TZ question → agent said "no TZ difference issue" (the email is from a .jp recruiter, slots are JST)
2. "バンクーバーで表示して" → agent showed the same JST values as if they were PT (no conversion)
3. Self-correction only after user pushed back twice
4. "8:30 から" → agent silently assumed AM, did the math anyway
5. Self-contradiction: said "in candidate" then "not in candidate" in consecutive turns
6. Wasted tool call: re-called `email_get_body` after already having the body
7. Didn't grasp "30分想定" + "10:00〜11:00 の間" means "pick any 30-min slot in the range" — insisted on rigid endpoint match
8. Multiple cross-day errors (Wed/Thu/Fri confused across turns)

Root-cause analysis (per sparring discussion):

| Cause | Maps to failures |
|---|---|
| Agent has to math TZ conversions (no deterministic tool) | 1, 2, 3, 8 |
| User's TZ isn't injected into the chat system prompt | 1, 4 |
| Email's TZ isn't heuristically inferred from sender domain | 1, 2 |
| Past-turn context isn't being used (re-fetches, contradictions) | 5, 6, 8 |
| No prompt rules for ambiguous time (AM/PM, TZ unspecified) | 4 |
| No domain knowledge that "range + duration" = "pick within" | 7 |

Plus an **orthogonal but related issue**: `queueSubmitClarificationAction` logs the user's freeText answer to the audit log and dismisses the underlying draft, but **does not** trigger an immediate L2 re-run with that answer as additional context. The user has to wait for the next email from the same sender for their input to take effect. That's a separate UX bug from the TZ failures but they share the "agent feels unresponsive" theme, so they ship in the same wave.

This engineer ships the full agent-quality bump.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-45
```

Build in the order below — each part is testable / shippable in isolation so a context-bust mid-implementation still lands incremental value.

---

## Scope — build in order

### Part 1 — `convert_timezone` tool (foundation)

New file: `lib/agent/tools/convert-timezone.ts`.

Deterministic, no LLM math. Use `Intl.DateTimeFormat` with `timeZone` option (Node 16+ standard).

**Tool definition**:

```ts
name: "convert_timezone"
description: "Convert a wall-clock time from one IANA timezone to another. Deterministic — use this whenever you need to translate a time across timezones. Don't math it yourself. Returns the converted ISO timestamp plus a human-readable display string. Handles DST automatically."
```

**Input schema (zod)**:
- `time: string` — ISO 8601 with explicit offset OR a wall-clock date+time + `fromTz` to anchor it (e.g. "2026-05-15T10:00:00" + fromTz "Asia/Tokyo")
- `fromTz: string` — IANA name (e.g. "Asia/Tokyo")
- `toTz: string` — IANA name (e.g. "America/Vancouver")

**Returns**:
```ts
{
  toIso: string;             // ISO with toTz offset
  toDisplay: string;         // "5月14日(水) 18:00 PT"
  fromDisplay: string;       // "5月15日(木) 10:00 JST"
  weekdayChanged: boolean;   // true when the date crosses midnight
}
```

Implementation: parse `time` + `fromTz` as a Date, format using `Intl.DateTimeFormat(locale, { timeZone: toTz, ... })`. Use locale from caller's context (en or ja).

Register in `lib/agent/tools/index.ts` and `lib/agent/tool-registry.ts`.

**Tests** (`tests/agent-tools-convert-timezone.test.ts`):
- JST 10:00 → America/Vancouver: returns the day-before 18:00 (or day-of based on DST window)
- America/Vancouver 20:30 → Asia/Tokyo: returns the next-day 12:30 (PDT period)
- Same TZ in/out: returns same values, `weekdayChanged: false`
- Invalid IANA name: returns error / throws
- DST boundary: spring-forward + fall-back transitions
- Wraparound edge: midnight in one TZ landing on a different date

### Part 2 — Chat orchestrator system prompt enhancements

Edit `lib/agent/orchestrator.ts` (or wherever the chat system prompt lives — locate it; recent edits are in `lib/agent/chat-prompt.ts` or similar).

Inject before every chat session:

```
USER CONTEXT (always honor):
- Timezone: {tzId} ({tzAbbreviation}, UTC{offset}). Current local time: {iso}.
- Locale: {ja|en}.

TIMEZONE RULES (strict):
- When discussing times that appear in an email or message, infer the email's TZ from sender domain (.jp / .co.jp → Asia/Tokyo; .ac.uk → Europe/London; etc.) AND from any explicit TZ markers in the body. State your inferred TZ explicitly on first mention.
- When the email's TZ differs from the user's TZ, ALWAYS display both: "5月15日(木) 10:00 JST / 5月14日(水) 18:00 PT". Never show only one side.
- Use the convert_timezone tool — do not math TZ offsets yourself. LLM TZ arithmetic is unreliable.
- When the user mentions a time without AM/PM AND the context is ambiguous, ask which one. Don't silently assume.
- When the user mentions a time without specifying TZ AND it could be either the user's TZ or the email's TZ, ask. Default-assuming the user's local TZ is acceptable only when there's no plausible alternative.

SCHEDULING DOMAIN RULES:
- When an email proposes a time RANGE (e.g. "10:00〜11:00 の間") AND specifies a meeting DURATION (e.g. "30分想定"), the range is a slot-pool: any sub-range of the specified duration within the range is a valid choice. Treat range endpoints as boundaries, not as the only valid times.

CONTEXT REUSE:
- If a tool call result is already in this conversation's earlier turns, use that result. Don't re-call the same tool with the same arguments.
- If you computed a value (e.g. a TZ conversion) earlier in this conversation, don't recompute it. Reuse the earlier statement.
```

Inject `tzId`, `tzAbbreviation`, `offset`, `iso`, `locale` at chat-session-start using `getUserTimezone(userId)` + `getUserLocale(userId)`. Cache for the session.

Add a small unit test verifying the injection happens (mocked user with `preferences.timezone = "America/Vancouver"`).

### Part 3 — Agentic L2 prompt — mirror the same TZ rules

Edit `lib/agent/email/agentic-l2-prompt.ts`.

Add the same `TIMEZONE RULES` + `SCHEDULING DOMAIN RULES` + `CONTEXT REUSE` blocks. The agentic L2 already has `infer_sender_timezone` and `check_availability` tools — those produce TZ data but the prompt doesn't enforce dual-TZ rendering in the final draft body. Add explicit rules:

```
DRAFT BODY TZ DISPLAY:
- Whenever your write_draft call includes specific times AND the sender's TZ differs from the student's TZ, the draft body must render each slot in BOTH timezones in the format "5月15日(木) 10:00 JST / 5月14日(水) 18:00 PT". This is non-negotiable — students get confused otherwise.
```

Add a regression test fixture: `tests/agentic-l2-tz-rendering.test.ts` (stub the LLM, just confirm the prompt contains the rules).

### Part 4 — Email TZ heuristic

New file: `lib/agent/email/sender-timezone-heuristic.ts`.

Pure function:
```ts
inferSenderTzFromDomain(domain: string): { tz: string | null; confidence: number };
```

Mappings (extend as needed):
- `*.jp`, `*.co.jp`, `*.ac.jp`, `*.or.jp` → Asia/Tokyo, confidence 0.95
- `*.uk`, `*.ac.uk`, `*.co.uk` → Europe/London, confidence 0.9
- `*.ca`, `*.gc.ca` → null (Canada spans 6 TZs — don't guess)
- `*.au`, `*.com.au` → null (Australia spans 4 TZs — don't guess)
- `*.de`, `*.fr`, `*.it`, `*.es` → Europe/{Berlin,Paris,Rome,Madrid}, confidence 0.85
- `*.cn` → Asia/Shanghai, confidence 0.9
- `*.kr` → Asia/Seoul, confidence 0.95
- Default: null

Wire into `lib/agent/email/agentic-l2.ts` — call once at loop start; pass result as an additional context line in the user message ("Likely sender TZ: Asia/Tokyo (high confidence per .co.jp domain)").

Tests: `tests/sender-timezone-heuristic.test.ts` — cover each mapping branch + the "don't guess" countries.

### Part 5 — Immediate re-draft on freeText submit

Edit `app/app/queue-actions.ts` `queueSubmitClarificationAction` and the `processL2` entrypoint in `lib/agent/email/l2.ts`.

**Current** (per comment at line 270): logs audit, dismisses draft, awaits the next email from the same sender for the user's input to land.

**New**:
- After logging audit + before dismissing the draft, re-run `processL2(inboxItemId, { userClarification: args.freeText })`.
- The new option threads `userClarification` text into the agentic L2 user message as an additional context block: `=== Student's clarification ===\n{text}\n`.
- The agentic L2 loop sees the student's clarification + re-decides the action. Typically: gathers any extra info, drafts a reply.
- After `processL2` resolves, dismiss the ORIGINAL draft (existing behavior). The new draft from the re-run shows up in the queue as a fresh row.
- Don't re-run if `freeText.trim().length === 0` (radio-only clarification still goes through audit + dismiss).

Schema option: add `userClarification?: string` to `ProcessL2Options` in `lib/agent/email/l2.ts`. Thread through to `buildAgenticL2UserMessage` in `agentic-l2-prompt.ts`.

Tests: extend `tests/regenerate-drafts.test.ts`'s pattern or write new — when freeText is non-empty, processL2 is called with the right options; when empty, only audit + dismiss runs.

### Part 6 — Draft prompt dual-TZ rendering (engineer-43 left this thin)

Audit `lib/agent/email/draft.ts` and its prompt. Confirm that when:
- The student's TZ != the sender's TZ (use `getUserTimezone` + the new sender-TZ heuristic)
- AND the draft body includes specific time slots

…the body renders each slot in **both** timezones. If today's prompt doesn't enforce this, add the same `DRAFT BODY TZ DISPLAY` rule as Part 3 — but in the draft prompt, not the agentic L2 prompt (so non-agentic users also benefit).

Test fixture: a 令和トラベル-style email at risk_tier=high with student in America/Vancouver. The generated draft body must include both JST and PT for each slot it proposes.

---

## Out of scope (engineer-46 territory)

- **Chat-driven Type E resolution** ("Steadii と話す" button → seeded chat session that resolves the ask_clarifying card with multi-turn conversation). Engineer-46 will pick this up using engineer-45's `convert_timezone` tool + system prompt enhancements as foundation.
- **User-fact memory** (a clean replacement for the dead "+ Steadii のメモに追加" pill that was removed in PR #210) — engineer-47 candidate.
- **Adaptive TZ heuristic** (learn from user corrections) — fixed mapping for α, learning later.
- **Push channels** — Type C queue surface stays sufficient.
- **Teams Assignments API integration** — admin-consent dead-pile.

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new unit tests for each part
3. **Live dogfood**: log in as Ryuto. Open a new chat. Reproduce a fragment of the 2026-05-12 transcript:
   - Send "令和トラベルの面接の時刻を確認して"
   - Verify agent immediately surfaces both JST and PT for each candidate slot, with conversion-tool-backed values (not LLM math)
   - Send "8:30 PM PT で良いですか？候補内ですか？" — verify agent calls convert_timezone, gets 12:30 JST, matches against the range 11:30-13:00 JST, says "candidate 2 の範囲内です"
4. **Immediate re-draft test**: find a Type E (ask_clarifying) card in the queue, type a clarification, click "Steadii に送る". Verify a NEW draft appears in the queue within a few seconds (not after waiting for the next email).
5. Screenshot: dual-TZ slots in a generated draft body for the 令和トラベル workflow.

---

## Commit + PR

Branch: `engineer-45`. Push, sparring agent (separate session) creates the PR.

Suggested PR title: `feat(l2,chat): agent quality wave — TZ tool + system prompt + email TZ heuristic + immediate re-draft + dual-TZ drafts (engineer-45)`

---

## Deliverable checklist

- [ ] `lib/agent/tools/convert-timezone.ts` — new tool
- [ ] `lib/agent/tools/index.ts` + tool-registry — register
- [ ] `lib/agent/orchestrator.ts` (or wherever chat system prompt is) — TZ + scheduling-domain + context-reuse rules; user TZ + local time injection
- [ ] `lib/agent/email/agentic-l2-prompt.ts` — same rule blocks + draft-body dual-TZ instruction
- [ ] `lib/agent/email/sender-timezone-heuristic.ts` — new heuristic; wired into agentic-l2.ts
- [ ] `lib/agent/email/draft.ts` (+ its prompt) — dual-TZ rendering when student TZ != sender TZ
- [ ] `lib/agent/preferences.ts` — confirm/add `getUserTimezone(userId)`
- [ ] `lib/agent/email/l2.ts` — `ProcessL2Options.userClarification` threaded through
- [ ] `app/app/queue-actions.ts` `queueSubmitClarificationAction` — immediate re-run with freeText
- [ ] `tests/agent-tools-convert-timezone.test.ts` — convert_timezone unit tests
- [ ] `tests/sender-timezone-heuristic.test.ts` — heuristic mapping tests
- [ ] `tests/agentic-l2-tz-rendering.test.ts` — prompt contains TZ rules (regression)
- [ ] Tests for immediate re-draft flow
- [ ] Live dogfood verified per Verification section
