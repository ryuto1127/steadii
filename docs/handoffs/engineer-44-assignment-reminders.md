# Engineer-44 — Multi-tier assignment reminders + chat-tool creation

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_ms_education_admin_consent.md` — why Teams Assignments API is blocked at α
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md` — Type C card surface (where these reminders render)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — Drizzle journal entry rule (no migrations needed in this handoff, but read it before any DB change you decide to add)

Reference shipped patterns:

- `lib/agent/proactive/rules/classroom-deadline-imminent.ts` — closest existing rule. Reads `snapshot.calendarEvents` filtered by `sourceType='google_classroom_coursework'` and surfaces issues when due in <24h × status != completed. Mirror this but read from `snapshot.assignments` instead.
- `lib/agent/proactive/snapshot.ts` — `assignments` are already pulled into `UserSnapshot.assignments` (line 95-106) with `id, classId, title, dueAt, status`. Filter is `status != 'done'` AND `deletedAt IS NULL`. **No snapshot change needed.**
- `lib/agent/proactive/types.ts` — `UserSnapshot.assignments` shape (line 45). `ProactiveRule.detect()` contract.
- `lib/agent/proactive/scanner.ts` — rule registry (line 29-35). Add the new rule name.
- `lib/db/schema.ts:1685` — `assignments` table. `status: 'not_started' | 'in_progress' | 'done'`, `source: 'manual' | 'classroom' | 'chat'`, `dueAt`, `priority`, `notes`. **No schema change needed for the reminder rule.**
- `lib/agent/tools/classes.ts` — closest existing agent tool. Mirror its shape for `assignments_create`.
- `lib/assignments/save.ts` — `createAssignment` helper exists. The new chat tool just wraps this.
- `lib/agent/tools/index.ts` — registers tool names; add `assignments_create` here.
- `lib/agent/proactive/feedback-bias.ts` — every proactive proposal uses `notify_only` action and surfaces as a Type C queue card. New rule follows the same pattern.

---

## Strategic context

Ryuto pain point (2026-05-12):

> "Assignments の deadline に対して、1週間前に進捗 0 なら通知、1日前に通知、みたいなフローが欲しい。"

Teams API integration is dead-piled (admin-consent blocker — see `feedback_ms_education_admin_consent.md`). The reminder feature is the actual value; **source of the assignment doesn't matter** — it can be manual entry, Notion sync, Google Classroom, or (future) Teams.

This engineer ships:

1. **A multi-tier proactive rule** that reads the `assignments` table directly and surfaces escalating reminders.
2. **An `assignments_create` chat tool** so Ryuto can dictate "英作文の課題、来週水曜まで" and get a row inserted.

The two pieces together complete the loop: easy entry + automatic nag at the right cadence.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-44
```

---

## Scope

### Part 1 — Proactive rule `assignment_deadline_reminder`

New file: `lib/agent/proactive/rules/assignment-deadline-reminder.ts`.

**Behavior**: scan `snapshot.assignments` (already in the snapshot, no extra query needed). For each row, fire ONE issue at the tightest matching tier — never emit multiple tiers for the same assignment in the same scan (scanner cron runs 6 hourly so the user would get spammed otherwise).

**Tier table** (apply in this order — first match wins):

| Tier name | Window from now to dueAt | Status gate | Tone |
|---|---|---|---|
| `due_today` | `0 ≤ Δ ≤ 24h` | `status != 'done'` | "Due today — last call" |
| `due_in_1d` | `24h < Δ ≤ 48h` | `status != 'done'` | "Due tomorrow. Where are you?" |
| `due_in_3d` | `48h < Δ ≤ 72h` AND only fire when `status='not_started'` OR `status='in_progress'` (both — but message differs) | both | "Due in 3 days — start serious work now" |
| `due_in_7d` | `120h < Δ ≤ 168h` AND `status='not_started'` only | strict not_started | "Due in a week — worth blocking time?" |

Notes on the gaps:

- `72h < Δ < 120h` (3-5 days out) deliberately quiet — no useful reminder there.
- Past-due (`Δ < 0`) deliberately not in scope here. A separate `overdue_assignment` rule could land later; keep this PR focused.

**Issue type**: add `"assignment_deadline_reminder"` to `AgentProposalIssueType` enum in `lib/db/schema.ts`. Verify which file owns that enum — at last check it lived next to the existing scanner rule names. **Run a Drizzle migration if the enum is a Postgres enum type** (most likely it's a TS literal union with no DB enum — verify before generating).

**Issue summary copy** (JA primary, EN fallback — proactive rules emit JA per existing pattern):

| Tier | JA summary | EN reasoning (English internal) |
|---|---|---|
| `due_today` | `「{title}」が今日締切。まだ完了してません` | "Assignment '{title}' is due today and status is still {status}. Last call — either submit now or accept the late penalty." |
| `due_in_1d` | `「{title}」が明日締切（残り{hoursLeft}h）` | "Assignment '{title}' is due tomorrow ({hoursLeft}h left). Status: {status}. Where are you on it?" |
| `due_in_3d` (not_started) | `「{title}」が3日後締切、まだ未着手` | "Assignment '{title}' is due in 3 days and you haven't started. Time to block work." |
| `due_in_3d` (in_progress) | `「{title}」が3日後締切（着手中）` | "Assignment '{title}' is due in 3 days. You're in progress — final push." |
| `due_in_7d` | `「{title}」が1週間後締切、まだ未着手` | "Assignment '{title}' is due in 7 days. Worth blocking time on the calendar this week." |

**Source refs**: each issue includes `{ kind: 'assignment', id: assignment.id, label: assignment.title }`. Add `'assignment'` to the `SourceRef.kind` union if it isn't there yet. Verify against `lib/agent/proactive/types.ts`.

**Wire up**:

- Add `assignmentDeadlineReminderRule` to `lib/agent/proactive/scanner.ts` rule registry.
- Add to the issue-type ordering list (also in scanner.ts) so the dedup / ordering logic processes it.
- Add `"assignment_deadline_reminder"` to the `AgentProposalIssueType` union.

### Part 2 — Agent tool `assignments_create`

New file: `lib/agent/tools/assignments.ts`. Mirror `lib/agent/tools/classes.ts` shape.

**Tool definition**:

```ts
name: "assignments_create"
description: "Create a new assignment in Steadii with a due date and optional class linkage. Use this when the student says things like '英作文の課題、来週水曜まで' / 'I have a Bio test next Friday' / 'add an assignment for Math due Dec 5'. Date parsing: accept ISO (2026-05-20), relative ('next Friday', '来週水曜', 'in 3 days'), or absolute Japanese style ('12月5日'). When the student mentions a class, try to match it against the user's classes by name/code; if no match, leave classId null. Default status='not_started'."
```

**Input schema (zod)**:

- `title: string` — required
- `due: string` — ISO date-time OR natural-language (LLM passes through; resolve via `chrono-node` or similar — check if dep already exists, fall back to manual parsing if not)
- `classHint: string | null` — optional class name/code; the tool resolves it server-side
- `priority: 'high' | 'medium' | 'low' | null` — optional, default null
- `notes: string | null` — optional

**Implementation**:

1. Resolve `classHint` → `classId`. Query `classes` where `userId = ctx.userId AND lower(name) = lower(hint) OR lower(code) = lower(hint)`. Match the most recent (latest `createdAt`). Null if no match.
2. Parse `due` → `Date`. Reject if unparseable (return error to LLM).
3. Call `createAssignment({ userId: ctx.userId, title, dueAt, classId, priority, notes, source: 'chat' })` from `lib/assignments/save.ts`.
4. Return `{ id, title, dueAt, classId, classMatched: boolean }` so the LLM can confirm to the user.

**Register**:

- Add to `lib/agent/tools/index.ts`.
- Add to the `assistantToolDefs` OpenAI tool array.

**Test coverage**:

- Tool parses ISO date ✓
- Tool parses "next Friday" → resolves to upcoming Friday ✓
- Tool parses "来週水曜" → JA relative date ✓
- Tool matches class by name (e.g. "Bio" → existing class "Biology 12") ✓
- Tool leaves classId null when no match ✓
- Tool defaults `status='not_started'`, `source='chat'` ✓

### Part 3 — Rule unit tests

New file: `tests/assignment-deadline-reminder.test.ts`. Mirror `tests/proactive-rules.test.ts` shape. Cover:

- 7d not_started → fires `due_in_7d` ✓
- 7d in_progress → does NOT fire 7d (gated to not_started) ✓
- 3d not_started → fires `due_in_3d` (not_started variant) ✓
- 3d in_progress → fires `due_in_3d` (in_progress variant) ✓
- 1d any non-done status → fires `due_in_1d` ✓
- 0h any non-done status → fires `due_today` ✓
- 5d any → silent (intentional gap) ✓
- done status → silent regardless of due ✓
- deletedAt non-null → silent (handled by snapshot, but assert) ✓
- Past-due (negative Δ) → silent ✓
- Multiple assignments → multiple issues, no cross-talk ✓

---

## Out of scope

- **Microsoft Teams Assignments API integration** — admin-consent blocker, dead-piled per `feedback_ms_education_admin_consent.md`. Schema's `AssignmentSource` enum stays at `'manual' | 'classroom' | 'chat'`; do NOT add `'teams'` in this PR — wait until consent path is real.
- **Email action-items → automatic assignment creation** — separate value path. Engineer-45 candidate if Ryuto wants it after dogfooding this.
- **Overdue assignments rule** — separate rule (`overdue_assignment`) for past-due items. Out of scope here to keep the PR focused on proactive (forward-looking) reminders. Wave-5 already auto-archives overdue Tier 1 mail; assignments overdue handling can borrow that pattern later.
- **Push notifications** — Type C queue card surface is sufficient for α. Push channels (email digest, browser push) come later.
- **Adaptive thresholds** — fixed tiers (7d/3d/1d/0d) for α. Future iterations could learn user's procrastination pattern and scale per-assignment.

---

## Verification

After implementing:

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all tests pass including new ones
3. **Live dogfood via preview**:
   - `pnpm dev` → log in as Ryuto's account
   - Use the chat to create an assignment: "Add an assignment: 数学のテスト、来週金曜"
   - Verify a row appears in the `assignments` table with the correct `dueAt`, `source='chat'`
   - Optionally bump `assignments.dueAt` via SQL to simulate a 6-day-from-now case, run the scanner once: `pnpm tsx scripts/run-scanner.ts <userId>` (or whatever the manual scanner trigger is — check existing scripts)
   - Verify `agent_proposals` row appears with `issueType='assignment_deadline_reminder'`
   - Open `/app` and confirm the Type C card shows the JA summary
4. Screenshot: Type C card showing the new reminder

---

## Commit + PR

Branch: `engineer-44`. Push, sparring agent creates the PR.

Suggested PR title: `feat(reminders): multi-tier assignment deadline reminders + chat-tool creation (engineer-44)`

Suggested body bullets:

- New proactive rule `assignment_deadline_reminder` with 4 tiers (7d / 3d / 1d / 0d) gated by `assignments.status`. Fires at most one tier per assignment per scan.
- New agent tool `assignments_create` so users can dictate assignments via chat / voice and get a row inserted with class linkage.
- N new unit tests for the rule + tool.
- Out of scope: Teams API sync (admin-consent dead-piled), email-action-items auto-conversion, overdue handling.

---

## Deliverable checklist

- [ ] `lib/agent/proactive/rules/assignment-deadline-reminder.ts` — new rule
- [ ] `lib/agent/proactive/scanner.ts` — registry + ordering
- [ ] `lib/db/schema.ts` — add `"assignment_deadline_reminder"` to `AgentProposalIssueType` (verify whether it needs migration)
- [ ] `lib/agent/tools/assignments.ts` — new tool
- [ ] `lib/agent/tools/index.ts` — register tool
- [ ] `tests/assignment-deadline-reminder.test.ts` — rule tests
- [ ] `tests/agent-tools-assignments-create.test.ts` — tool tests
- [ ] All existing tests still pass
- [ ] Preview dogfood verified (steps in Verification section)
