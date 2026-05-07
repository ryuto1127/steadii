# Engineer-37 — Dogfood pack: agent autonomy + home one-click complete + 7-day window

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_post_engineer_fix_routing.md`

Reference shipped patterns:

- `lib/agent/prompts/main.ts` — system prompt for the chat agent. Currently has confirm-before-mutate guidance for destructive ops only; needs to clarify reversible writes.
- `lib/agent/tools/tasks.ts:284` — `tasksCompleteTask` tool (Google Tasks + MS To Do via `patchMsTask`). Reversible: pass `completed: false` to reopen.
- `lib/agent/tasks-actions.ts:68` — `completeTaskAction` server action wrapping the tool for UI use.
- `lib/dashboard/today.ts` — `getTodaysEvents`, `getDueSoonAssignments`. Both currently scoped to today (events) or 168h (deadlines).
- `app/app/page.tsx:148` — `fetchTodayTasks` aggregates Steadii + Google Tasks + MS To Do. `mergeTodayTasks` flattens external tasks into synthetic IDs (`external:<due>:<i>:<title>`) — **this loses source info needed for one-click complete**.
- `components/agent/today-briefing.tsx` — three-pane briefing (events / tasks / deadlines), currently 3 rows per pane.

---

## Strategic context

Ryuto dogfood feedback 2026-05-07 (chat screenshot of `/app/chat/...`):

> "今日のタスク完了" → Steadii: "今日のタスクは1件です。... 完了にしますか？"

Three problems surfaced:

1. **Agent autonomy too conservative.** When user input is unambiguous AND the action is reversible AND there is exactly one matching target, Steadii should execute directly, not confirm. Confirming on a reversible 1-target write feels secretarial in the wrong way — it makes the user click twice.
2. **Home should expose one-click complete.** Today the only way to complete a task from the briefing is via chat. Add a checkbox on the today-tasks pane.
3. **The "today" window is too narrow.** Calendar / tasks / deadlines panes each cap at today's items only (events) or 168h (deadlines, already 7d). Ryuto wants the events + tasks panes to also surface a 7-day horizon, not just today.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected commit: `e10e1d7` (PR #172, engineer-36) or any sparring inline after this handoff doc lands. If main is behind, **STOP**.

Branch: `engineer-37-dogfood-pack`. Don't push without Ryuto's explicit authorization.

---

## What changes

### Part A — Agent autonomy on reversible 1-target writes (~50 LOC)

Edit `lib/agent/prompts/main.ts`. Insert a new section ABOVE the existing "Destructive operations" block:

```
Reversible single-target writes — execute, don't confirm

When the user's intent is unambiguous (verb explicitly says complete/done/mark/finish OR open/reopen) AND there is exactly ONE matching target after read-tool lookup AND the action is reversible (tasks_complete, tasks_create with full context, calendar_update_event of a single event, etc.), execute the tool directly in the SAME assistant turn. Do NOT pause to confirm — confirming a reversible 1-target action turns Steadii into a paperwork machine.

Confirm only when:
- The action is destructive (delete) OR irreversible by Steadii (cancel a calendar invite already sent).
- The target is ambiguous (multiple candidates) — surface the candidates and ask which.
- The user's verb is reversal-prone ("update", "change") AND the new value is a guess on Steadii's part.

After executing, surface the result in a one-line confirmation: "1件完了 (タスク名)" / "Marked X done." Reopening guidance ("もし違ったら『戻して』で取り消せます") only when the user might plausibly have misspoken — don't add it on every action.
```

The tools themselves don't need changes — the chat agent's behavior shifts via prompt only.

**Tests** (`tests/agent-autonomy-prompt.test.ts`, NEW, ~5 cases):
- Use a stub LLM that exposes the system prompt verbatim, then string-match the new section is present.
- That's it — true behavioral testing requires LLM eval which is out of scope; the prompt presence test catches accidental regression.

### Part B — Home one-click complete on the today-tasks pane (~250 LOC)

#### B1. Source-preserving task aggregation

Edit `app/app/page.tsx:148`. Change `fetchTodayTasks` return type from:
```ts
Array<{ id: string; title: string; classTitle: string | null }>
```
to:
```ts
type TodayTask =
  | { kind: "steadii"; id: string; title: string; classTitle: string | null }
  | { kind: "google"; taskId: string; taskListId: string; title: string }
  | { kind: "microsoft"; taskId: string; taskListId: string; title: string };
```

`fetchUpcomingTasks` (Google) and `fetchMsUpcomingTasks` (MS) already return tasklist IDs internally — thread them through. Update `mergeTodayTasks` accordingly; existing test (`tests/merge-today-tasks.test.ts`) needs update.

Steadii rows have `kind: "steadii"`. Note: Steadii assignments are NOT directly toggleable via `tasks_complete` (that tool routes to external providers only by `lookupEventSource`). For Steadii rows, add a separate `completeAssignmentAction(assignmentId)` server action that updates `assignments.status = 'done'`.

#### B2. New client component `TodayTasksList`

Replace the inline `.map` in `components/agent/today-briefing.tsx` for the tasks pane with a new client component. The pane stays a Link wrapper; the client component is rendered inside.

- File: `components/agent/today-tasks-list.tsx` (new, "use client")
- Props: `{ tasks: TodayTask[]; cap?: number }`
- Each row: a checkbox + title + secondary (class title for Steadii, empty for external for now).
- Click handler: `useTransition` + call the right server action based on `task.kind`. Optimistic UI — strike-through + checkbox checked immediately, revert on action error.
- After action succeeds, the row stays in the list with `aria-checked` and grey-out for ~500ms, then `revalidatePath("/")` from the server action removes it on next navigation/refresh.
- Stop the click event from bubbling up to the pane Link — checkbox interactions must NOT trigger a page navigation.

#### B3. Server actions

Add to `lib/agent/tasks-actions.ts`:
```ts
export async function completeAssignmentAction(args: { assignmentId: string }): Promise<void>
```
Calls `db.update(assignments).set({ status: "done", updatedAt: new Date() }).where(...)` with userId scoping. Calls `revalidatePath("/")` and `revalidatePath("/app/tasks")`.

Reuse existing `completeTaskAction` for Google + MS rows.

#### B4. Tests (`tests/today-tasks-one-click.test.ts`, NEW, ~6 cases):
- `mergeTodayTasks` preserves `kind` for Steadii / Google / MS sources.
- `completeAssignmentAction` updates status, scoped to user, calls `revalidatePath`.
- `TodayTasksList` rendered server-side (Vitest in node env, just markup): shows N checkboxes for N tasks.

---

### Part C — 7-day window expansion (~150 LOC)

#### C1. Server-side window param

`lib/dashboard/today.ts` — add a `daysAhead` param to `getTodaysEvents`:

```ts
export async function getTodaysEvents(
  userId: string,
  opts: { daysAhead?: number } = {}
): Promise<TodayEvent[]>
```

Default `daysAhead = 7`. The window becomes `[localMidnight(today)..localMidnight(today + daysAhead))`. Increase `maxResults` from 25 to 50 since 7 days has more.

`fetchTodayTasks` in `app/app/page.tsx:148` — change `daysAhead` to 7 in `fetchUpcomingTasks` / `fetchMsUpcomingTasks` calls (currently `days: 1`). Steadii assignments query: change the upper bound from `localMidnightAsUtc(addDaysToDateStr(today, 1), tz)` to `addDaysToDateStr(today, 7)`. Returned items keep their existing shape (with the `kind` discriminator from B1).

`getDueSoonAssignments` — already 168h (=7d). No change.

#### C2. UI: keep pane caps small, show "+ X more this week" footer

`components/agent/today-briefing.tsx` — increase per-pane row cap from 3 to 5. When `events.length > 5` (or `tasks.length > 5`), append a small footer row: `"+ {n - 5} more this week"` (i18n: `home_v2.more_this_week`). Click-through to the pane's `href` is already wired.

For the events pane, group rows by day when there are entries on multiple days. Day separator is a small heading row inside the `<ul>`: `"今日 (5/7)"` / `"明日"` / `"5/9 木"` / etc. Same pattern for the tasks pane.

#### C3. i18n updates

`lib/i18n/translations/en.ts` + `ja.ts`:

- `home_v2.today_calendar_heading`: "Calendar" → "Next 7 days" / "今後7日間" — but actually keep the JA "今日" tone where possible. Specifically: heading stays "予定" (events) but is preceded by an icon strip. The phrase "TODAY" badge inside row entries indicates today vs upcoming.
- New keys:
  - `home_v2.more_this_week`: `+ {n} more this week` / `+ {n} 件 今週中`
  - `home_v2.day_today`: `Today` / `今日`
  - `home_v2.day_tomorrow`: `Tomorrow` / `明日`
- Existing `today_no_events` / `today_no_tasks` strings: rephrase to "Nothing scheduled in the next 7 days" / "今後7日間に予定なし". Same for tasks.

The pane heading icon strip stays minimal so the visual rhythm doesn't change.

---

## Files

- `lib/agent/prompts/main.ts` (Part A: prompt edit, ~50 LOC)
- `lib/agent/tasks-actions.ts` (Part B3: new `completeAssignmentAction`, ~25 LOC)
- `app/app/page.tsx` (Parts B1 + C1: refactor `fetchTodayTasks`, expand window, ~50 LOC)
- `components/agent/today-briefing.tsx` (Part C2: row cap + day grouping + more-this-week footer, ~80 LOC)
- `components/agent/today-tasks-list.tsx` (Part B2: NEW client component, ~120 LOC)
- `lib/dashboard/today.ts` (Part C1: `getTodaysEvents` daysAhead param, ~10 LOC)
- `lib/i18n/translations/en.ts` (Part C3, ~15 LOC inc type def widening)
- `lib/i18n/translations/ja.ts` (Part C3, ~10 LOC)
- `tests/agent-autonomy-prompt.test.ts` (NEW, ~50 LOC)
- `tests/today-tasks-one-click.test.ts` (NEW, ~150 LOC)
- `tests/merge-today-tasks.test.ts` (existing, update for new `kind` discriminator)

No schema changes. No migration.

Total LOC: ~560 (test files dominate; production code ~360).

---

## Tests

- New `agent-autonomy-prompt.test.ts` — string-match the new prompt section is present.
- New `today-tasks-one-click.test.ts` — `mergeTodayTasks` source preservation + `completeAssignmentAction` round-trip + `TodayTasksList` server-render markup.
- Updated `merge-today-tasks.test.ts` for the new `kind` discriminator on `TodayTask`.
- Existing 1001 tests stay green.
- Aim: **~1010+** total.

`pnpm test` + `pnpm tsc --noEmit` clean before opening the PR.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA. Required:

- `/app` (home page) showing the today-briefing with multi-day grouped events/tasks. EN + JA.
- The tasks pane with at least one Steadii assignment + at least one Google task — checkbox UI visible. EN + JA.
- After clicking a checkbox: row strikes through and disappears on next refresh.
- The "+ N more this week" footer when applicable.
- Chat behavior: open `/app/chat/<new>`, type "今日のタスク完了" → expect Steadii to call `tasks_complete` AND surface "1件完了" or similar, NOT "完了にしますか?". (This part is observational — not a unit test, just a smoke check via the chat surface.)

---

## Out of scope

- Polished week-view bento (multi-row per day with inline event details). The grouped row cap + footer is a minimal adaptation; full week view is a separate design pass.
- Auto-execute on plural intent like "全部のタスク完了". Defer — single-target only for now to keep the autonomy lever conservative.
- Reopening shipped tasks via Home (only complete; reopening stays in chat / `/app/tasks`).
- iCal subscriptions in the today-tasks pane — those land via Steadii assignments after sync, so they're already covered as `kind: "steadii"`.
- Mobile-specific layout adjustments. Engineer-37 keeps the existing 1-col → 3-col grid; mobile pass is its own track.

---

## Final report (per AGENTS.md §12)

- Branch / PR: `engineer-37-dogfood-pack`
- New tests: `agent-autonomy-prompt.test.ts` + `today-tasks-one-click.test.ts` with case counts, total test count delta from 1001 baseline.
- Production LOC vs test LOC split.
- Screenshot pairs EN + JA: home with multi-day events, home with checkbox-clickable tasks pane, chat behavior smoke screenshot showing autonomous task complete.
- One-line note on observed chat agent behavior: did "今日のタスク完了" trigger a direct `tasks_complete` call or did it still confirm? If still confirming, the prompt edit needs more iteration — flag and STOP, don't merge.
- **Memory entries to update**: `sparring_session_state.md` updated by sparring after merge. Possibly add a `feedback_agent_autonomy.md` if Ryuto wants to lock the autonomy rule.
