# Hotfix — syllabus chat upload flow (4 bugs + Notion-residual audit)

Four production bugs observed on `mysteadii.xyz` after a fresh syllabus
PDF upload from the main chat. All four cluster around the
`syllabus_extract` chat tool path that polish-10 (PR #68) and Phase 8
D10/D12 introduced; some of the wiring was implemented incompletely or
wasn't migrated when the Notion → Postgres pivot landed.

Bundle all four into a single PR. Add a separate read-only audit task
at the end (no fix in this PR) — list every other tool / call that still
talks to Notion API surfaces post-pivot, so we can scope a follow-up.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Most recent expected: `28dcee0 hotfix: dashboard card-enter stagger for
4 cards`. If main isn't at that or later, **STOP**.

Branch: `hotfix-syllabus-chat-flow`. Don't push without Ryuto's
explicit authorization.

## Repro (all 4 bugs)

1. Sign in to `mysteadii.xyz` (admin account is fine).
2. Open `/app` → fresh chat.
3. Attach a real university syllabus PDF (any term — Spring 2026
   Linear Algebra style works; the bug doesn't depend on the specific
   syllabus, but the schedule date format influences Bug 3).
4. Press Enter (no text body — polish-10 already supports
   attachment-only submit).
5. Observe:
   - Chat header stays "Untitled chat" forever (**Bug 1**)
   - Agent says "取り込みました。シラバス: <name>. スケジュール項目: N件"
     and surfaces a 「間違いノートに追加」 pill — but no row appears
     in `/app/classes` (**Bug 2**)
   - No `[Steadii] …` events appear in Google Calendar for any of the
     N extracted schedule items (**Bug 3**)
6. In the same chat, send a follow-up: "スケジュール項目全て教えて。"
7. Agent runs a `read_syllabus_full_text` tool which fails with
   "シラバス本体の全文取得に失敗しました" (**Bug 4**)

---

## Bug 1 — Chat title stays "Untitled chat"

### Root cause

Server emits the title via SSE at `app/api/chat/route.ts:135`:

```ts
const title = await generateChatTitle(userId, chatId, firstUser, fullText);
send({ type: "title", title });
```

But the client SSE event loop in `components/chat/chat-view.tsx:113-184`
handles `message_start`, `text_delta`, `tool_call_started`,
`tool_call_result`, `tool_call_pending`, `error` — **no `title`
branch**. The event is sent and silently dropped.

Verify whether `generateChatTitle()` already persists to the `chats`
row server-side (read `lib/agent/orchestrator.ts:430`-end). It almost
certainly does. The bug is purely client-side: the local header
component reads from initial server-rendered state and never updates
mid-stream.

### Fix

Add a handler in the SSE loop for `payload.type === "title"` that
updates the chat title state in place. Two acceptable approaches:

- **Local state** — store the chat title in component state next to
  `messages`; render the header from state; update on the SSE event.
  Initial value comes from the server-passed `chat.title`.
- **Router refresh** — call `router.refresh()` after the `done` event
  so the server component re-pulls the persisted title.

Pick local state — it's instant and avoids a round trip. The header
JSX at `chat-view.tsx:511` (`title={...}`) just needs to read from the
new state.

### Verify

- Fresh chat, send any message, watch header transition from
  "Untitled chat" → AI-generated title within ~2s of the assistant
  response finishing.
- Reload the page; title persists (proves server-side save works too).

---

## Bug 2 — Class entity NOT auto-created from syllabus upload

### Root cause

`lib/agent/tools/syllabus-extract.ts:141-158` calls
`saveSyllabusToPostgres({ classId: parsed.classId ?? null })`. When
the user uploads from the generic `/app` chat (no class context), the
LLM doesn't pass `classId`, so it lands as `null`. The syllabus row is
saved unattached, never appears in `/app/classes`, and downstream
`runSyllabusAutoImport()` falls back to `syl.title` for the calendar
event titles (no class context).

The polish-10 handoff (PR #68) explicitly said *"tool creates a new
one or asks"* (line 51 of `docs/handoffs/polish-10-chat-syllabus-ux.md`),
but the implementation skipped that branch. This is the spec drift
left behind from polish-10.

### Fix

Before the `saveSyllabusToPostgres` call, when `parsed.classId` is
nullish, run a class-resolution step:

1. Pull the user's existing classes (filter `userId` + `deletedAt is
   null`).
2. Try to match against `extracted.courseCode` or `extracted.courseName`
   (case-insensitive exact on `code`, then case-insensitive exact on
   `name`).
3. **If exact match → reuse that class id**.
4. **If no match → call `createClass()` from `lib/classes/save.ts:26`**
   with `{ name: extracted.courseName, code: extracted.courseCode,
   color: <next free color from the 8-color taxonomy> }`. Color
   selection: count user's existing classes, pick `colors[count %
   colors.length]` from the locked palette in
   `project_pre_launch_redesign.md` (blue / green / orange / purple /
   red / gray / brown / pink).
5. **If multiple matches (rare) → reuse the first; do not propose
   ambiguity in this PR**. Out of scope; if it surfaces in α, iterate.

Pass the resolved/created `classId` into `saveSyllabusToPostgres` so
the syllabus is attached and `runSyllabusAutoImport` gets `cls.code`
+ `cls.name` for cleaner calendar event titles.

Update the tool's return type to include `{ createdClass: boolean,
classId, className, classCode }` so the LLM can mention "新しい授業
を作成しました" in its response (transparency, glass-box principle).

### Verify

- Upload a syllabus for a course you don't have a class for → row
  appears in `/app/classes` with extracted name + code + a color from
  the palette.
- Re-upload the same syllabus → no duplicate class is created
  (matches existing).
- LLM response mentions the class was created (or matched, if
  re-upload).

---

## Bug 3 — Calendar events NOT auto-imported from syllabus

### Root cause (probable — needs first-pass investigation)

`runSyllabusAutoImport()` at `lib/agent/proactive/syllabus-import.ts:60`
iterates `syl.schedule[]` and calls `parseSimpleDate(item.date)`
(`lib/agent/proactive/syllabus-match.ts:74`). `parseSimpleDate` only
accepts three formats:

1. Anything `new Date(trimmed)` parses (ISO 8601, RFC 2822, etc.)
2. `MM/DD` or `MM-DD` (with optional `HH:MM`)
3. `M月D日` Japanese (with optional `HH:MM`)

Common syllabus date formats it does NOT handle:

- "Week 1: Jan 8"
- "Jan 13" (without year — actually parses via `new Date()` to current
  year, but unreliable)
- "Mon Jan 13" (parses depending on Node version)
- "1/8/2026" (parses as MM/DD ✓)
- "January 13, 2026" (parses ✓)
- "第1週" (does not parse)
- "TBD" (does not parse, correctly)

If `parseSimpleDate` returns `null` for every row, the loop skips all
items, `extracted.length === 0`, and the function returns
`{added:0, skippedConfidentMatch:0, ambiguousProposed:0, errors:0}`
silently — no calendar adds, no error, no log.

The repro screenshot showed "スケジュール項目: 7件" (so extraction
worked — schedule was saved), and zero calendar events appeared. That
is consistent with a parser miss across all 7 rows.

### Investigation step (do this first)

Reproduce the bug locally or against the dev DB. Print
`syl.schedule` for the failing syllabus row (e.g. add a temporary
`console.log` in `syllabus-import.ts:84` or query the DB directly):

```sql
SELECT schedule FROM syllabi WHERE id = '<id>';
```

Inspect the actual `date` field shape. Then pick the appropriate fix
(below).

### Fix — two layers, do both

**Layer 1 (preferred root fix): constrain the extraction prompt to
emit ISO 8601 dates.** Find the syllabus extract prompt (likely
`lib/syllabus/extract.ts` or a sibling). Add an explicit instruction:
"Format every `schedule[].date` as ISO 8601 (e.g. `2026-01-13` or
`2026-01-13T10:00:00`). If only a week number is given, infer the
calendar date from the term start. If the date is genuinely TBD, omit
the row." This makes downstream parsing trivially reliable.

**Layer 2 (defense in depth): widen `parseSimpleDate`.** Add support
for the common English forms `parseSimpleDate` currently misses:
"Jan 13", "January 13, 2026", "Mon Jan 13 2026". Use a small
allowlist of regexes; do NOT pull in `chrono-node` for α (one more
dep to vet). Skip "Week N" / "TBD" — those are correctly null.

### Verify

- Re-upload the same syllabus that failed before → all rows with
  parseable dates land in `/app/calendar` with `[Steadii]` prefix.
- Check the import result returned by `runSyllabusAutoImport`:
  `added > 0`, `errors == 0`.
- Re-upload the same syllabus → confident-match path fires for all
  previously-added events; `skippedConfidentMatch == added(prev)`.

---

## Bug 4 — `read_syllabus_full_text` is dead Notion code

### Root cause

`lib/agent/tools/syllabus.ts` is 100% Notion. It calls
`getNotionClientForUser()`, walks Notion blocks looking for a "Full
source content" toggle, and expects a `syllabusPageId` (Notion page
id). Post Notion → Postgres pivot, syllabi live in Postgres with a
`syllabi.fullText` column (`lib/db/schema.ts:1343`). The tool was
never updated, so it fails outright on every call (Notion isn't even
connected for new α users).

### Fix

Rewrite the tool to read from Postgres:

- Rename the parameter from `syllabusPageId` to `syllabusId` (Steadii
  uuid). Update the tool name parameter spec accordingly.
- Query `syllabi` for the row scoped to `userId` (security: the LLM
  cannot read another user's syllabus). Filter `deletedAt is null` if
  that column exists on `syllabi` (verify the schema).
- Return `fullText` from the column. Keep the `MAX_CHARS = 60_000`
  truncation; the Postgres column is unbounded text.
- Drop the `getClient` / `extractFullSourceToggleText` /
  `collectChildText` helpers — pure dead code after the rewrite.
- Drop the `getNotionClientForUser` import.

Update the tool description to drop any Notion-specific language.
Update the tool's system-prompt mention if it surfaces the Notion
framing anywhere (`grep -rn "syllabus_page_id\|syllabusPageId"
lib/agent/prompts/`).

### Verify

- Upload a syllabus, then ask "スケジュール項目全て教えて。" → tool runs,
  returns the full extracted text, agent answers from it.
- Try to call the tool with another user's `syllabusId` (forge in
  test) → tool returns `found: false` (no row matches).

---

## Audit task (read-only, no fix in this PR)

After fixing the 4 bugs above, run a read-only audit and append the
findings to this doc as a new section "Notion-residual audit
(YYYY-MM-DD)":

1. `grep -rn "getNotionClientForUser\|notion\.client\|@notionhq/client" lib/ app/ --include="*.ts" --include="*.tsx"`
2. For each hit, classify:
   - **Live** (intended post-pivot Notion path — import / export)
   - **Dead** (residual; should be Postgres but isn't)
   - **Unsure** (needs follow-up)
3. List file:line for each, with one-sentence verdict.

Do NOT fix anything found here in this PR — the scope explosion isn't
worth it. The audit output becomes input for a follow-up scoping
session.

---

## Verification plan

After implementing all four fixes:

1. `pnpm typecheck` — clean (only pre-existing test errors on main
   remain)
2. `pnpm test` — all green
3. Manual smoke (re-run the full repro from the top):
   - Upload syllabus → header title generates within ~2s
   - Class row appears in `/app/classes` with correct name + code
   - Calendar shows N `[Steadii]` events
   - Follow-up "スケジュール項目全て教えて。" succeeds, lists items
4. Re-upload same syllabus → no duplicate class, no duplicate
   calendar events (confident-match path)
5. Verify the `/app/syllabus` wizard upload path (the non-chat path)
   still works end-to-end — Phase 8 D10 must remain intact

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Phase 8 D10 (`runSyllabusAutoImport` flow) must stay intact —
  Bug 2/3 fixes are hooking *into* it, not replacing it

---

## Context files to read first

- `lib/agent/tools/syllabus-extract.ts` — Bug 2 main file
- `lib/agent/tools/syllabus.ts` — Bug 4 main file (full rewrite)
- `lib/agent/proactive/syllabus-import.ts` — Bug 3 (loop & guards)
- `lib/agent/proactive/syllabus-match.ts` — Bug 3 (parser)
- `lib/syllabus/extract.ts` — Bug 3 (extraction prompt — add ISO
  constraint)
- `lib/syllabus/save.ts` — verify auto-import is still triggered
- `lib/classes/save.ts` — Bug 2 (`createClass` helper to reuse)
- `app/api/chat/route.ts:120-150` — Bug 1 server side
- `components/chat/chat-view.tsx:100-190` — Bug 1 client SSE handler
- `lib/agent/orchestrator.ts:430` — `generateChatTitle` (verify it
  persists)
- `lib/db/schema.ts:1323-1360` — `syllabi` table shape
- `docs/handoffs/polish-10-chat-syllabus-ux.md` — original spec for
  the `syllabus_extract` tool (Bug 2 is its missed branch)
- `docs/handoffs/phase8-proactive-agent.md` — D10/D12 syllabus auto-
  import context
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/`
  — `project_steadii.md`, `project_decisions.md`,
  `project_pre_launch_redesign.md`, `project_agent_model.md`

---

## When done

Report back with:

- Branch name + final commit hashes (per-bug commits OK)
- Verification log (typecheck, tests, manual smoke for all 4 bugs +
  re-upload + wizard path)
- The "Notion-residual audit" section appended to this doc
- Any deviations from this brief + 1-line reason each
- Confirmation that Phase 8 D10 syllabus auto-import is still firing
  for the wizard path (not just the new chat path)

The next work unit is **W-Integrations** (Microsoft 365 + iCal +
Notion-import + Suggestion Subsystem) — these four fixes unblock the
"chat as the primary syllabus surface" story which W-Integrations
will lean on.

---

## Notion-residual audit (2026-04-28)

Read-only audit performed alongside this PR. Search command used:

```
grep -rn "getNotionClientForUser\|notion\.client\|@notionhq/client" \
  lib/ app/ --include="*.ts" --include="*.tsx"
```

Plus a follow-up grep on `notionClientFromToken` callers and
`from.*notion/{discovery,probe,ensure-setup,setup}` to find indirect
consumers of the deprecated modules.

### Verdict by file

| File:Line | Bucket | Notes |
|---|---|---|
| `lib/agent/tools/notion.ts:3,10` | **Live** | Agent CRUD on the user's Notion (search/get/create/update/delete pages, query/insert DB rows). Notion is the canonical KM surface per `project_steadii.md`; these tools are intentionally Notion-bound. |
| `lib/agent/tools/syllabus.ts` | **Dead → fixed in this PR** | Bug 4. Rewritten to read from Postgres `syllabi.fullText`. |
| `lib/integrations/notion/client.ts:2,8,24` | **Live (helper)** | `getNotionClientForUser` / `notionClientFromToken` — foundational client factories used by every Notion path. |
| `lib/integrations/notion/import-to-postgres.ts:11,12,68` | **Live** | Settings → "Import from Notion". Direction is Notion → Postgres, which is correct post-pivot. |
| `lib/integrations/notion/data-source.ts:2` | **Live (helper)** | `resolveDataSourceId` — required by `import-to-postgres` for Notion SDK 2025-09-03 (databases → data sources). |
| `lib/integrations/notion/discovery.ts:17,18,61` | **Live (auxiliary)** | `@deprecated` self-marker, but still called from the Notion OAuth callback (`app/api/integrations/notion/callback/route.ts`) and onboarding actions (`app/(auth)/onboarding/actions.ts`). Not on the academic hot path. |
| `lib/integrations/notion/ensure-setup.ts:20,30,56` | **Live (auxiliary)** | `@deprecated`; only Settings → "Re-run setup" calls it. Auxiliary. |
| `lib/integrations/notion/setup.ts:12` | **Live (auxiliary)** | `@deprecated`; rollback safety + future "export to Notion" ship. Used transitively by `ensure-setup.ts`. |
| `lib/integrations/notion/probe.ts:9` | **Dead** | `databaseStillExists` was the health probe behind `lib/views/notion-health.ts`. That view is itself `@deprecated` with "no live consumers", and the probe has no other callers outside its own test. |
| `lib/views/notion-health.ts:12,13,37` | **Dead** | `@deprecated` self-marker says "No live consumers; kept for rollback safety only." Confirmed: only `tests/notion-health.test.ts` imports it. |
| `lib/views/notion-list.ts:12,34` | **Dead** | `@deprecated` self-marker says "No live consumers." Confirmed: only `tests/notion-list*.test.ts`-style imports remain. |

### Summary

- **Dead (3):** `lib/integrations/notion/probe.ts`, `lib/views/notion-health.ts`, `lib/views/notion-list.ts`. All three are explicitly marked `@deprecated` with "no live consumers" comments and only test-file imports. Safe to delete in a follow-up cleanup PR.
- **Live (rest):** client + data-source are foundational helpers; agent `notion.ts` is the user-facing Notion-as-KM surface; `import-to-postgres` is the Settings → Import path; `discovery` / `ensure-setup` / `setup` are auxiliary OAuth/onboarding/rollback paths that still have live entry points (OAuth callback, Settings re-run).
- **Unsure (0):** No ambiguous cases. The `@deprecated` markers in the codebase are accurate.

### Suggested follow-up scope (not done in this PR)

A small post-α cleanup PR can:
1. Delete `lib/integrations/notion/probe.ts` + `lib/views/notion-health.ts` + `lib/views/notion-list.ts` (and their tests).
2. Audit the OAuth onboarding path to see whether `discovery.ts` / `ensure-setup.ts` are still needed once Notion-import is the only Notion-side feature, or whether their live entry points can be retired too.

