# Phase 7 Pre-W1 Scoping — Notion → Postgres migration

Read-only investigation pass. No application code or schema was changed by
this pass. References below are to current working-tree files
(commit `c5720ff` at investigation time).

The premise is the Architecture revision dated 2026-04-25 in
`memory/project_decisions.md`: **Postgres (Neon) is canonical for all four
academic entities**; Notion becomes optional, one-way (import at
onboarding, export post-α). Two-way `dual_property` sync, 60s discovery
cache, parent auto-discovery, and workspace-root fallback are deprecated
but not deleted (kept for rollback during α).

---

## 1. Executive summary

- **Notion is currently canonical for Classes, Mistake Notes, Assignments,
  and Syllabi.** There is no Postgres mirror of any of these entities.
  Every list view, every save, every chat-context build hits the Notion
  API live ([lib/classes/loader.ts:24-134](lib/classes/loader.ts:24),
  [lib/mistakes/save.ts:28-150](lib/mistakes/save.ts:28),
  [lib/syllabus/save.ts:27-109](lib/syllabus/save.ts:27),
  [lib/views/notion-list.ts:15-51](lib/views/notion-list.ts:15)).
  A migration is therefore *additive on the Postgres side* (four new
  tables) and *gradually subtractive on the Notion side* (deprecate
  read/write call paths; keep the OAuth + import shape).
- **Notion is already de-facto optional from the auth gate's perspective.**
  [lib/onboarding/is-complete.ts:11-13](lib/onboarding/is-complete.ts:11)
  returns `gmailConnected && calendarConnected` only. The 4-step onboarding
  UI ([app/(auth)/onboarding/page.tsx:23-179](app/(auth)/onboarding/page.tsx:23))
  still walks every user through Notion-connect / setup / resources, but
  every step has a `Skip for now` form action that completes onboarding.
  The Architecture revision merely needs the *UI* to catch up — the gating
  logic is already correct.
- **The two Notion-mirror tables are `notion_connections` (per-user
  workspace + DB ids + encrypted token) and `registered_resources`
  (mirror of discovered pages/databases under the Steadii parent).**
  Both are defined in [lib/db/schema.ts:181-225](lib/db/schema.ts:181).
  They are referenced by 5 API call paths and 1 cache module
  ([lib/integrations/notion/discovery.ts](lib/integrations/notion/discovery.ts)).
  Neither table needs to be deleted in the cutover — both stay (the
  connection row is reused for one-way import; `registered_resources` is
  still useful as a record of "which Notion pages did we ever
  auto-register" if export ships post-α).
- **`dual_property` two-way Notion relations live in one place.**
  [lib/integrations/notion/setup.ts:82-94](lib/integrations/notion/setup.ts:82)
  declares relations on Mistake Notes / Assignments / Syllabi pointing to
  the Classes data source. After migration, `setup.ts` becomes
  import-only-helper code; `runNotionSetup` and the dedup machinery
  (`scoreSteadiiCandidates`, `decideSteadiiWinner`, parent fallback in
  `createSteadiiParent`) are no longer called from the live request path.
  None of it needs to be deleted — keep it under
  `lib/integrations/notion/` for the rollback-safety period.
- **There is no rich-text editor in the codebase yet.** The only text
  rendering library imported is `react-markdown` (+ remark-math /
  rehype-katex) in [components/chat/markdown-message.tsx](components/chat/markdown-message.tsx)
  for chat output. No TipTap, no ProseMirror, no Slate, no Lexical.
  Mistake Notes' current creation surface is a dialog with fixed fields
  ([components/chat/mistake-note-dialog.tsx](components/chat/mistake-note-dialog.tsx))
  — title, class, unit, difficulty, tags — and the *body* is computed
  server-side from the chat turn that triggered the save
  ([lib/mistakes/save.ts:152-218](lib/mistakes/save.ts:152)). The Phase 7
  Mistakes-tab editor is therefore green-field: a real product decision
  (markdown vs TipTap JSON), not a refactor. Flagged in §8 question 1.
- **Phase 7 W1 fanout (Syllabus / Mistakes / Classroom / Calendar
  retrieval at L2 classify/draft time) is the moat surface.** Today
  Mistakes + Syllabi can only be read via Notion API, which is rate-limited
  to 3 req/s and 200–800ms/call ([memory rationale point 2](memory/project_decisions.md)).
  The `summarize-week` tool already swallows Notion partial failures
  ([lib/agent/tools/summarize-week.ts:88-142](lib/agent/tools/summarize-week.ts:88))
  to keep the home page rendering, which is exactly the pattern that
  *can't* survive multi-source fanout under load. Postgres at <10ms is
  the only path that makes the W1 fanout shippable.
- **The chat orchestrator runs `discoverResources()` on every send.**
  [lib/agent/orchestrator.ts:69](lib/agent/orchestrator.ts:69) calls into
  the 60s-cache + Notion API path before building user context. After
  migration this becomes a no-op for users without Notion (which is
  every α user except Ryuto), but the call itself is wasted overhead.
  Remove from the orchestrator hot path; trigger only at import time and
  on a manual Settings → "Re-import from Notion" button.
- **No Notion-touching cron / background jobs exist.** `app/api/cron/`
  has `digest`, `ingest-sweep`, `send-queue` — none of them import from
  `lib/integrations/notion/`. Migration does not need to coordinate with
  the QStash cron contract.
- **Migration target: ~1.5 weeks (memory)** maps to roughly 9–11
  engineer-days in the §7 breakdown. Largest line item is the Mistake
  Notes editor (rich-content surface, net-new UX). Smallest is the
  onboarding sequence rewrite (the gating logic already lines up).
- **Conflicts with `project_decisions.md` Architecture revision: none
  found.** The decision document accurately matches the current code
  state. The current code is *not* yet Postgres-canonical (this pass is
  the prerequisite to making it so), but nothing in the code contradicts
  the decision to make it so.

---

## 2. Inventory of current Notion touch points

### 2.1 Drizzle schema — Notion-mirror tables

Two tables, both in [lib/db/schema.ts](lib/db/schema.ts):

| Table | Purpose | Phase 7 fate |
|-------|---------|--------------|
| `notion_connections` ([schema.ts:181-208](lib/db/schema.ts:181)) | Per-user workspace metadata: workspace id/name/icon, bot id, encrypted access token, parent page id, the four DB ids (`classes_db_id`, `mistakes_db_id`, `assignments_db_id`, `syllabi_db_id`), `setup_completed_at`. | **Keep.** Repurposed: still records the user's connected workspace; `*_db_id` columns become "where to import from" markers, no longer "where the canonical data lives". |
| `registered_resources` ([schema.ts:210-225](lib/db/schema.ts:210)) | Mirror of pages/databases the agent is allowed to read. Auto-populated by `discoverResources()`; also accepts manual entries from Settings. | **Keep, deprecate writes.** Reads from chat context still useful while Notion remains a connectable surface (e.g. agent can quote "your Notion page X says ..."), but no new entries are inserted automatically once discovery is removed from the orchestrator. |

Both tables stay through α for rollback safety. Neither is referenced by
the four new Postgres-canonical tables proposed in §3, so a future
deletion (post-α) is a self-contained migration.

### 2.2 Library modules under `lib/integrations/notion/` (8 files, 1101 lines)

| File | Lines | Role | Phase 7 fate |
|------|-------|------|--------------|
| `client.ts` | 26 | `getNotionClientForUser(userId)` — decrypts the stored token and returns a `Client` + `connection` row. The single chokepoint every other module passes through. | **Keep.** Used by the import-only path. |
| `data-source.ts` | 45 | SDK v5 helper: resolves a database id to its first data-source id, with an in-memory cache. | **Keep** (still needed by import + by deprecated tools in `lib/agent/tools/notion.ts`). |
| `discovery.ts` | 145 | `discoverResources(userId)` — walks children under the stored parent page, inserts new `registered_resources`, archives missing ones. Has a 60s in-memory cache keyed by userId. | **Deprecate.** Stop calling from `orchestrator.ts:69`. Keep the function for the import script + a manual Settings "Re-import" button. |
| `ensure-setup.ts` | 284 | `ensureNotionSetup(userId)` — re-creates the four DBs if the parent page is missing or DBs were deleted in Notion. Includes the `decideSteadiiWinner` dedup choreography. | **Deprecate, keep file.** Only called from import + Settings → "Repair" path. Live request paths drop the dependency. |
| `id.ts` | 10 | Pure: `parseNotionId(url)`. | **Keep.** Still used by Settings "add resource" form. |
| `oauth.ts` | 50 | `buildNotionAuthorizeUrl` + `exchangeNotionCode`. | **Keep.** OAuth surface is unchanged for the optional connect path. |
| `probe.ts` | 45 | `databaseStillExists(client, dbId)` — health probe. | **Deprecate.** Used today by `notion-health.ts` to gate live views; once views go Postgres-native there is no `dead-DB` UX. |
| `setup.ts` | 496 | `runNotionSetup` — creates the parent page + the four DBs with `dual_property` relations, plus the dedup helpers (`scoreSteadiiCandidates`, `decideSteadiiWinner`). The `dual_property` declaration lives at lines 82-94. | **Deprecate, keep file.** Not called from the live path post-cutover. Future post-α export ships will need the inverse (write rows into existing user DBs, not create them) — refactor at that point, not now. |

Plus two view helpers under `lib/views/`:

| File | Role | Phase 7 fate |
|------|------|--------------|
| `notion-list.ts` (99 lines) | `listFromDatabase({ databaseSelector })` + `getTitle/getRichText/getSelect/getDate/...` extractors used by `/app/classes/[id]`. | **Replace.** Postgres-native equivalents return typed rows, not Notion property bags. Delete the file after the consumer ([app/app/classes/[id]/page.tsx](app/app/classes/[id]/page.tsx)) has migrated. |
| `notion-health.ts` (41 lines) | `checkDatabaseHealth({ databaseSelector })` — used by `/app/syllabus/new` to render `DeadDbBanner` if the Notion DB was deleted. | **Delete (after consumers migrate).** No analogous failure mode for a Postgres table. |

### 2.3 Application call sites that read or write Notion

Production read paths:

- [lib/classes/loader.ts:24-182](lib/classes/loader.ts:24) — `loadClasses(userId)` and `loadClassById(userId, id)` query Classes (and enrich with Assignments + Mistakes counts). 1–4 Notion round-trips per page render.
- [lib/dashboard/today.ts:82-128](lib/dashboard/today.ts:82) — `getDueSoonAssignments(userId)` queries Assignments by `Due` filter. Hit on every Home Dashboard load.
- [lib/agent/tools/summarize-week.ts:88-142](lib/agent/tools/summarize-week.ts:88) — `countNotion()` queries Mistakes + Syllabi for the past-week summary card. 6h cache softens the hit but every cache miss is two Notion queries.
- [lib/agent/context.ts:13-54](lib/agent/context.ts:13) — `buildUserContext(userId)` reads `notion_connections` + `registered_resources` to surface DB ids and registered pages in the chat agent system prompt.
- [lib/agent/serialize-context.ts:90-105](lib/agent/serialize-context.ts:90) — emits `Notion connected: yes/no`, the four DB ids, and the registered-resource list into the prompt.
- [app/app/classes/[id]/page.tsx:109-263](app/app/classes/[id]/page.tsx:109) — the Syllabus / Assignments / Mistakes tabs each call `listFromDatabase` then filter by `Class` relation client-side. Three Notion queries per render of the class detail page (one per tab in parallel would help; today they fire sequentially per tab visit).
- [app/app/syllabus/new/page.tsx:15-69](app/app/syllabus/new/page.tsx:15) — server component reads Classes from Notion to populate the wizard's class picker, plus `checkDatabaseHealth` on syllabi DB.
- [app/api/classes/route.ts](app/api/classes/route.ts) — JSON endpoint backing `mistake-note-dialog.tsx`'s class picker, reads Classes from Notion.

Production write paths:

- [lib/mistakes/save.ts:28-150](lib/mistakes/save.ts:28) — `saveMistakeNote()` creates a Notion page in the Mistake Notes DB (with multi-block body, image files, optional Class relation), inserts a `registered_resources` row, and writes an `audit_log` entry tagged `mistake.save` with `resourceType: "notion_page"`.
- [lib/syllabus/save.ts:27-109](lib/syllabus/save.ts:27) — `saveSyllabusToNotion()` creates a Notion page in the Syllabi DB with a "Full source content" toggle that preserves verbatim text + (optionally) the original PDF as an external file block, plus image bookmark, schedule bullet list, etc.
- [lib/agent/tools/notion.ts:42-489](lib/agent/tools/notion.ts:42) — eight tools registered to `NOTION_TOOLS` and exposed to the chat agent: `notion_search_pages`, `notion_get_page`, `notion_create_page`, `notion_update_page`, `notion_delete_page`, `notion_query_database`, `notion_create_row`, `notion_update_row`. Currently the chat agent's primary mechanism for adding/updating assignments by name.
- [lib/agent/tools/syllabus.ts:18-52](lib/agent/tools/syllabus.ts:18) — the `read_syllabus_full_text` tool reads the verbatim toggle from a syllabus page so the agent can quote exact wording when answering "what does the grading rubric say".
- [app/(auth)/onboarding/actions.ts:21-101](app/(auth)/onboarding/actions.ts:21) — server actions for the onboarding flow: `runSetupAction`, `repairSetupAction`, `refreshResourcesAction`, `disconnectNotionAction`, `addResourceAction`.
- [app/api/integrations/notion/connect/route.ts](app/api/integrations/notion/connect/route.ts) + `callback/route.ts` — OAuth flow.
- [app/api/syllabus/save/route.ts](app/api/syllabus/save/route.ts) — POST endpoint backing the syllabus wizard, calls `saveSyllabusToNotion`.

Every write path also writes an `audit_log` row tagged `notion_page` /
`notion_database` / `notion_workspace` resourceType. The audit entries
themselves don't need migration — the resourceType strings stay as
historical labels.

### 2.4 UI components rendering Notion-backed data

| Component | File | Notion dependency |
|-----------|------|-------------------|
| Classes list | [app/app/classes/page.tsx](app/app/classes/page.tsx) (via `loadClasses`) | Reads Classes + Assignments + Mistakes from Notion. |
| Class detail tabs | [app/app/classes/[id]/page.tsx](app/app/classes/[id]/page.tsx) | All four tabs fetch from `listFromDatabase`. The Chats tab is *not* Notion-backed (it queries the Postgres `chats` + `messages` tables). |
| Home → "Due soon" card | [app/app/page.tsx:160-167](app/app/page.tsx:160) (via `getDueSoonAssignments`) | Reads Assignments. |
| Home → "Past week" card | [app/app/page.tsx:166-176](app/app/page.tsx:166) (via `computeWeekSummary`) | Reads Mistakes + Syllabi. |
| Onboarding step 2 — Notion connect panel | [components/onboarding/notion-connect-panel.tsx](components/onboarding/notion-connect-panel.tsx) (56 lines) | Renders the "Connect Notion" CTA. |
| Onboarding step 3 — setup checklist | [components/onboarding/setup-checklist.tsx](components/onboarding/setup-checklist.tsx) | Visual progress bar for the four-DB creation. |
| Onboarding step 4 — register resources | inline in [page.tsx:148-179](app/(auth)/onboarding/page.tsx:148) | Skip-or-link-to-settings prompt. |
| Mistakes save dialog | [components/chat/mistake-note-dialog.tsx](components/chat/mistake-note-dialog.tsx) | Class picker hits `/api/classes` (Notion). Save button copy: "Save to Notion" ([line 154](components/chat/mistake-note-dialog.tsx:154)). |
| Syllabus wizard | [components/syllabus/syllabus-wizard.tsx](components/syllabus/syllabus-wizard.tsx) (282 lines) | Class picker takes Notion-id strings; final save POSTs to `/api/syllabus/save` which goes to Notion. UI copy "We'll save to Notion." |
| Dead-DB banner | [components/views/dead-db-banner.tsx](components/views/dead-db-banner.tsx) | Shown when a Notion DB has been deleted under the user. |
| Tool-call card | [components/chat/tool-call-card.tsx](components/chat/tool-call-card.tsx) | Pretty-prints `notion_*` tool invocations in the chat transcript. |
| Settings → Connections | [app/app/settings/page.tsx:133-162](app/app/settings/page.tsx:133), [app/app/settings/connections/page.tsx](app/app/settings/connections/page.tsx) | "Connected to <workspace>" + Re-run setup / Re-connect / Disconnect buttons. |
| Settings → Resources | [app/app/settings/page.tsx:214-268](app/app/settings/page.tsx:214) | "Notion pages the agent can read" — manual add via URL, list via `registered_resources`, refresh button calls `discoverResources`. |
| Marketing privacy / terms | [app/(marketing)/privacy/page.tsx](app/(marketing)/privacy/page.tsx), [app/(marketing)/terms/page.tsx](app/(marketing)/terms/page.tsx) | Mention Notion as a data store and processor. |
| i18n strings | [lib/i18n/translations/en.ts](lib/i18n/translations/en.ts), [`ja.ts`](lib/i18n/translations/ja.ts) | `save_to_notion` key, "Mistakes, syllabi, and assignments live in your own Notion" hero copy, and similar. |

### 2.5 Sync / discovery / cache code paths to deprecate

Listed for explicit reference:

- **`dual_property` two-way sync** declaration: [setup.ts:82-94](lib/integrations/notion/setup.ts:82) (`classRelation()`). Drops out automatically when `runNotionSetup` is no longer called from a live path.
- **60-second discovery cache**: [discovery.ts:15-37](lib/integrations/notion/discovery.ts:15). Module-level `Map`. Removed when `discoverResources` is no longer in the orchestrator hot path.
- **Workspace-root fallback** when `parent: workspace` page creation fails: [setup.ts:461-496](lib/integrations/notion/setup.ts:461). Deprecated with the rest of `setup.ts`.
- **Steadii-parent auto-discovery / dedup**: [setup.ts:287-460](lib/integrations/notion/setup.ts:287). `findExistingSteadiiPages` + `scoreSteadiiCandidates` + `decideSteadiiWinner`. Deprecated; kept for the import script's "find an existing workspace under this user" probe.
- **Stale-DB recovery**: [ensure-setup.ts:48-99](lib/integrations/notion/ensure-setup.ts:48) — if the stored `classes_db_id` no longer exists in Notion, re-run setup. Deprecated. The maintenance script `scripts/fix-stale-notion-setup.ts` (which uses the same probe) becomes obsolete; mark deprecated, do not delete pre-α.

### 2.6 Cron / background jobs touching Notion

**None.** `app/api/cron/digest`, `app/api/cron/ingest-sweep`, and
`app/api/cron/send-queue` are all Gmail / digest infrastructure with no
imports from `lib/integrations/notion/`. The QStash signature contract
([AGENTS.md](AGENTS.md)) is unchanged by this migration.

### 2.7 Onboarding flow tied to Notion OAuth + 4-DB creation

Current sequence in [app/(auth)/onboarding/page.tsx](app/(auth)/onboarding/page.tsx):

1. **Step 1**: Connect Google (one consent grants Calendar + Gmail).
2. **Step 2**: Connect Notion (optional — has a `Skip for now` form action;
   copy already says "Skip if you don't use Notion").
3. **Step 3**: Setup running — creates parent page + four DBs.
4. **Step 4**: Register existing resources — also has a `Skip for now`
   action.

Gating logic at
[lib/onboarding/is-complete.ts:11-13](lib/onboarding/is-complete.ts:11)
already requires only `gmailConnected && calendarConnected`. Notion is
*not* in the gate. The 4-step UI is therefore showing skip-able steps
that no longer have functional weight; the simplification per Architecture
revision is a UI-only change.

Step-derivation logic in
[lib/onboarding/progress.ts](lib/onboarding/progress.ts) (and `actions.ts`'s
`skipNotionAction` setting `onboarding_step = 4`) supports the skip path
end-to-end. The first-24h Gmail ingest hook
([actions.ts:128-142](app/(auth)/onboarding/actions.ts:128)) fires on
both `skipNotionAction` and `finishOnboardingAction`, so Inbox population
is independent of which Notion path the user took.

### 2.8 Schema-level summary of what's at stake

The Phase 6 inventory in `docs/handoffs/phase6-prew1-scoping.md §2.3`
already enumerated every existing table and noted which were
Phase 6-relevant. The Phase 7 add layer is small — four new tables, one
embedding table — and all forward-only. No existing Phase 6 tables
(`inbox_items`, `agent_rules`, `agent_drafts`, `email_embeddings`,
`send_queue`) need touching.

---

## 3. Proposed Postgres-native data model

Convention follows the existing schema:
- snake_case column names; Drizzle auto-maps to camelCase TS.
- UUID PKs via `uuid().defaultRandom()`.
- `created_at` / `updated_at` on every table; `deleted_at` (soft-delete)
  on user-facing tables.
- FK from every table to `users(id)` with `onDelete: cascade`.
- Partial indexes use `WHERE deleted_at IS NULL` to keep the hot path
  small (matches `inbox_items`).
- `withTimezone: true` on every timestamp (matches the post-Phase 6
  convention from `inbox_items` / `agent_drafts`).
- pgvector is already enabled (migration `0014_enable_pgvector.sql`); the
  `vector` customType helper at [schema.ts:23-38](lib/db/schema.ts:23)
  is reusable.

### 3.1 `classes`

```sql
CREATE TABLE classes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  name            TEXT NOT NULL,                  -- "Linear Algebra II"
  code            TEXT,                           -- "MAT244"
  term            TEXT,                           -- "Fall 2026" / free-text for now; see §8.5
  professor       TEXT,
  color           TEXT,                           -- ClassColor enum (blue|green|orange|purple|red|gray|brown|pink)
  status          TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'

  -- Forward-compat: link back to the source row in notion_connections
  -- when this class was imported. Null for natively-created rows.
  notion_page_id  TEXT,                           -- Notion page id from the import; nullable for native rows

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX classes_user_status_idx
  ON classes (user_id, status)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX classes_user_notion_page_idx
  ON classes (user_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

Notes:
- `notion_page_id` makes re-runs of the import script idempotent
  (`ON CONFLICT (user_id, notion_page_id) DO UPDATE`).
- `term` is intentionally free text in v1 to match the current Notion
  select options (`Fall 2026`, `Winter 2027`, …). Promoting to a
  `terms` lookup table is post-α work, listed in §8.
- `color` mirrors the existing `ClassColor` union (already imported from
  [components/ui/class-color.tsx](components/ui/class-color.tsx) and
  used by `ClassRow.color`).

### 3.2 `mistake_notes`

The single most-decision-laden table of the four — see §8 question 1
for the markdown-vs-TipTap-JSON open question.

```sql
CREATE TABLE mistake_notes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id        UUID REFERENCES classes(id) ON DELETE SET NULL,

  title           TEXT NOT NULL,                  -- "2D projectile with wind"
  unit            TEXT,                           -- "Kinematics"
  difficulty      TEXT,                           -- 'easy' | 'medium' | 'hard'
  tags            TEXT[] NOT NULL DEFAULT '{}',

  -- The body. PRODUCT DECISION OPEN — see §8.1.
  -- Recommendation (A): markdown text; renders via existing react-markdown
  -- pipeline. Editor: a textarea with simple toolbar (bold/italic/list/
  -- code/math) — no new dependency.
  -- Alternative (B): jsonb TipTap doc. Adds @tiptap/* deps but unblocks
  -- structured editing (mention nodes, embedded image blocks, math nodes
  -- as first-class).
  body_format     TEXT NOT NULL DEFAULT 'markdown',  -- 'markdown' | 'tiptap_json'
  body_markdown   TEXT,                              -- populated when body_format='markdown'
  body_doc        JSONB,                             -- populated when body_format='tiptap_json'

  -- Snapshots from chat creation (preserves the "Save to Notes" provenance
  -- the current Notion body builds — user_question + assistant_explanation
  -- live as separate fields so future analytics can use them).
  source_chat_id           UUID REFERENCES chats(id) ON DELETE SET NULL,
  source_assistant_msg_id  UUID REFERENCES messages(id) ON DELETE SET NULL,
  source_user_question     TEXT,                     -- verbatim user message at save time
  source_explanation       TEXT,                     -- verbatim assistant message at save time

  notion_page_id  TEXT,                              -- import-source pointer

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

-- Image attachments — multi-row instead of a TEXT[] of URLs because
-- (a) blob_assets already FK from somewhere is the codebase pattern,
-- (b) we'll want per-image metadata (alt text, position) in the editor,
-- (c) ON DELETE cascade through blob_assets makes storage cleanup
-- automatic.
CREATE TABLE mistake_note_images (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mistake_id       UUID NOT NULL REFERENCES mistake_notes(id) ON DELETE CASCADE,
  blob_asset_id    UUID REFERENCES blob_assets(id) ON DELETE SET NULL,
  url              TEXT NOT NULL,                    -- denormalized for hot reads
  position         INTEGER NOT NULL DEFAULT 0,       -- ordering within body
  alt_text         TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mistake_note_images_mistake_idx
  ON mistake_note_images (mistake_id, position);

CREATE INDEX mistake_notes_user_class_idx
  ON mistake_notes (user_id, class_id)
  WHERE deleted_at IS NULL;
CREATE INDEX mistake_notes_user_created_idx
  ON mistake_notes (user_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX mistake_notes_user_tags_idx
  ON mistake_notes USING gin (tags);
CREATE UNIQUE INDEX mistake_notes_user_notion_page_idx
  ON mistake_notes (user_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

Notes:
- Both body columns coexist so the W1 implementation can ship markdown
  and a future flip to TipTap is a forward-only column-addition migration.
- `tags` GIN index supports the existing per-tag filter pattern (the
  `multi_select` column in the Notion schema).
- `source_*` fields exist so the chat-derived "what did the assistant
  say" is preserved verbatim (matches the brand-DNA verbatim-preservation
  decision from `project_decisions.md`).

### 3.3 `assignments`

```sql
CREATE TABLE assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id        UUID REFERENCES classes(id) ON DELETE SET NULL,

  title           TEXT NOT NULL,
  due_at          TIMESTAMPTZ,                    -- nullable: not all assignments have a due
  status          TEXT NOT NULL DEFAULT 'not_started',
                  -- 'not_started' | 'in_progress' | 'done'
  priority        TEXT,                           -- 'low' | 'medium' | 'high' | null
  notes           TEXT,                           -- free-text; markdown OK but no editor v1

  -- Provenance for de-dup against Classroom-sourced events.
  -- 'manual' | 'classroom' | 'chat'. When 'classroom', external_id
  -- matches an events row's external_id with kind='assignment' and
  -- source_type='google_classroom_coursework'.
  source          TEXT NOT NULL DEFAULT 'manual',
  external_id     TEXT,                           -- Classroom courseworkId when source='classroom'

  notion_page_id  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX assignments_user_due_idx
  ON assignments (user_id, due_at)
  WHERE deleted_at IS NULL AND status != 'done';
CREATE INDEX assignments_user_class_idx
  ON assignments (user_id, class_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX assignments_user_external_idx
  ON assignments (user_id, source, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX assignments_user_notion_page_idx
  ON assignments (user_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

Notes:
- The partial index on `(user_id, due_at) WHERE status != 'done'`
  is the exact shape `getDueSoonAssignments` needs.
- The `(user_id, source, external_id)` unique constraint lets a future
  Classroom→Postgres dedup job (post-α — `events` already stores
  Classroom assignments at [schema.ts:442-506](lib/db/schema.ts:442))
  upsert without double-rows. Phase 7 W1 fanout *reads* from both; the
  dedup is post-α.
- `notes` is plain TEXT not the markdown/TipTap dual-column shape
  because (a) the current Notion schema's `Notes` is `rich_text`,
  rendered as a flat paragraph; (b) there is no per-assignment editor
  surface today; (c) keeping it simple avoids the §8.1 question
  bleeding into a second table.

### 3.4 `syllabi`

```sql
CREATE TABLE syllabi (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id        UUID REFERENCES classes(id) ON DELETE SET NULL,

  title           TEXT NOT NULL,                  -- usually course name + term
  term            TEXT,
  grading         TEXT,
  attendance      TEXT,
  textbooks       TEXT,
  office_hours    TEXT,
  source_url      TEXT,
  source_kind     TEXT,                           -- 'pdf' | 'image' | 'url' (matches lib/syllabus/save.ts)

  -- The verbatim full text. Big — store inline since Postgres TOASTs
  -- automatically. Memory: brand-DNA preserves verbatim universally.
  full_text       TEXT,

  -- Schedule — array of { date, topic } captured at extraction time.
  schedule        JSONB,                          -- [{ date: string|null, topic: string|null }, ...]

  -- The original PDF / image, when uploaded. Existing pattern: blob_assets
  -- row id + url denormalized. blob_assets.source already supports 'syllabus'.
  blob_asset_id   UUID REFERENCES blob_assets(id) ON DELETE SET NULL,
  blob_url        TEXT,                           -- denorm of blob_assets.url for hot reads
  blob_filename   TEXT,
  blob_mime_type  TEXT,
  blob_size_bytes INTEGER,

  notion_page_id  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX syllabi_user_class_idx
  ON syllabi (user_id, class_id)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX syllabi_user_notion_page_idx
  ON syllabi (user_id, notion_page_id)
  WHERE notion_page_id IS NOT NULL;
```

Notes:
- `full_text` matches the existing `read_syllabus_full_text` tool's
  output shape, just sourced from a column instead of a Notion toggle
  block. The 60k-char truncation in
  [lib/agent/tools/syllabus.ts:43](lib/agent/tools/syllabus.ts:43)
  is preserved at the tool boundary, not the column.
- `schedule` as JSONB matches the wizard's `Syllabus.schedule` type
  ([components/syllabus/syllabus-wizard.tsx:7](components/syllabus/syllabus-wizard.tsx:7))
  and avoids a `syllabus_schedule_items` child table. Schedule rows
  are read together; not a hot enough path to normalize.
- Both `full_text` *and* `blob_*` are stored — see §8.2 for the open
  question on whether to keep the original PDF blob long-term once
  extracted text is the canonical retrieval surface.

### 3.5 Embedding / retrieval columns for Phase 7 W1 fanout

**Recommendation: pgvector, separate tables per entity, chunked.**

Rationale:
- pgvector is already in production (migration `0014`,
  `email_embeddings` at [schema.ts:806-829](lib/db/schema.ts:806)
  uses 1536-dim OpenAI `text-embedding-3-small`). Reusing the same
  model + dimension keeps the fanout query a single union with
  consistent similarity semantics.
- Chunking is necessary because syllabi and (future) handwritten OCR
  notes exceed the 8192-token embedding window. Mistakes are smaller
  but still benefit from per-section chunks (chunk = paragraph or
  H2-bounded section) so the W1 fanout can return *which part* of a
  long mistake is relevant rather than the whole row.
- Separate tables (vs one polymorphic `entity_chunks` table) because
  per-entity FKs `ON DELETE CASCADE` give us free GC, and per-table
  indexes have better selectivity than a polymorphic
  `(entity_type, entity_id)` index.

```sql
-- mistake_note_chunks
CREATE TABLE mistake_note_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mistake_id       UUID NOT NULL REFERENCES mistake_notes(id) ON DELETE CASCADE,
  chunk_index      INTEGER NOT NULL,
  chunk_text       TEXT NOT NULL,
  embedding        vector(1536) NOT NULL,
  model            TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  token_count      INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mistake_note_chunks_user_idx
  ON mistake_note_chunks (user_id);
CREATE UNIQUE INDEX mistake_note_chunks_mistake_chunk_idx
  ON mistake_note_chunks (mistake_id, chunk_index);

-- syllabus_chunks (analogous shape)
CREATE TABLE syllabus_chunks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  syllabus_id      UUID NOT NULL REFERENCES syllabi(id) ON DELETE CASCADE,
  chunk_index      INTEGER NOT NULL,
  chunk_text       TEXT NOT NULL,
  embedding        vector(1536) NOT NULL,
  model            TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  token_count      INTEGER NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX syllabus_chunks_user_idx
  ON syllabus_chunks (user_id);
CREATE UNIQUE INDEX syllabus_chunks_syllabus_chunk_idx
  ON syllabus_chunks (syllabus_id, chunk_index);
```

Index strategy:
- A `vector_l2_ops` IVFFlat / HNSW index can be added when α volume
  warrants — `email_embeddings` ships *without* a vector index today
  (sequential scan is fine for 10 users × <1k emails) and the same
  threshold applies here. **Defer the index until α data shows the
  scan cost.** Document the deferral, don't pre-optimize.
- Classes don't get a chunk table v1: they're tiny (one row of
  metadata). Their text fields can be embedded inline if needed for
  the W1 fanout, but ranking on five fields of class metadata is
  unlikely to add signal over the much-richer mistake / syllabus
  chunks. Surface as §8 question 7 if challenged.
- Assignments don't get a chunk table either: title + notes are short,
  retrieval is by `due_at` window not similarity. If the W1 prompt
  finds it does want similarity here, an `assignment_embedding`
  single-vector column on the row itself is the cheaper add. Defer.

### 3.6 Migration filename

`0018_<random>.sql` (next after `0017_slim_venom.sql`), generated by
`pnpm db:generate` after editing `lib/db/schema.ts`. Drizzle Kit picks
the random suffix.

---

## 4. Migration plan for existing data

### 4.1 Population today

Ryuto's dogfood Notion workspace is the only currently-populated source.
α has not yet been invited (see §8.4 — confirm). Therefore:

- **Total population scope**: 1 user (Ryuto), one workspace.
- **Time pressure**: zero — no parallel users to coordinate against.
- **Failure mode tolerance**: high. A failed import re-runs cleanly
  given the `(user_id, notion_page_id)` unique indexes proposed above.

### 4.2 Recommended approach: **manual one-time script, not auto-import**

Reasoning:
- Auto-import on first login is a significant complication (it has to
  block the redirect to `/app` until import completes, *or* run
  background and risk the user seeing an empty Inbox / Classes list).
  For one user, the cost-benefit is wrong.
- Auto-import on Notion-connect (i.e. when a user clicks "Connect
  Notion" in Settings post-cutover) *is* the right shape — but that's
  the post-α export-or-import-on-demand surface. Phase 7 ships only
  the script.
- The script lives at `scripts/import-notion-to-postgres.ts`,
  modeled on `scripts/fix-stale-notion-setup.ts` (env-loading
  conventions, `--dry-run` flag, audit log entries).

### 4.3 Script behavior

```
pnpm tsx scripts/import-notion-to-postgres.ts --user <userId>            # imports
pnpm tsx scripts/import-notion-to-postgres.ts --user <userId> --dry-run  # reports
```

Idempotent via the `(user_id, notion_page_id)` unique indexes —
re-running on top of an already-imported user upserts each row by
Notion id without duplicating.

Walks the four DBs in order (Classes → Assignments → Mistakes →
Syllabi) so that FK references resolve. Emits one `audit_log` row per
import batch with `action='notion.import'` and a detail blob counting
inserted / updated / skipped rows. On a failure midway, the entire
class's children are rolled back (single transaction per class), so
partial runs don't leave orphan assignments without a class FK.

### 4.4 Rollback safety

- **Notion code path stays.** `lib/integrations/notion/{client,oauth,
  data-source,id}.ts` remain importable; the eight `notion_*` chat
  tools stay registered (until a follow-up cleanup PR removes them
  from `tool-registry.ts`).
- **`notion_connections` + `registered_resources` rows stay.**
  Re-enabling Notion-canonical mode would mean swapping the read
  selector back, not re-running OAuth.
- **No DROP TABLE / DROP COLUMN in the cutover migration.** Strictly
  additive (four new entity tables + two chunk tables + indexes).
  Post-α, after at least 2 weeks of stable Postgres-canonical
  operation, a follow-up migration can drop the deprecated tables.
- **Script is one-way (Notion → Postgres).** Reverse-direction
  (Postgres → Notion export) is post-α product work and lives in a
  separate file.

### 4.5 Cutover sequencing

See §7 for engineer-day estimates. The cutover ordering is:

1. Schema lands (no readers/writers yet).
2. Postgres write paths land alongside the Notion ones (dual-write
   *or* hard cutover — see §8.3 open question).
3. Read paths swap to Postgres (UI tabs, dashboard cards, agent
   context).
4. Notion writes are removed; OAuth + import stay live.
5. Onboarding UI simplifies (Notion drops out of the default flow).

Step 2's dual-write-vs-hard-cutover decision is genuinely open and
listed in §8.3. The recommendation is **hard cutover for dogfood
because Ryuto is the only user**; a shadow-write would only hide bugs
that won't bite at α volume.

---

## 5. Onboarding flow change

### 5.1 Current sequence

`app/(auth)/onboarding/page.tsx` (210 lines) walks 4 steps:

1. Connect Google (Calendar + Gmail in one consent).
2. Connect Notion *or skip*.
3. (Notion) Setup running.
4. (Notion) Register existing resources *or skip*.

The auth-gate at [is-complete.ts:11-13](lib/onboarding/is-complete.ts:11)
already requires only Calendar + Gmail. Steps 2-4 are skip-able
no-ops for users who don't have / want Notion.

### 5.2 Proposed sequence

1. Connect Google (Calendar + Gmail). Existing copy + button work as-is.
2. Done — redirect to `/app`.

That's it. Notion connect moves to **Settings → Connections** as an
optional "Import your existing Notion class notes" affordance. The
section already exists at
[app/app/settings/connections/page.tsx:46-91](app/app/settings/connections/page.tsx:46);
the change is copy + the addition of an "Import now" button next to
"Re-run setup" / "Re-connect" / "Disconnect".

### 5.3 Surface as a design checkpoint

This is **the single user-facing change with the most surface area**:
- Onboarding hero copy (the "one consent grants Calendar + Gmail" line
  at step 1) stays right.
- Step 2-4 panes get deleted (or hidden behind a feature flag during
  the rollback-safety window — see §8 question 5).
- `runSetupAction`, `repairSetupAction`, `addResourceAction`,
  `refreshResourcesAction`, `disconnectNotionAction` stay in
  `actions.ts` (Settings still calls them); only the onboarding
  consumers go away.
- New copy is needed for Settings: roughly "Connect Notion to import
  your existing classes / mistakes / assignments / syllabi into
  Steadii. Optional — Steadii works without it." *(Ryuto must confirm
  exact wording.)*
- The first-24h Gmail ingest hook on `skipNotionAction` and
  `finishOnboardingAction` ([actions.ts:128-142](app/(auth)/onboarding/actions.ts:128))
  needs to move — currently it's wired to the "skip Notion" and
  "finish onboarding" actions; under the new flow there is no
  "skip Notion" action, so the ingest call has to land on whichever
  server action terminates the new step 1 (memo: probably a new
  `completeOnboardingAction` or a hook on `events.createUser` /
  `events.updateUser` in `lib/auth/config.ts`).

**Design checkpoint**: Ryuto confirms (a) the new onboarding copy /
sequence and (b) the exact Settings → Connections "Import from Notion"
button copy + flow before implementation. Listed in §8.

---

## 6. `/app/classes/[id]` tab implementation work

### 6.1 Current state

Four tabs ([app/app/classes/[id]/page.tsx:25-105](app/app/classes/[id]/page.tsx:25)):

| Tab | Backed by | LOC | Editing? |
|-----|-----------|-----|----------|
| Syllabus | `listFromDatabase({ databaseSelector: 'syllabiDbId' })` filtered by Class relation; row click opens Notion URL in new tab | ~50 | Read-only; "Upload" CTAs link to `/app/syllabus/new` |
| Assignments | `listFromDatabase({ databaseSelector: 'assignmentsDbId' })` filtered by Class relation, sorted by Due | ~50 | Read-only; row click opens Notion |
| Mistakes | `listFromDatabase({ databaseSelector: 'mistakesDbId' })` filtered by Class relation | ~60 | Read-only; row click opens Notion |
| Chats | Postgres query against `chats` + `messages` | ~60 | (already Postgres, no work) |

### 6.2 Read-path swap

Each tab queries the new Postgres table directly with `WHERE class_id =
$classId AND deleted_at IS NULL`, ordered by the same criteria as today.
Implementation:
- Replace `listFromDatabase({ databaseSelector: 'syllabiDbId' })` etc.
  with calls into new helpers (`listSyllabiForClass(userId, classId)`,
  etc.) — three new ~10-line query functions, one per entity.
- Replace `getRelationIds(r, "Class")` filter with a SQL `WHERE`.
- Row click goes to a new `/app/syllabus/[id]` / `/app/assignments/[id]`
  / `/app/mistakes/[id]` detail route instead of the external Notion URL.

The routes for `/app/syllabus/[id]` and `/app/mistakes/[id]` don't
exist today (`app/app/syllabus/` only has `new/`, `app/app/mistakes/`
exists but only as a top-level list). Detail routes are new, but the
shell pattern is well-trodden — see `/app/chat/[id]` for the existing
template. Estimate: ~half a day each.

### 6.3 Write paths added

| Surface | Today | After |
|---------|-------|-------|
| Mistake save (chat → "Add to Mistake Notes" dialog) | `lib/mistakes/save.ts` writes to Notion | Same dialog, new server action that writes to `mistake_notes` + `mistake_note_images`. Body shape: convert the existing "user_question + assistant_explanation + image blocks" Notion-block builder into the dual `body_format` shape (markdown by default; see §8.1). |
| Mistake **edit** (new) | n/a | New inline editor on `/app/classes/[id]?tab=mistakes` row click — open detail route with edit affordance. **Largest single line item in §7.** Recommend TipTap if the §8.1 answer is rich-JSON; recommend a simple textarea-plus-toolbar if markdown. |
| Mistake delete (new) | n/a | Soft-delete → `deleted_at = now()`. |
| Syllabus save | `lib/syllabus/save.ts` writes to Notion | New server action writing `syllabi` row + `syllabus_chunks` (embedding job is async; see §6.4). |
| Syllabus edit | n/a | Optional v1 — editing extracted fields is a power-user surface. Recommend deferring to after α. |
| Assignment create / update / delete | Done via the chat agent's `notion_create_row` / `notion_update_row` tools | New `assignment_*` chat tools (analogous shapes) and a Settings-light "+New assignment" button on the Assignments tab. The existing `notion_*` tools keep working until removed in a follow-up cleanup PR. |
| Class create / archive | Done via chat | New `class_*` tools. Same pattern. |

### 6.4 Embedding population

Two paths:
- **On-write** (synchronous tail of save action): for short content
  (mistake notes ≲ 4k tokens, the common case) embedding is sub-second
  and can run inline. Memory: don't pre-optimize.
- **On-write deferred** (background job): for syllabi (long full_text,
  potentially many chunks). Today there's no job runner; the existing
  QStash cron is per-route, not per-task. Two options:
  1. Run inline anyway. A 30-page syllabus chunked into 50 chunks ×
     500ms = 25s. Acceptable for the upload wizard's "extracting…"
     spinner; not acceptable for chat-agent inline saves.
  2. Defer behind a `pending_embedding` row + cron sweep.
- **Recommendation**: inline for v1 (one user, no scale). Surface
  embedding latency as part of the wizard's existing extract-progress
  UI. Re-evaluate when α volume justifies a sweep.

### 6.5 Editor recommendation (with hedge)

The codebase has **no rich-text editor today**. The Mistake Notes
edit surface is therefore a real feature, not a refactor. Two paths:

1. **Markdown** (cheaper). Body stored as `body_markdown`;
   `react-markdown` already renders it for the read view (the chat
   message renderer is already pulled in). Editor: a textarea-plus-
   minimal-toolbar, ~200-line component. No new deps. Math
   already supported via the `remark-math + rehype-katex` pipeline
   ([components/chat/markdown-message.tsx:23-30](components/chat/markdown-message.tsx:23)).
2. **TipTap JSON** (richer). Body stored as `body_doc` JSONB; new deps
   `@tiptap/react`, `@tiptap/starter-kit`, plus extensions for image,
   math, codeblock. Editor surface ~400 lines. Better matches Notion's
   block-based feel; users coming from Notion expect this. No
   verbatim-rendering regression because `react-markdown` is still
   available for the chat path.

**Recommendation: ask Ryuto.** §8 question 1.

---

## 7. Risk catalog

### 7.1 "Notion is unavailable" double codepath

**Today**: every read site has either a `try/catch → return []` or a
`checkDatabaseHealth → DeadDbBanner` wrapper. After migration, those
fallbacks all become dead code. Risk: leaving them in place creates
"never-runs" branches that mask future bugs.

Action: in the cleanup PR (post-stabilization, not the cutover PR),
delete the dead-DB banner consumers, the `notion-health.ts` helper, and
the `try/catch → []` fallbacks in `loader.ts`, `today.ts`, and
`summarize-week.ts`. Don't delete in the cutover PR — the rollback
window depends on these still working.

### 7.2 User-facing copy mentioning Notion to update

| Location | Current copy | Action |
|----------|---------------|--------|
| Onboarding step 2-4 panes ([page.tsx:94-179](app/(auth)/onboarding/page.tsx:94)) | "Connect Notion (optional). Adds class-relation context to triage." | Delete entirely. |
| Mistake save dialog button ([mistake-note-dialog.tsx:154](components/chat/mistake-note-dialog.tsx:154)) | "Save to Notion" | "Save mistake note" or similar. |
| Mistake save dialog header ([line 71](components/chat/mistake-note-dialog.tsx:71)) | "Add to Mistake Notes" | Stays. |
| Syllabus wizard ([page.tsx:62](app/app/syllabus/new/page.tsx:62)) | "show you a preview before saving to Notion" | "show you a preview before saving" |
| Settings "Resources" section ([settings/page.tsx:214-218](app/app/settings/page.tsx:214)) | "Notion pages the agent can read." | Move under a "Notion (optional)" sub-section; gate visibility on `notionConn`. |
| Settings → Connections page Notion section | "Connected to <workspace>" + Re-run / Re-connect / Disconnect | Add an "Import now" affordance; rest stays. |
| Privacy ([page.tsx:17-37](app/(marketing)/privacy/page.tsx:17)) | Lists Notion as a data store / processor | Reframe Notion as optional; add Postgres / Neon as the primary store. |
| Terms ([page.tsx:25-29](app/(marketing)/terms/page.tsx:25)) | "you retain ownership of … Notion pages" + "Steadii connects to Notion, …" | Adjust to "Notion (optional)". |
| Hero copy ([translations/en.ts:148](lib/i18n/translations/en.ts:148)) | "Mistakes, syllabi, and assignments live in your own Notion." | Replace — this is *the marketing line* that depended on Notion-canonical. New phrasing must align with the glass-box brand principle (§ project_decisions.md 2026-04-23). Surface as §8.6. |
| `save_to_notion` translation key ([en.ts:84,238](lib/i18n/translations/en.ts:84) + ja) | n/a | Rename key to `save_mistake` or similar; update usages. |
| `i18n/translations/ja.ts` | Same pattern as en | Mirror the English changes. |

### 7.3 CASA review implications

Per `project_decisions.md` Architecture revision point 5: removing the
two-source flow simplifies CASA Tier 2 review (only Google data flow
needs justifying). This is a **side benefit, not a blocker** for the
migration. CASA review itself is post-W4 in the original Phase 6 plan
([phase6-prew1-scoping.md §2.1](docs/handoffs/phase6-prew1-scoping.md))
and stays there. The migration affects only the *content* of the CASA
filing (less to justify), not its timing.

### 7.4 Estimated query patterns for Phase 7 W1 fanout

Rough — full design is the next scoping doc. Patterns the schema in §3
needs to support:

- **By-class fanout** for an inbox item assigned to a class: `SELECT *
  FROM mistake_notes WHERE user_id = $1 AND class_id = $2 ORDER BY
  created_at DESC LIMIT 10` + similar for syllabi + assignments.
  Latency target: <10ms each. Indexes in §3.2-§3.4 cover this.
- **Vector-similarity fanout** for an inbox item with no class match:
  `SELECT mistake_id, chunk_text, embedding <-> $1 AS dist FROM
  mistake_note_chunks WHERE user_id = $2 ORDER BY embedding <-> $1
  LIMIT 5` × 2 entity types. Sequential scan at α volume; revisit when
  the per-user chunk count exceeds ~10k.
- **Joined fetch** (mistake + class + chunks) for the W3 retrieval
  provenance UI: a single 3-table join with FK indexes. Trivial.
- **Date-range fanout** for "due in next 72h" assignments: hits the
  `assignments_user_due_idx` partial index. Already covered by §3.3.

The full W1 fanout design is the next scoping doc; the only schema
constraint to lock now is "FKs from chunk tables to entity tables, and
both `(user_id, X)` and `(X, chunk_index)` indexes on chunk tables".

### 7.5 Embedding cost / token spend

Re-embedding Ryuto's existing Notion content during the import script
is a one-shot cost. Rough back-of-envelope: at $0.02/1M tokens for
`text-embedding-3-small`, even 1M tokens of imported content costs $0.02.
Budget impact zero. Future inline embedding on save is bounded by save
volume (humans are slow); no runaway risk.

### 7.6 `discoverResources` latency removed

Removing the `await discoverResources(req.userId)` call at
[orchestrator.ts:69](lib/agent/orchestrator.ts:69) shaves a 60s-cached
Notion API call off every chat send for connected users. Cache warms
fast; the practical win is on cache misses (after the 60s TTL elapses
between sends) where today's path can take 200–800ms before the chat
stream starts. **Side benefit; not a blocker.**

### 7.7 Dual-write race window (only if §8.3 picks dual-write)

If the answer to §8.3 is "shadow-write for safety", there is a brief
race where mistakes saved during the cutover land in Postgres but the
Notion write fails (or vice versa). The proposed `(user_id,
notion_page_id)` unique indexes make this self-healing on the next
import-script run, but UI lag is real. **Hard cutover side-steps this
entirely; recommended.**

---

## 8. Effort estimate (engineer-days)

Breakdown for Ryuto-as-engineer pace, working in two-class-day blocks
([memory: user_ryuto.md](memory/user_ryuto.md)). Each line item is
sized to "ship + manual smoke test", not "merge + write release notes".

| Item | Days | Notes |
|------|------|-------|
| 1. DB schema + migrations (§3) | 0.5 | Drizzle schema for 4 entity tables + 2 chunk tables + `mistake_note_images`, `pnpm db:generate`, smoke-test on dev DB. |
| 2. Postgres write paths for mistakes / syllabi / assignments / classes | 1.5 | Server actions; replace bodies of `lib/mistakes/save.ts` and `lib/syllabus/save.ts`; add `lib/classes/save.ts`, `lib/assignments/save.ts`. Audit log entries. |
| 3. Postgres read paths (`loadClasses`, `getDueSoonAssignments`, `computeWeekSummary`, `buildUserContext`) | 1.0 | Drop-in replacements with the same return types where possible. |
| 4. `/app/classes/[id]` tab swap (Syllabus / Assignments / Mistakes) | 1.0 | Three tabs × 1/3 day each. Detail-page routes are W1 of next phase, not this scope. |
| 5. Mistake Notes editor (new) | 2.0–3.0 | **Largest line.** 2.0 if markdown, 3.0 if TipTap JSON. See §8.1 — Ryuto picks. |
| 6. Notion → Postgres import script | 1.0 | `scripts/import-notion-to-postgres.ts` with `--dry-run`. Tests against Ryuto's dogfood workspace. |
| 7. Onboarding flow simplification | 0.5 | Delete steps 2-4 from the page; move ingest hook to the new completion server action; update `OnboardingStatus` consumers. |
| 8. Settings → Connections "Import from Notion" affordance | 0.5 | Button + server action wiring + audit-log row; reuses §6 script logic but called from the request path. |
| 9. Sync / read code deprecation (mark, don't delete) | 0.5 | Add `@deprecated` JSDoc to `lib/integrations/notion/{discovery,ensure-setup,probe,setup}.ts`. Remove `discoverResources` call from orchestrator. |
| 10. UI copy updates (§7.2) | 0.5 | Onboarding strings, mistake dialog button, syllabus wizard, settings, privacy, terms, i18n keys. |
| 11. Cutover + dogfood verification | 1.0 | Run import script against own workspace; click through every UI surface; validate FK integrity; confirm chat agent context still serializes (with empty Notion section). |
| 12. Tests | 0.5–1.0 | Unit tests for each new query helper; one integration test per save action; reuse `tests/notion-*.test.ts` structure for the import script. |
| **Total** | **10.5–12.0 days** | Memory's "~1.5 weeks" budget tracks the lower bound; the §8.1 markdown vs TipTap decision is the swing factor. |

The Mistake Notes embedding job (§6.4) is folded into item 2; the
embedding chunk tables are folded into item 1.

Out of scope for this 1.5-week window — explicitly:
- Phase 7 W1 multi-source fanout (the next scoping doc's territory).
- PDF / image OCR abstraction (Phase 7 sequence step 3).
- Notion *export* (post-α).
- Detail routes for `/app/syllabus/[id]` and `/app/mistakes/[id]` if
  the Mistakes tab can edit inline. If detail routes are wanted, add
  ~0.5 day per route.
- Assignment + class CRUD via a Settings UI (chat tools cover the gap).

---

## 9. Open questions for Ryuto

Surfaced rather than silently decided. Each is a real product call.

### 9.1 Mistake Notes content format — markdown vs TipTap JSON?

The schema in §3.2 supports both via `body_format` + dual columns, but
the implementation has to pick one for v1.

- **Option A — markdown.** Body stored as `body_markdown` text; existing
  `react-markdown` pipeline renders it (math via remark/rehype already
  works in chat). Editor: textarea + minimal toolbar, ~200 lines, no
  new dependency. **Estimate hit: 2.0 days for the editor.** Best for
  ship-velocity; weakest fit for embedded images / mention nodes.
- **Option B — TipTap JSON.** Body stored as `body_doc` JSONB; new deps
  `@tiptap/react`, `@tiptap/starter-kit`, plus a few extensions.
  Editor: ~400 lines. **Estimate hit: 3.0 days for the editor.** Best
  fit for Notion-flavored block UX (which is what users importing from
  Notion will expect); biggest lock-in.

Recommendation: **A for v1** unless Ryuto has a strong preference for
the Notion-block feel. The schema is forward-compatible — flipping later
is a single forward-only column-population migration.

### 9.2 Syllabus storage — original PDF + extracted text, or text only?

Today the verbatim-preservation invariant ([decisions.md L24, L100](memory/project_decisions.md))
keeps both. Keeping the blob long-term has a Vercel Blob cost (~$0.15/GB/mo)
but tiny α-scale absolute cost. Future archival of the original is also
useful for "show me the source page" UX.

- **Recommendation: keep both.** `syllabi.full_text` for retrieval;
  `blob_*` columns for "open original" affordance. Override only if
  Ryuto wants to optimize for storage cost.

### 9.3 Cutover strategy — hard cutover or shadow-write?

- **Hard cutover** (recommended): the cutover PR turns off Notion
  writes, turns on Postgres writes. Old reads keep working until the
  next deploy of read swaps. One user, low coordination cost.
- **Shadow-write** (safer in spirit, complex in practice): writes go
  to *both* surfaces for a period; reads switch first. Adds a
  reconciliation surface and makes failed writes ambiguous.

Ryuto's call. Recommendation: **hard cutover** for dogfood, with the
ability to revert by reverting the PR (Notion code stays importable).

### 9.4 Does any α invitee already have Notion data we'd need to import?

α has not been invited yet (per `project_steadii.md`). **Confirm
assumption: zero α users have any Notion data we'd need to import.**
If yes → migration is a single-user dogfood-only operation. If no →
the import script needs an α-user batch mode, but the per-user logic
is identical.

### 9.5 Should the Notion import script ship in the same PR as the cutover?

- **Same PR** (recommended for dogfood velocity): the import is part of
  Ryuto's own cutover; bundling avoids a "Postgres tables exist but are
  empty" interim state.
- **Later PR**: ships read/write swap first, then a follow-up PR with
  the import. Cleaner per-PR scope but introduces an empty-state period.

Same PR keeps the cutover atomic. Strongly recommend.

### 9.6 Marketing hero copy

The translation key
[en.ts:148](lib/i18n/translations/en.ts:148) — *"Mistakes, syllabi, and
assignments live in your own Notion. Original PDFs are preserved
verbatim. We organize — never lock in."* — was the marketing crystallization
of the Notion-canonical decision.

The new principle is **glass-box transparency** ([decisions.md
2026-04-23](memory/project_decisions.md)). What replaces this line?
Suggested direction (Ryuto edits): *"Your verbatim mistakes, syllabi, and
assignments stay yours — readable, exportable to Notion anytime, never
locked in."* — but the actual final copy is a brand decision, not an
engineering one.

### 9.7 Should classes get an embedding chunk table v1?

§3.5 punts on `class_chunks`. Tradeoff: embedding the five fields of
class metadata adds a small signal to multi-source fanout but at the
cost of a sixth chunk table, ~5 lines of class-save code, and the
embedding round-trip per class. At α scale (~5 classes/user) the
recall improvement is marginal.

Recommendation: **defer** until W1 fanout shows it's needed. Same reasoning
applies to `assignment_embedding`.

### 9.8 Visibility of deprecated Notion code in dev tooling

The eight `notion_*` chat tools at
[lib/agent/tools/notion.ts:480-489](lib/agent/tools/notion.ts:480) stay
registered to `tool-registry.ts` during the rollback window. That means
the chat agent will still "see" them in its tool list and may invoke
them on a connected user — succeeding but writing to a now-secondary
surface. Three options:

- (a) Leave registered; agent occasionally writes to Notion. Harmless
  for dogfood.
- (b) Gate by `agent_rules`-style flag or by user `is_admin=true` so only
  Ryuto sees them.
- (c) Unregister immediately in the cutover PR; if the rollback fires,
  re-register in the revert.

Recommendation: **(a) for dogfood window**, (c) for the post-α cleanup
PR. List as awareness, not a blocker.

---

## 10. Assumptions made

Listed so Ryuto can correct anything that's wrong.

**Memory-staleness assumptions.**
- `MEMORY.md` carried a system-reminder noting it was 2 days old.
  Treated `project_decisions.md` and `project_steadii.md` as current
  since they explicitly date the Architecture revision to 2026-04-25
  and the codebase aligns (Phase 6 W4.3 staged-autonomy is the latest
  merged commit, matching the phase state).
- The Phase 6 scoping doc is treated as the format template per the
  prompt; format choices that diverge (more sections, slightly
  different ordering) are deliberate.

**Code-state assumptions.**
- `pgvector` ops names (`<->` for L2 distance, `vector_l2_ops`) match the
  existing `email_embeddings` usage. Verified via the migration name
  `0014_enable_pgvector.sql`; not re-confirmed by reading the migration
  body.
- `blob_assets.source` already supports `'syllabus'` (verified at
  [schema.ts:124](lib/db/schema.ts:124)). Reused for the new `syllabi`
  table's blob FK.
- `react-markdown` 10.x supports the same plugin shape as today
  (verified `markdown-message.tsx` imports remarkGfm/remarkMath/
  rehypeKatex). Suitable for the Mistake Notes read view if
  `body_format='markdown'` is chosen.
- `notion_page_id` columns can hold the Notion UUID-with-dashes
  format the SDK returns. No assumption made about un-dashed format
  (the import script should normalize via `parseNotionId` →
  re-format if needed).
- The Postgres `mistake_notes.tags` GIN index syntax is standard
  (`USING gin (tags)`); Drizzle's `index().using('gin', ...)` shape
  needs verification at write time but is well-precedented.

**Product assumptions** (pulled from memory; flagging if I built on a
secondary inference):
- α has not been invited yet. Sole Notion-populated user is Ryuto.
- The four-entity scope is exhaustive — no fifth Notion-canonical
  entity is hiding in the codebase. (Verified by `grep -i 'notion'`
  inventory in §2.)
- Glass-box brand principle ([decisions.md 2026-04-23](memory/project_decisions.md))
  trumps Notion-marketing-copy continuity; the §9.6 hero rewrite is
  on the table.
- Verbatim preservation universality applies to Postgres-stored content
  the same way it applied to Notion-stored content. (Per
  [decisions.md L24](memory/project_decisions.md): "Verbatim preservation
  is universal, NOT tier-gated — core DNA.")

**Out-of-scope work assumed deferred** (per Phase 7 sequencing in
`project_steadii.md`, restating for clarity):
- Phase 7 W1 multi-source fanout: next scoping doc.
- Phase 7 step 3 PDF/OCR notes abstraction: ~1.5 weeks after this
  step.
- Notion *export* (Postgres → Notion): post-α product line.
- Apple iCloud / iOS share extension: post-α gate.
- Pro+ tier scoping: post-α data review.

---
