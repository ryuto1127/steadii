# Polish-12 — Class entity CRUD + Settings "delete all data" button

Two related but distinct fixes bundled into one PR. Both close gaps in the user's ability to manage their own data — a required correctness baseline before α invite send.

This PR depends on polish-11 (recommend-by-default agent prompt) being merged to main first. If main is at polish-10 only, **STOP** and wait for polish-11.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Branch: `polish-12-class-crud-data-reset`. Don't push without Ryuto's explicit authorization.

---

## Issue 1 — Class detail CRUD gaps (5 entities, all under `/app/classes/[id]`)

The current state of edit / delete affordances on the class detail page (per scoped investigation 2026-04-27):

| Tab / Entity | Edit UI | Delete UI | API |
|---|---|---|---|
| Syllabus | None | None | None — must be added |
| Assignments | None | None | None — must be added |
| Mistakes | Exists (`MistakeMarkdownEditor`) | None | Already complete (`/api/mistakes/[id]` PATCH + DELETE) |
| Class itself | None | None | Server actions exist (`updateClass`, `softDeleteClass` in `lib/classes/save.ts`) |
| Chats | N/A (read-only references) | N/A | N/A |

The user's complaint: items show up registered to a class but can't be modified or removed. Fix all five entities (4 tabs + class itself).

### Sub-issue 1a — Syllabus tab CRUD

**Current state:** `app/app/classes/[id]/page.tsx:117-194` — `SyllabusTab` lists syllabi as view-only rows linking to original PDFs. No edit/delete UI. No API endpoints.

**What to add:**
- New API route `app/api/syllabi/[id]/route.ts` with PATCH + DELETE handlers
  - PATCH body shape: `{ title?: string, term?: string, classId?: string | null }` — start with these three fields; deeper schedule-item editing comes in a separate PR if needed
  - DELETE: soft-delete via the existing `deletedAt` column pattern (mirror `softDeleteMistakeNote` in `lib/mistakes/save.ts`)
  - Both endpoints must verify `userId = ctx.userId` before any DB write
- UI in `SyllabusTab`:
  - Each syllabus row gets a kebab menu (lucide `MoreVertical`) on hover
  - Menu items: "編集 / Edit", "削除 / Delete"
  - Edit opens a small inline form or modal with the three fields above
  - Delete opens a confirmation dialog ("Delete X syllabus? This will not affect calendar events already imported.") with destructive amber accent
  - On success, optimistic UI removal + toast confirmation

**What to leave for later:** editing individual schedule items inside a syllabus (different schema shape, deserves its own PR). Document this as a known gap in PR description.

### Sub-issue 1b — Assignments tab CRUD

**Current state:** `app/app/classes/[id]/page.tsx:196-238` — `AssignmentsTab` lists assignments but rows link back to the same page (dead link). No edit/delete UI. No API endpoints. Schema has `classId` FK and `deletedAt` column.

**What to add:**
- New API route `app/api/assignments/[id]/route.ts` with PATCH + DELETE handlers
  - PATCH body shape: `{ title?: string, dueAt?: string | null, status?: AssignmentStatus, priority?: AssignmentPriority, notes?: string }` (verify exact field names against `lib/db/schema.ts` assignments table)
  - DELETE: soft-delete via `deletedAt`
  - Both endpoints user-scoped
- UI in `AssignmentsTab`:
  - Same kebab-menu pattern as syllabus
  - Edit opens an inline editor (title + due date + status + priority + notes) — match the existing assignment row shape; don't redesign the entity
  - Delete opens a confirmation dialog ("Delete this assignment? Pending Steadii proposals referencing it may break.") — soft delete is reversible internally but treat it as final from user perspective
  - The existing dead-link "row click navigates to /app/classes/{classId}?tab=assignments" should ALSO get fixed: row click opens the inline editor (edit mode) instead of navigating

### Sub-issue 1c — Mistakes tab — add delete button

**Current state:** `/app/app/mistakes/[id]/page.tsx` renders `MistakeMarkdownEditor` with edit support. DELETE API exists at `/api/mistakes/[id]/route.ts:49-64` but no UI button.

**What to add:**
- Delete button in `MistakeMarkdownEditor` header area, secondary destructive style (small, not prominent)
- Confirmation dialog: "Delete this mistake note?" (one-line, no scary language — single notes are clearly recoverable in user mental model)
- On confirm, calls existing DELETE endpoint, redirects to the parent class detail page (or to `/app/classes` if that fails)
- Also add the same kebab-menu in `MistakesTab` grid view (`page.tsx:240-316`) so users don't have to open each note to delete it

### Sub-issue 1d — Class itself — edit + delete

**Current state:** `lib/classes/save.ts:48-84` (`updateClass`) and `:86-111` (`softDeleteClass`) server actions exist but no UI invokes them.

**What to add:**
- A small "edit class" button in the class detail page header (next to or below the class name) — opens a modal with name / color / professor fields
- A "delete class" item in a class-level kebab menu in the same header
- Class delete confirmation must list cascade implications: "Delete CSC110? This will also delete N syllabi, M assignments, K mistake notes. Chats referencing this class will be untagged but kept."
- After delete: redirect to `/app/classes` with a toast "Deleted CSC110. [Undo]" — undo is a 10-second window using `softDeleteClass` reversibility (the column is `deletedAt`; setting to NULL undoes). Don't over-engineer — if this is more than a few extra lines, drop the undo and surface "deleted" as a simple toast.
- The existing `updateClass` and `softDeleteClass` server actions are the primary entry points — call them via Next.js form actions or via small wrapper API routes, your call.

### Important pattern to match

For all four sub-issues, the kebab menu / confirmation dialog / toast UX must match the existing patterns in the app. Do NOT invent new dialog components. Reuse what's already in `components/ui/`. The visual aesthetic must stay Raycast/Arc minimal per `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — no big shadows, no large modals, sharp 6-px radius, electric amber accent on destructive confirms.

---

## Issue 2 — Settings page "delete all data" button

### Current state

`app/app/settings/page.tsx:508-521` — Danger Zone section already exists, button is **disabled** with placeholder "Delete account and all associated data. (Coming after α.)" — has not been wired up.

### Scope (locked)

**What gets deleted:**
- `classes`, `syllabi`, `syllabusChunks`, `mistakeNotes`, `mistakeNoteImages`, `mistakeNoteChunks`, `assignments`
- `chats`, `messages`, `messageAttachments`
- `inboxItems`, `agentRules` (user-created only — global rules untouched), `agentDrafts`, `agentSenderFeedback`, `agentEvents`, `agentProposals`
- `events` (Steadii-internal calendar event mirror, NOT Google's authoritative store), `sendQueue`, `pendingToolCalls`, `usageEvents`, `topupBalances`
- `notionConnections`, `registeredResources`, `icalSubscriptions`, `emailEmbeddings`
- `blobAssets` for this user (and the underlying Vercel Blob objects — call the Blob API to delete them)

**What stays:**
- `users` row itself (account stays signed in)
- `accounts` (OAuth tokens — Google, Microsoft. Disconnecting integrations is a separate per-source flow already wired in connections/actions.ts)
- `sessions` (current session keeps working)
- `subscriptions`, `invoices` (Stripe billing untouched — separate "cancel subscription" flow handles that)
- `waitlist_requests` row (admin approval doesn't get re-required)
- Global agent rules (per `agentRules` filter above)

### Confirmation UX (locked)

Mimic GitHub's repo-delete confirmation pattern:

1. User clicks "Delete all data" in Danger Zone
2. Modal opens listing exactly what will be deleted, with **live counts** computed server-side first:
   ```
   This will permanently delete:
     - 7 classes
     - 23 syllabi
     - 142 mistake notes
     - 89 assignments
     - 156 chats (1,847 messages)
     - 312 inbox items
     - 4 proactive proposals
     - 3 connected integrations (Notion, iCal × 2)
     - 47 file uploads (≈ 38 MB)

   Your account, billing, and OAuth connections will stay.
   This cannot be undone.
   ```
3. Below the list: text input prompt "Type DELETE to confirm"
4. Submit button stays disabled until input matches "DELETE" exactly (case-sensitive)
5. On submit: server action wipes the listed tables, returns success
6. UI redirects to `/app` with a toast "All data deleted. Welcome back to a clean slate."

### Implementation notes

- New server action `lib/users/wipe-data.ts` exposing `wipeAllUserData(userId: string)` — single transaction where possible, otherwise sequenced deletes in FK-dependency order
- Most tables have `onDelete: cascade` configured; verify via `lib/db/schema.ts` and use cascade where available (single DELETE on parent row triggers child cleanup). For tables without cascade, sequence deletes manually
- Vercel Blob deletion is an external API call — fire after the DB transaction commits (best-effort; if Blob delete fails, log to Sentry but don't roll back the user-facing delete)
- New API route or server action endpoint `POST /api/settings/wipe-data` (use the simpler form action pattern if it fits)
- The count-fetching endpoint can be a separate `GET /api/settings/wipe-counts` so the modal can render skeleton-then-real numbers; cache nothing
- The danger-zone button must lose its `disabled` attribute and "Coming after α" placeholder copy. Replace with the live action.

### What NOT to do

- Do NOT delete the `users` row (that would log the user out and lose Stripe customer association)
- Do NOT touch Google Calendar / Tasks / Gmail / Outlook actual data — only Steadii's internal mirrors
- Do NOT add a soft-delete grace period — the semantic is "wipe", grace makes the action confusing
- Do NOT add a separate "delete account" button in this PR — that's a separate post-α concern (and the placeholder copy on line 508-521 already promises that)

---

## i18n keys needed

All new UI strings need EN + JA. Convention: nest under existing surface keys.

```ts
classes: {
  ...existing,
  edit_class: { title: "Edit class" / "クラスを編集" },
  delete_class: {
    button: "Delete class" / "クラスを削除",
    confirm_title: "Delete {{name}}?" / "{{name}} を削除しますか？",
    confirm_body: "This will also delete {{syllabi}} syllabi, {{assignments}} assignments, {{mistakes}} mistake notes." / "シラバス {{syllabi}} 件、課題 {{assignments}} 件、間違いノート {{mistakes}} 件も同時に削除されます。",
    success_toast: "Deleted {{name}}." / "{{name}} を削除しました。",
  },
  syllabus: {
    edit: "Edit" / "編集",
    delete: "Delete" / "削除",
    delete_confirm: "Delete this syllabus? Calendar events already imported won't be affected." / "このシラバスを削除しますか？取り込み済みのカレンダー予定には影響しません。",
  },
  assignments: { edit: "...", delete: "...", delete_confirm: "..." },
  mistakes: { delete: "...", delete_confirm: "..." },
},
settings: {
  ...existing,
  danger_zone: {
    title: "Danger Zone" / "危険な操作",
    wipe_data_button: "Delete all data" / "すべてのデータを削除",
    wipe_modal: {
      title: "Permanently delete all your data?" / "すべてのデータを完全に削除しますか？",
      list_header: "This will permanently delete:" / "以下が完全に削除されます:",
      stays_note: "Your account, billing, and OAuth connections will stay." / "アカウント、課金、OAuth 連携はそのまま残ります。",
      irreversible: "This cannot be undone." / "この操作は元に戻せません。",
      type_to_confirm: "Type DELETE to confirm" / "確認のため DELETE と入力してください",
      submit: "Delete all data" / "すべてのデータを削除",
      success_toast: "All data deleted. Welcome back to a clean slate." / "すべてのデータを削除しました。",
    },
  },
},
```

Adjust naming to match existing conventions in `lib/i18n/translations/{en,ja}.ts`.

---

## Verification plan

1. `pnpm typecheck` — clean
2. `pnpm test` — green; if you add unit tests for `wipeAllUserData()`, run them
3. Manual smoke for each sub-issue:
   - **1a Syllabus**: edit a syllabus title, save, refresh → persists. Delete a syllabus → row disappears, calendar events from it stay (verify on `/app/calendar`).
   - **1b Assignments**: edit an assignment due date, save, refresh → persists. Delete → row disappears.
   - **1c Mistakes**: from grid view, kebab → delete a mistake → grid updates. From editor view, click delete → confirm → redirected to class detail.
   - **1d Class itself**: edit class name + color → header updates. Delete a class with content → confirmation lists correct counts → confirm → redirected to `/app/classes` → class is gone, including its syllabi/assignments/mistakes (cascade).
   - **2 Settings wipe**: load Danger Zone modal → counts populate from server → type "DELETE" → submit → all listed tables wiped (verify by checking `/app/classes`, `/app/inbox`, etc. — should be empty). Account stays signed in. OAuth connections still listed (untouched).
4. Run a database integrity check after wipe-data smoke: any orphaned rows in child tables? Any FK violations? Sentry should be clean.

---

## Out of scope

- Editing individual syllabus schedule items (line-by-line) — separate PR
- Account deletion (the placeholder "Coming after α" stays for the account-level row removal — that's a separate flow with Stripe cancellation)
- Reset granular subsets (e.g., "delete only chats", "delete only inbox") — α observation will tell us if users want that
- Any changes to Google Calendar, Gmail, Tasks, or Outlook real data — out of bounds
- Drag-to-reorder within tabs
- Bulk select + bulk delete on tab grids
- Recovering from a soft-deleted entity (deletedAt restoration UI)
- Editing `agentRules` from Settings (separate from this PR — Settings already has an Agent Rules section)

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- This PR depends on polish-11 being on main first
- Visual aesthetic stays Raycast/Arc per `project_pre_launch_redesign.md` — no large modals, no big shadows, sharp 6px radius
- Confirmation flows must always show the cascade implication count, not just "are you sure?"
- Wipe-data must NEVER touch external APIs (Google / Microsoft / Stripe) — Steadii internal data only

---

## Context files to read first

- `app/app/classes/[id]/page.tsx` — the file you'll edit most for Issue 1
- `app/app/mistakes/[id]/page.tsx` + components — pattern for entity edit pages
- `app/api/mistakes/[id]/route.ts` — pattern for PATCH + DELETE API route
- `lib/classes/save.ts` — existing class server actions to call from the new UI
- `lib/mistakes/save.ts` — existing soft-delete pattern
- `lib/syllabus/save.ts` — for the auto-import side effect awareness
- `lib/db/schema.ts` — table shape + FK cascade configuration
- `app/app/settings/page.tsx:508-521` — current danger zone placeholder
- `app/app/settings/connections/actions.ts:42-54` — existing disconnect pattern (closest to wipe shape)
- `lib/i18n/translations/en.ts` + `ja.ts` — i18n key conventions
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md`, `project_decisions.md`

---

## When done

Report back with:
- Branch name + final commit hash
- Verification log (typecheck, tests, all 5 manual smoke scenarios above with one-line outcome each)
- Any deviations from this brief + 1-line reason each
- Confirmation that wipe-data does NOT delete: users row, sessions, accounts (OAuth), subscriptions, invoices, global agent rules
- Confirmation that Vercel Blob objects are deleted alongside their `blobAssets` rows
