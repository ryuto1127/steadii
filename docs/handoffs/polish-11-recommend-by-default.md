# Polish-11 — Agent recommends by default (instead of polling on obviously-resolvable choices)

A small but high-leverage system-prompt fix. Steadii's chat agent currently splits decisions evenly when it surfaces options, even when one option is clearly stronger than the other. The behavior reads as polite-but-tone-deaf — like asking the user to do work the agent could already do itself. Replace with a "recommend by default, only poll when truly ambiguous" rule.

## The observed bug (Ryuto's dogfood, 2026-04-27)

User asks Steadii to merge two duplicate calendar events. Steadii lists them:

- アクメトラベル — 2026-05-07 20:00–21:00 (no Meet link, generic name)
- アクメとラベルのインターンシップ グループディスカッション — 2026-05-07 20:00–21:00, Meet: https://meet.google.com/oyu-zduv-mdg

Then asks: "どちらを残しますか? 「1つ目を消して」「2つ目を消して」のように指定してください。"

A reasonable human (or "気が利く 先輩") would say: "インターンシップの方残しますね — Meet link 付いてるしどっちが何の予定か分かりやすいので。トラベルの方消していい?"

The agent had all the information it needed to recommend (information density, Meet link presence, naming specificity). It chose to evenly poll instead. This makes the agent feel like a slow assistant, not a calm operator.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Most recent expected: the polish-10 merge commit (chat syllabus auto-import + attachment-only + Enter-to-send). If main isn't at polish-10 or later, **STOP** — this PR builds on polish-10.

Branch: `polish-11-recommend-by-default`. Don't push without Ryuto's explicit authorization.

---

## Fix — System prompt rule + few-shot examples

Single-file change for the core fix: `lib/agent/prompts/main.ts`.

### Add a new section: "Recommend, don't poll"

Place it BETWEEN the existing `PROACTIVE SUGGESTIONS` and `Action commitment` sections (the proactive-suggestions block teaches "when to suggest action buttons unprompted"; the new block teaches "how to frame choices when you DO ask the user something"). The two are related but distinct.

Suggested copy (English; the rule itself stays in EN since the surrounding prompt is EN — the agent renders in the user's language at output time):

```
RECOMMEND, DON'T POLL

When you present the user with a choice between two or more options
(which duplicate to delete, which file to use, which class to assign
to, which date to pick from candidates), do NOT split the decision
evenly unless the options are genuinely equivalent. If one option
is clearly stronger by any of: information density, presence of
links/attachments, naming specificity, recency, or alignment with
the user's stated intent — state your recommendation in one short
line, then ask the user to confirm or override.

The framing changes from "you decide" to "I'd do X — that OK?"

Examples of clearly-stronger options:
- Two duplicate calendar events, one has a Meet link and a specific
  name ("アクメとラベルのインターンシップ グループディスカッション"),
  the other is generic ("アクメトラベル") → recommend keeping the
  one with the Meet link.
- Two syllabus PDFs uploaded, one is dated this semester and the
  other is from a previous year → recommend the current one.
- Two possible classes to attach a mistake note to, one matches the
  problem topic exactly → recommend that class.
- Multiple candidate dates from a vague request ("来週のどこか")
  + one date is already free in the user's calendar → recommend
  the free date.

Only fall back to a pure polling question ("どちらにしますか?") when
the options are genuinely interchangeable — same information, same
recency, same fit. In that case, keep the question short and don't
list overly-formal selection rules ("「1つ目を消して」「2つ目を消し
て」のように指定してください" is too procedural).

This rule complements destructive-operation confirmation: you still
require explicit user confirmation before executing a destructive
action; the difference is that you arrive at confirmation having
already taken a position, not having punted the decision back.
```

### Why this exact framing

- "RECOMMEND, DON'T POLL" as a header makes it scannable in the prompt and easy to reference in future feedback rules.
- The example list teaches the LLM by pattern, not by exhaustive enumeration. Four examples are enough — more bloats the prompt without improving recall.
- The "you decide" → "I'd do X — that OK?" reframing is the exact pivot we want; quoting it explicitly trains the model on the *form* of the response, not just the *content*.
- The closing paragraph ties it back to the existing `Destructive operations:` rule (line 25-26) so the model doesn't think it can skip confirmation just because it now recommends.

---

## Test scenarios (manual smoke)

After deploying:

1. **Reproduce the original bug.**
   - Set up two duplicate calendar events: one with Meet link + descriptive name, one with generic name + no link, both at the same time.
   - Ask Steadii: "重複してる X と Y のミーティング、一つにして"
   - Expected: agent recommends keeping the one with the Meet link, asks for confirmation, then deletes the other after confirm.
   - Was: agent listed both and asked the user to pick.

2. **Genuinely ambiguous case still polls.**
   - Set up two events with identical info except start time (10:00 vs 14:00, both today, same name, no other distinguishing features).
   - Ask Steadii: "どちらの予定が今日の本番?"
   - Expected: agent asks plainly, since it has no signal to recommend.

3. **Multi-syllabus PDF upload (cross-tests with polish-10 syllabus_extract).**
   - In a single chat, attach a current-semester syllabus, then attach a previous-semester syllabus for the same course.
   - Ask: "どっちのシラバス使う?"
   - Expected: agent recommends the current-semester one with a 1-line rationale (e.g., "今学期の方使いますね — 過去の方は参考までに残しておきます").

4. **Tone check.**
   - Across the above, agent's recommendation framing should feel calm and confident, not apologetic ("もしよろしければ…" 過剰) or robotic ("システムは X を推奨します"). Match Steadii's "calm, concise" voice from line 1 of the prompt.

5. **Destructive confirmation still gates the action.**
   - In test 1, after the agent recommends and the user confirms, verify the calendar deletion still goes through the existing confirmation flow — don't auto-execute on the user saying "うん" alone if the existing destructive-ops contract requires more.

No new automated tests required — this is a prompt-engineering change, not a code path change. If existing prompt tests reference the old behavior (e.g., snapshot tests of system prompt content), update them.

---

## Verification

1. `pnpm typecheck` — clean
2. `pnpm test` — all green; if any test snapshots the system prompt, update those
3. Five manual smoke scenarios above
4. Visually inspect the prompt with `git diff lib/agent/prompts/main.ts` — confirm the new section is between PROACTIVE SUGGESTIONS and Action commitment, and that no other section was accidentally edited

---

## Out of scope

- UI-side "推奨" badge on action buttons in multi-action proposals — separate concern (Phase 8 already has the proposal-generator pattern; if we want to mark a recommended button there, that's a different PR)
- Changing the destructive-operations confirmation flow itself
- Tuning the proactive-suggestions trigger sensitivity
- Adding feedback-loop signal for "user accepted recommendation vs overrode" — defer until α observation tells us if recommendations are being accepted
- Translating the system prompt itself to Japanese — the agent already responds in the user's language; the prompt language is irrelevant to user-facing tone

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- The existing `Destructive operations:` and `Action commitment` rules MUST remain intact — the new rule complements, not replaces them

---

## Context files to read first

- `lib/agent/prompts/main.ts` — the only file you edit
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — the agent execution model + risk-tiered confirmations + L3-lite feedback loop. The "recommend by default" rule fits the same philosophy: agent takes a position, user gates execution.
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — tone reference ("淡々 + 軽いユーモア", "静かな精度")
- `docs/handoffs/polish-7-agent-calibration.md` — most recent agent-tuning PR; pattern for how prompt-level fixes have been scoped before

---

## When done

Report back with:
- Branch name + final commit hash
- Verification log (typecheck, tests, all 5 manual smoke scenarios above with one-line outcome each)
- Any deviations from this brief + 1-line reason each
- A short note on the agent's tone in the recommendation framing — does it sound natural in JA + EN, or does it default to one language's idiom too strongly?

The next work unit is the landing-page demo video recording — this fix sharpens how the agent feels in the demo footage (especially Scene 1's "明日大学行けないかも" → proactive D13 buttons, where the agent's recommendation framing is visible).
