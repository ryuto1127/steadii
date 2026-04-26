# Polish-2 — Fix study-session count to academic tool calls only

Small follow-up PR. ~30 minutes.

---

## The bug

The Home dashboard "Study sessions" card on `/app` shows a number
sourced from `weekSummary.counts.chats` (`app/app/page.tsx:127`).
The current definition in
`lib/agent/tools/summarize-week.ts:countChatsThisWeek()` counts
chats where ANY tool was called in the last 7 days:

```typescript
or(isNotNull(messages.toolCalls), eq(messages.role, "tool"))
```

This catches utility tool calls too (`gmail_*`, `calendar_*`,
`tasks_*`), so chats that are about email triage or "create a
calendar event" inflate the count and the user sees `5 study
sessions` for a week where they actually did zero studying.

Ryuto reported this from dogfood.

---

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -3
```

Expected most recent: `30e4789` (build fix) + `683863a` (polish PR
merge) + `d27465d` etc.

If main isn't at `30e4789` or later, **STOP**.

Branch: `polish-2-study-session`. Don't push without Ryuto's
explicit authorization.

---

## The fix

1. **Define the academic tool allowlist** as a module-level constant
   in `lib/agent/tools/summarize-week.ts`:

```typescript
// A chat counts as a "study session" only when the agent did work
// in an academic surface. Utility tool calls (Gmail triage, calendar
// CRUD, Google Tasks) inflate the metric without representing study
// activity, so they're excluded. Grow this list when new academic
// tools land — keep it explicit rather than blanket-including
// everything-but-utility, so a new utility tool added in the future
// doesn't silently start counting.
const ACADEMIC_TOOL_NAMES = [
  "summarize_week",
  "read_syllabus_full_text",
  "classroom_list_courses",
  "classroom_list_coursework",
  "classroom_list_announcements",
  // Notion is the canonical knowledge-management surface, treat any
  // notion_* invocation as academic activity for v1
  "notion_search_pages",
  "notion_get_page",
  "notion_create_page",
  "notion_update_page",
  "notion_delete_page",
  "notion_query_database",
  "notion_create_row",
  "notion_update_row",
] as const;
```

2. **Rewrite `countChatsThisWeek` to filter on those names**.
   `messages.tool_calls` is a JSONB array of OpenAI-style
   `{ id, type: "function", function: { name, arguments } }` rows.
   Use Postgres' `jsonb_path_exists` + a JSONPath that checks
   `function.name == any` against the allowlist.

   Drizzle doesn't have a first-class helper for `jsonb_path_exists`
   so write it as a `sql` template literal:

```typescript
import { sql } from "drizzle-orm";

const academicNamesArray = sql.raw(
  `array[${ACADEMIC_TOOL_NAMES.map(n => `'${n}'`).join(",")}]::text[]`
);

// inside countChatsThisWeek:
.where(
  and(
    eq(chats.userId, userId),
    isNull(chats.deletedAt),
    gte(messages.createdAt, since),
    sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(${messages.toolCalls}) AS tc
      WHERE tc->'function'->>'name' = ANY(${academicNamesArray})
    )`
  )
);
```

   Alternative if Drizzle's `sql` helper makes the array passing
   awkward: use `sql.placeholder` or a simpler IN-list constructed
   from the constant, whichever feels more idiomatic in this
   codebase.

   The `messages.role = "tool"` branch from the previous filter
   should be DROPPED — the `role: "tool"` rows correspond to tool
   results, not the call itself, so checking `tool_calls` on the
   assistant rows is the canonical path. (Confirm by glancing at
   how messages are written elsewhere; if `role: "tool"` rows are
   the only place name info lives in some legacy write path, keep
   a similar `WHERE messages.name = ANY(${academicNamesArray})`
   branch.)

3. **Update the comment block** above `countChatsThisWeek` to match
   the new semantics. The existing comment says "any tool call
   counts" which is now wrong.

4. **Add a unit test** at `tests/summarize-week-study-session.test.ts`
   (or extend an existing test file if one covers this function):

   Fixtures:
   - User has 3 chats in the last 7 days:
     - Chat A: 1 message with `tool_calls: [{ function: { name: "gmail.drafts.create" } }]`
     - Chat B: 1 message with `tool_calls: [{ function: { name: "summarize_week" } }]`
     - Chat C: 1 message with `tool_calls: [{ function: { name: "notion_search_pages" } }]`
   - Expected `countChatsThisWeek` returns `2` (Chat B + Chat C),
     NOT `3`. Chat A is excluded because `gmail.*` is utility.

   Edge cases to also cover:
   - A chat with NO tool calls at all → not counted
   - A chat with a mix of academic + utility tool calls in
     different messages → counted once
   - A chat with `role: "tool"` reply rows but NO assistant
     `tool_calls` originator (synthetic / impossible state, but
     test the SQL doesn't crash on it)

5. **Run the test suite**, verify pre-existing tests stay green.
   Pre-PR target: 461 (post-Phase-7-W1) + N (W-Notes additions, +27)
   + 3 (polish PR additions) = ~491 tests baseline. Net new from
   this PR: at least the ones above.

---

## Constraints

- Don't change the dashboard label or the `weekSummary.counts.chats`
  shape — only fix the underlying count
- Don't refactor `countAcademicEntities` or any other function in
  this file; keep the diff narrow
- The `ACADEMIC_TOOL_NAMES` constant should live in this file, not
  in a shared module — academic-vs-utility classification is a
  judgment call, and centralizing it might be premature. Inline
  + commented is fine for now
- No new dependencies; Postgres' built-in JSONB operators handle this
- Pre-commit hooks must pass; do not `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization

---

## When done

PR title suggestion: `fix(dashboard): study-session count excludes utility tool calls`

Report:
- PR URL + commit hash
- Test count before/after
- Spot-check confirmation: pull a sample dogfood account from local
  dev DB and run `countChatsThisWeek(ryutoUserId, weekAgo)` — does
  the count drop relative to the prior implementation?

That's it. The next work unit (Phase 7 W-Waitlist or DEPLOY.md
walk-through, depending on Ryuto's order) picks up from there.
