# Polish — Agent eager-executes read tools (don't propose them)

## The bug

Reproducer (production, 2026-04-29): user types "5/16学校休む" in main chat. Agent responds with a "Proposed actions:" block listing all three of:

- `[calendar_list_events] 5/16 の予定を確認`
- `[tasks_list] 5/16 前後の課題を確認`
- `[calendar_create_event] 5/16 を欠席予定として記録`

**The two read tools should have been executed automatically with results inlined**, not surfaced as buttons. Reads have no side effects; the user shouldn't need to click a button to let the agent look up their own calendar. Only the third (`calendar_create_event`, write) is correctly proposal-shaped.

The current behavior makes Steadii feel "気が利かない" — the agent has the data and the tools, but stops at the doorway and asks permission to walk in.

## Verified pieces (already correct, don't change)

- Tool mutability tags are correct:
  - `lib/agent/tools/calendar.ts:74` — `calendar_list_events` → `mutability: "read"` ✓
  - `lib/agent/tools/tasks.ts:74` — `tasks_list` → `mutability: "read"` ✓
  - `lib/agent/tools/calendar.ts:176` — `calendar_create_event` → `mutability: "write"` ✓
- `lib/agent/confirmation.ts:10-11` — `requiresConfirmation` correctly skips reads
- `lib/agent/orchestrator.ts:226` — orchestrator correctly gates by `requiresConfirmation`

The execution-layer machinery is right. The bug is purely in the LLM prompt: it generates *proposal text* for read tools instead of *invoking* them.

## Root cause

`lib/agent/prompts/main.ts:32-48` (PROACTIVE SUGGESTIONS section) tells the model to surface ALL relevant tool calls as `Proposed actions:` buttons, with no rule distinguishing read tools (which can fire eagerly) from write/destructive tools (which warrant a button). Worse, the inline examples reinforce the wrong pattern:

> "明日大学に行けないかも" → look up tomorrow's classes/events; offer drafts to email each professor and a calendar mark.

Here the *lookup* (read) is described as something to "offer" — but lookups are exactly what should happen automatically before offering anything.

## Fix

### Part 1 — Prompt edit (`lib/agent/prompts/main.ts:32-48`)

Add an explicit rule at the top of the PROACTIVE SUGGESTIONS section:

> **Read tools execute eagerly; only write tools are proposed.** When the user's message gives you enough context to act, EXECUTE any relevant `mutability: "read"` tools immediately and inline the results in your response. Surface only `mutability: "write"` and `mutability: "destructive"` tools as proposed action buttons. Reads have no side effects — never ask permission to look something up the user already implicitly asked you to consider.

Revise the examples to model the correct behavior. Pattern: state the eager read inline, then list only the write proposals as buttons. E.g.:

- "明日大学に行けないかも" → eagerly: look up tomorrow's classes / calendar events / tasks; then propose: drafts to each affected professor + a calendar mark for the absence.
- "test 勉強する時間ない" → eagerly: look up upcoming exams + recent mistake-note count for that class; then propose: a study block on the calendar.
- "あの先生のメール返してないかも" → eagerly: search inbox for that sender + last reply timestamp; then propose: a draft.
- "週末旅行する" → eagerly: list calendar events / syllabus deadlines that weekend; then propose: nothing (just surface conflicts in the response — write actions only if user asks).

Keep the rest of the section (when NOT to suggest, output format) intact. The format change is small — read results land in the body of the response (use a short bullet list or compact prose), and only the existing "Proposed actions:" block at the end lists write tools.

### Part 2 — Tighten the related "Action commitment" rule (`lib/agent/prompts/main.ts:66-68`)

Currently:

> If you tell the user you will do something — invoke the corresponding tool in the SAME assistant turn.

Extend with:

> The same applies in reverse for read intent: if the user's message implies "find out X for me" (explicit or implicit), invoke the read tool in the SAME assistant turn — do not narrate the lookup as a future action.

This closes the loop: read tools are eager both because reads are free AND because the prompt now treats latent read intent as commitment-equivalent.

### Part 3 — Tests

Add Vitest scenarios in `tests/` (mirror existing agent prompt tests — find a suitable file via `grep -rln "MAIN_SYSTEM_PROMPT" tests/`). Add at minimum:

- **5/16 absence scenario**: feed the agent the prompt "5/16学校休む" + a stub tool environment that records which tools were called. Assert that `calendar_list_events` and `tasks_list` were CALLED (mock tool invocations recorded) and that the response text does NOT include `[calendar_list_events]` or `[tasks_list]` in a `Proposed actions:` block. Assert that the response DOES include `[calendar_create_event]` in `Proposed actions:`.
- **明日大学行けない scenario**: similar shape — read tools (calendar lookup) fire, write tools (drafts, calendar mark) are proposed.
- **Pure venting scenario**: "疲れた" — no tool calls fire (existing rule unchanged), no proposals.

If the existing test infrastructure doesn't support tool-call interception, scope a minimum harness — but do NOT block this PR on that. If a full intercept harness would 2x the PR, mark it as follow-up and ship the prompt-only change with snapshot tests verifying the new prompt string contents.

### Part 4 — Manual smoke

After landing, manually reproduce the original scenario in `/app`:

1. Sign in, open `/app`, fresh chat
2. Send "5/16学校休む"
3. Verify response: agent inlines actual calendar/task lookups for that date, then proposes ONLY `calendar_create_event` as a button
4. Send a few variants: "明日大学行けない", "テスト勉強する時間ない", "週末旅行する"
5. Verify each follows the eager-read + proposal-only-for-writes pattern

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Most recent expected: PR #85 merge or later. Branch: `polish-agent-eager-reads`. Don't push without Ryuto's explicit authorization.

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred — `project_agent_model.md` already names this risk-tier model; the prompt is catching up to it
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- Likely candidate: `project_agent_model.md` (already correctly describes the intent; verify whether the new explicit "read = eager" rule needs a sentence there making the prompt-level rule visible — or, if the file already says it clearly, write "none")

Plus the standard report bits: branch + commit hashes, verification log (typecheck, tests, manual smoke), deviations.

The next work unit after this is the **critical-path code review** (sparring-driven, ~1 day) before α invite.
