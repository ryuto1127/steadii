# Feat — MS Graph bidirectional sync (read-only → ReadWrite + agent write paths)

Ryuto's strategic clarification (2026-04-29): MS integration must support write operations, not just read. When the user asks the agent via chat to "add to calendar" / "create a task", or when syllabus auto-import generates events, the agent writes to the user's connected integration(s) — including MS for users who have MS connected.

Currently MS is read-only end to end:

- `lib/auth/config.ts:64` requests `Calendars.Read` + `Tasks.Read` (ReadWrite needed)
- `lib/integrations/microsoft/calendar.ts` exports only `fetchMsUpcomingEvents` (no create / patch / delete)
- `lib/integrations/microsoft/tasks.ts` exports only `fetchMsUpcomingTasks` (no create / patch)
- Agent tool layer (`lib/agent/tools/calendar.ts`, `lib/agent/tools/tasks.ts`) only routes write actions to Google
- Syllabus auto-import (`lib/agent/proactive/syllabus-import.ts`) writes events to Google Calendar only

This PR extends MS to full bidirectional parity with Google. Notion stays one-way per locked decision; iCal stays read-only by API design.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `feat-ms-bidirectional-sync`. Don't push without Ryuto's explicit authorization.

## Prerequisite (Ryuto-side, may already be done)

Azure portal → app registration "Steadii" → API permissions:
- Remove `Calendars.Read` + `Tasks.Read`
- Add `Calendars.ReadWrite` + `Tasks.ReadWrite` (delegated)
- Keep `User.Read` + `offline_access`

ReadWrite is a superset of Read; users won't see a friction increase. No admin consent needed (delegated scopes).

## Fix 1 — Update MS scope string

`lib/auth/config.ts:64`:

Replace:

```ts
"openid email profile offline_access User.Read Calendars.Read Tasks.Read"
```

with:

```ts
"openid email profile offline_access User.Read Calendars.ReadWrite Tasks.ReadWrite"
```

The `REFRESHABLE_PROVIDERS` re-sync logic (config.ts:21+) propagates the new scope to existing users on their next sign-in. They'll see a re-consent prompt for the wider scope, then the app catches up. No data migration needed.

## Fix 2 — Add MS Calendar write functions

`lib/integrations/microsoft/calendar.ts` currently exports only `fetchMsUpcomingEvents`. Add:

- `createMsEvent({ userId, ... })` — POST `/me/events` via Graph SDK or fetch helper. Mirror the shape of `lib/integrations/google/calendar.ts`'s create function for consistency.
- `patchMsEvent({ userId, eventId, patch })` — PATCH `/me/events/{eventId}`
- `deleteMsEvent({ userId, eventId })` — DELETE `/me/events/{eventId}`

The MS Graph event shape (`subject`, `body`, `start: { dateTime, timeZone }`, `end`, `location`, `attendees`, etc.) differs from Google's — translate from Steadii's internal `events` table shape (`title`, `description`, `startsAt`, `endsAt`, `isAllDay`, etc.) to the MS Graph shape inside the helper, mirror the existing Google translation pattern.

After creating, mirror the result into the `events` table via `upsertFromSourceRow` (already used by Google + iCal paths) with `sourceType: 'microsoft_graph'` — this keeps multi-source merge working in `/app/calendar`.

## Fix 3 — Add MS Tasks write functions

`lib/integrations/microsoft/tasks.ts` currently exports only `fetchMsUpcomingTasks`. Add:

- `createMsTask({ userId, listId?, ... })` — POST `/me/todo/lists/{listId}/tasks`. If `listId` not specified, use the default task list (Graph: `/me/todo/lists` then pick `wellknownListName: "defaultList"`).
- `patchMsTask({ userId, listId, taskId, patch })` — PATCH `/me/todo/lists/{listId}/tasks/{taskId}` — for marking complete, updating due date, etc.

The MS To Do task shape (`title`, `body`, `dueDateTime: { dateTime, timeZone }`, `status: "notStarted" | "inProgress" | "completed"`, `importance`) — translate from Steadii's internal `tasks` table shape.

## Fix 4 — Wire MS into agent tools

`lib/agent/tools/calendar.ts` and `lib/agent/tools/tasks.ts` currently dispatch writes to Google. Extend so they ALSO target MS for users who have MS connected.

Two design options:

**Option A — Single tool, multi-source dispatch**: keep the existing `calendar_create_event` / `tasks_create` tool names. Inside execute, detect which integrations the user has connected (`accounts` table by provider). If both Google + MS, write to both. If only Google, write to Google. If only MS, write to MS.

**Option B — Per-source tools**: introduce `calendar_create_event_google` / `calendar_create_event_microsoft` (and similar for tasks). The agent picks one based on system prompt rule.

**Recommended: Option A**. Reasons:
- Hides routing complexity from the model — fewer tools, simpler prompt
- Bidirectional-sync principle says "user's data is in both places"; default to writing both
- Power users with multi-account setups (rare at α) can split via chat instructions if needed; meanwhile defaults to dual-write

Default behavior: write to ALL connected integrations. Add a system prompt note (`lib/agent/prompts/main.ts`) clarifying: "When the user asks to add a calendar event or task, the agent writes to all connected integrations by default. If the user specifies a target ('add this to my Google Calendar specifically'), respect the request."

Failure semantics: if writing to one source succeeds and another fails, surface a warning in the assistant's response ("Added to Google Calendar; failed on Outlook — try again or check Settings → Connections"). Don't silently swallow.

## Fix 5 — Wire MS into syllabus auto-import

`lib/agent/proactive/syllabus-import.ts:196` (`createAndMirror`) currently creates events on Google Calendar via `getCalendarForUser`. Extend so MS-connected users also get the events written to MS Calendar.

The dedup logic upstream (`matchToCalendar`) needs to consider events from BOTH `google_calendar` and `microsoft_graph` sources when deciding if an event is "already there" — the existing query at line 128-141 only filters `sourceType: 'google_calendar'`. Widen to include `microsoft_graph` so a syllabus event that's already on the user's MS calendar (via an earlier sync) doesn't get double-added.

## Tests

Mirror the existing Google integration tests where possible. Targeted:

- `tests/microsoft-calendar.test.ts` — assert `createMsEvent` POSTs the correct shape, returns the parsed Graph response
- `tests/microsoft-tasks.test.ts` — same for `createMsTask`
- `tests/agent-tools-multi-source-write.test.ts` — assert that when both Google + MS are connected, `calendar_create_event` writes to both; when only Google, writes only to Google; failures on one source are surfaced

If full integration testing infrastructure isn't in place for MS, scope a minimum harness (mock the Graph fetch). Don't block this PR on a perfect harness.

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred — `project_ms_graph_scope.md` was just updated to reflect ReadWrite + bidirectional-sync principle
- Mail.Read scope stays out (school-tenant admin-consent constraint per the same memory file)
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Notion stays one-way per `project_decisions.md` architecture pivot — do NOT touch Notion sync paths in this PR

## Verification plan

After implementing all 5 fixes:

1. `pnpm typecheck` — clean
2. `pnpm test` — green
3. Manual smoke (after Ryuto's Azure scope update + re-consent):
   - User with both Google + MS connected, asks via chat: "add a meeting tomorrow at 10am to my calendar" → event appears in BOTH `/app/calendar` (Steadii mirror) AND in MS Calendar AND in Google Calendar (verify via the actual Google + MS web UIs)
   - User uploads a syllabus PDF → events appear in BOTH Google Calendar AND MS Calendar with `[Steadii]` prefix
   - User with only MS connected (Google revoked) → write goes only to MS
   - Patch / delete flow: edit one of the events via chat → reflected in both upstreams

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_ms_graph_scope.md` — already updated by sparring (ReadWrite + bidirectional-sync principle). Verify the updated file matches what shipped; if any deviation, note it.
- `project_steadii.md` W-Integrations bullet "Verification status": once shipped, this PR closes the "MS scope + token refresh end-to-end" pending bullet partially (ReadWrite path now testable end-to-end — Ryuto manual verification still needed for the actual round trip).

Plus standard report bits.
