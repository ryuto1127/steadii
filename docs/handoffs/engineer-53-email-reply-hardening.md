# Engineer-53 — Email reply hardening (post-dogfood 2026-05-13)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_agent_failure_modes.md` — taxonomy of named modes; you'll add one new entry
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — canonical fixture user (畠山 竜都 / Ryuto)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prompts_in_english.md` — internal docs and prompt sections stay in English; user-facing messages keep their bilingual treatment
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_typecheck_before_push.md` — typecheck before every push, including `tests/agent-evals/*` and `scripts/*`

Reference shipped patterns:

- `lib/agent/prompts/main.ts` — system prompt. OUTPUT GROUNDING (line ~108), TIMEZONE RULES (~154), FUZZY MATCH ON ZERO HITS (~182). The "Worked example — email reply intent" section (~130) is the current weak spot.
- `lib/agent/self-critique.ts` — placeholder-leak detector + corrective message builder. Add new detectors here.
- `lib/agent/orchestrator.ts` — retry pass (PR #235 sparring inline shipped tool-calls-in-retry). Self-critique integration is line ~438. Do not refactor the retry orchestration — just extend the detector set.
- `lib/agent/tool-registry.ts` — `openAIToolDefs` (full) and `openAIToolDefsReadOnly` (read-only subset for the retry). Both are used; pick the right one.
- `tests/agent-evals/scenarios/placeholder-leak-email-reply.ts` — existing scenario for the failure shape (PR #232). The user message includes hints that bias the model toward passing — see Part 4 for the fix.
- `lib/agent/email/audit.ts` `email_audit_log` — eval runs leave breadcrumbs.

---

## Strategic context — the 2026-05-13 dogfood failure

Ryuto opened a chat and typed (verbatim):

> 令和とレベルとの次の面接日程へのメールを返したいです

The actual inbound email was a structured 令和トラベル recruiter message with 3 candidate interview slots:
- 2026/5/15 (金) 10:00–11:00 + 11:30–13:00
- 2026/5/19 (火) 16:30–18:00
- 2026/5/22 (金) 13:30–14:00

…and an explicit response template asking for first/second/third choice with the user's name in the salutation.

**What the agent did**:
1. Called `lookup_entity` → resolved "令和トラベル" (transparent autocorrect worked — PR #227)
2. Stopped. Did NOT call `email_get_body`, `infer_sender_timezone`, or `convert_timezone`.
3. Drafted from imagination:
   ```
   件名: Re: 次回面接日程のご連絡
   令和トラベル
   〇〇様
   お世話になっております。〇〇です。
   ご連絡ありがとうございます。
   ご提示いただいた日程で問題なく参加可能です。
   当日は何卒よろしくお願いいたします。
   ```
4. Trailing meta-narration: "必要なら…整えます。メール本文を確認して、必要な情報を拾います。" — promising the next action AFTER the draft was already emitted.

**Failure modes that fired** (all named, see `feedback_agent_failure_modes.md`):
- `METADATA_CONFUSED_FOR_CONTENT` — entity metadata treated as enough to draft
- `PLACEHOLDER_LEAK` — 〇〇様 / 〇〇です shipped
- `TOOL_CHAIN_TRUNCATED` — only 1 tool call, missing 3+ expected
- `OUTPUT GROUNDING` violation — no concrete slot, no slot list, no TZ
- **NEW** `SUBJECT_LINE_FABRICATED_ON_REPLY` — 件名 line generated even though Gmail auto-prefixes "Re:" on a reply
- `ACTION_COMMITMENT_VIOLATION` (trailing variant) — "確認します" emitted after the draft instead of before

**Why PR #230's self-critique didn't save it**: the retry pass passed `tools` to OpenAI but ignored any `tool_calls` in the response. Model could only re-write the leaky template, never fetch. **PR #235 fixed the runtime safety net** — retry now executes read-only tool calls and re-streams. Engineer-53 is the **structural** fix: stop the failure from happening in the first place.

---

## Scope — build in order

### Part 1 — EMAIL REPLY WORKFLOW: worked-example → MUST-rule

`lib/agent/prompts/main.ts` currently has a "Worked example — email reply intent" section (around line 130). Models routinely skim worked examples; the agent did exactly that on 2026-05-13. Replace it with a binding rule section.

**Detection triggers** (reply intent):
- JA: `返したい` / `返信したい` / `返信したい` / `返事` / `返信ドラフト` / `下書き` / `送りたい`
- EN: `reply`, `respond`, `draft a reply`, `write back`

When reply intent is detected AND a known sender/entity is present in the conversation or via `lookup_entity`:

1. **MUST** call `email_search` or follow `lookup_entity.recentLinks` to identify the inbox_item.
2. **MUST** call `email_get_body` on that inbox_item BEFORE emitting any draft text. Drafting without calling `email_get_body` is a failure mode (METADATA_CONFUSED_FOR_CONTENT).
3. **MUST** call `infer_sender_timezone` on the sender+body before citing any time.
4. **MUST NOT** include a `件名` / `Subject:` line in the draft body. Gmail auto-prefixes "Re:" on a reply; surfacing a fabricated subject is the new `SUBJECT_LINE_FABRICATED_ON_REPLY` failure mode.
5. **MUST** use the user's real name in the sign-off — pull from `USER_FACTS` (`save_user_fact` may have a "my name is" entry) or from the user's profile name. Never emit `〇〇` for the sign-off.
6. **MUST** cite at least one specific body-derived value (a date, a slot, a participant, a deadline) in the draft. A draft that could apply to ANY email is PLACEHOLDER_LEAK by definition.
7. When the email proposes candidate slots, **MUST** echo each slot back in the draft with TZ conversion to user-local (see TIMEZONE RULES — dual TZ on first mention).

Frame these as MUST rules at the **top** of the section, with a single short worked example below. Order matters — models read top-down and the first rules are most binding.

### Part 2 — `SUBJECT_LINE_FABRICATED_ON_REPLY` taxonomy entry

`feedback_agent_failure_modes.md` — add a new entry between `PLACEHOLDER_LEAK` and `METADATA_CONFUSED_FOR_CONTENT`:

```markdown
### `SUBJECT_LINE_FABRICATED_ON_REPLY`

**Shape:** Agent emits a fabricated subject line (`件名: Re: ...` / `Subject: Re: ...`) inside the draft body for a reply.

**Root cause:** Reply intent ≠ new-mail intent. Email clients auto-prefix `Re:` on the parent subject; the draft body should be reply prose only. The agent's training data includes new-mail templates, and without explicit prompt enforcement it defaults to the new-mail shape.

**Fix:** EMAIL REPLY WORKFLOW MUST-rule 4 (PR #NNN). Self-critique detector regex: `/^\s*(件名|Subject)\s*[:：]/m`. When the chat-orchestrator's response is detected as a reply context AND contains a fabricated subject line, treat as PLACEHOLDER_LEAK-class and trigger the retry path.
```

Also update the existing taxonomy entries to cross-link to scenarios:
- `PLACEHOLDER_LEAK` → `tests/agent-evals/scenarios/placeholder-leak-email-reply.ts` + new `email-reply-terse-typo.ts`
- `METADATA_CONFUSED_FOR_CONTENT` → `tests/agent-evals/scenarios/metadata-confused-for-content.ts`
- `SUBJECT_LINE_FABRICATED_ON_REPLY` → new `tests/agent-evals/scenarios/subject-line-fabricated.ts`

### Part 3 — Self-critique detector extensions

`lib/agent/self-critique.ts` — extend `FORBIDDEN_TOKENS`:

```typescript
// SUBJECT_LINE_FABRICATED_ON_REPLY — a 件名/Subject line at the start
// of a draft body is wrong for reply context (email client auto-
// prefixes Re:). The detector is conservative: only fires when the
// line is at line-start AND followed by Re:/RE:/re: pattern.
{
  name: "件名 fabricated on reply",
  pattern: /^\s*(件名|Subject)\s*[:：]\s*Re:/im,
},

// ACTION_COMMITMENT trailing — narration of a future action AFTER a
// draft / answer was already emitted. The detector looks for these
// phrases anywhere in the response (the orchestrator's main loop is
// supposed to invoke the tool in the SAME turn; if the phrase reaches
// the user it means the tool wasn't called).
{
  name: "trailing future action",
  pattern: /(メール本文を確認します|確認して報告します|チェックして送ります|reviewing the email|let me check the body)/i,
},
```

Update `buildPlaceholderLeakCorrection` to mention these new modes explicitly. Adjust the existing tests in `tests/self-critique.test.ts` to cover the new patterns + ensure no false positives on benign sentences.

### Part 4 — Real-world eval scenarios

The existing `tests/agent-evals/scenarios/placeholder-leak-email-reply.ts` includes the user message:

> 令和トラベルとの面接日程に返信したい。候補3つそれぞれを JST と PT 両方で見せて。

This is biased toward passing — "候補3つ" and "JST と PT 両方で見せて" are hints the real user would never type. Add a new scenario that mirrors actual dogfood phrasing:

**`tests/agent-evals/scenarios/email-reply-terse-typo.ts`**:
```typescript
input: {
  userMessage: "令和とレベルとの次の面接日程へのメールを返したいです",
},
// Assertions: same as placeholder-leak-email-reply but using a typo'd
// entity name (令和とレベル) and no instructional hints. The agent
// must (a) fuzzy-match to 令和トラベル AND disclose the correction,
// (b) call email_get_body, (c) call infer_sender_timezone, (d)
// call convert_timezone for each slot, (e) emit no 〇〇, no 件名 line,
// and at least 3 concrete date/time tokens, (f) use the user's actual
// name (from facts) in the sign-off.
```

**`tests/agent-evals/scenarios/subject-line-fabricated.ts`** — new scenario specifically for the new failure mode. Fixture has an email; user asks to reply; assertion `response_does_not_match` against `/^件名:/m`.

**`tests/agent-evals/scenarios/trailing-action-narration.ts`** — new scenario for the trailing-future-action mode. Fixture supplies an email; user asks a question that the agent could answer with `email_get_body`; assertion that the final text does NOT contain `確認します` / `メール本文を確認します` etc.

Update `tests/agent-evals/scenarios/index.ts` to include the new scenarios.

### Part 5 — Sign-off grounding (user name injection)

The `〇〇です` sign-off failure has two layers:
1. Prompt doesn't tell the agent to use the user's real name
2. The user's real name may not be in `USER_FACTS` if `save_user_fact` hasn't captured it

For (1): add a MUST rule in EMAIL REPLY WORKFLOW (Part 1, rule 5). Already covered above.

For (2): build an automatic injection. The user's `name` field on the `users` table is already populated at signup. Either:
- (a) Inject it as a synthetic `USER_FACTS` row at orchestrator entry time
- (b) Add `name` to the system prompt context directly (`USER_NAME: 畠山 竜都`)

Lean: **(b)**. Simpler, doesn't pollute the user-facts table with auto-generated entries. Add to the system prompt assembly path. Test that `〇〇です` no longer appears in the eval scenario sign-offs.

### Part 6 — Streaming UX cleanup (OPTIONAL — may defer to engineer-54)

Current retry path streams BOTH the leaky iter-1 text AND the clean retry text to the user. They see two drafts back-to-back, which is confusing. Options:
- (a) Buffer iter-1 text; only stream once we know it's clean
- (b) Emit a `text_clear` event before retry streams; UI clears the visible message buffer
- (c) Leave as is; rely on the DB row being clean on reload

Lean: **(c) for now**. Real fix is to never emit a leaky text in the first place (Parts 1–5). Streaming-UX cleanup is a secondary patch when the leak rate drops to near-zero and we want to clean up the rare cases. Document the decision; don't ship (a)/(b) unless the new eval scenarios show frequent leaks even with the structural fix in.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-53
```

## Verification

- `pnpm typecheck` clean
- `pnpm test` — full suite green, +12–18 new tests (self-critique detector cases + sign-off grounding + harness self-tests)
- `pnpm eval:agent` — 8 → 11 scenarios pass live. Cost: ~\$0.015/run
- Manual: re-run the 令和トラベル dogfood scenario in the production preview; agent should call `email_get_body` + `infer_sender_timezone` + `convert_timezone` and emit a grounded draft with no `〇〇`, no `件名:` line, real sign-off, all 3 slots cited with JST + PT dual display.

## Out of scope

- Voice agent reply path (uses `lib/voice/*`, different orchestrator). If voice surfaces the same failure modes, separate engineer.
- Agentic L2 (proactive draft generation) — has its own structured-output JSON schema. The agentic path's drafts are NOT subject to the chat orchestrator's self-critique. Different failure surface; out of scope here.
- Streaming UX cleanup (Part 6 deferred unless eval shows frequent residual leaks).
- Subject-line-on-NEW-mail (sending to a new recipient, not a reply). The MUST rule scoping needs to differentiate "reply context" from "new mail" carefully.

## Memory entries to update on completion

- `feedback_agent_failure_modes.md` — new `SUBJECT_LINE_FABRICATED_ON_REPLY` entry + scenario cross-links for all existing modes
- The handoff PR's title / body should reference all named modes touched, per memory convention
