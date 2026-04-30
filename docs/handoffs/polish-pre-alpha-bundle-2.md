# Polish — Pre-α bundle 2 (Ryuto dogfood findings + MS race fix)

Second round of pre-α polish triggered by Ryuto's hands-on dogfood (2026-04-29). Bundles 9 fixes / improvements into one PR. Most touch the chat / inbox / notification surfaces; one is an MS Graph race fix from the code review.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status
git log --oneline -5
```

Branch: `polish-pre-alpha-bundle-2`. Don't push without Ryuto's explicit authorization.

---

## Fix 1 — iCal events not appearing in `/app/calendar`

### Symptom

Ryuto subscribed an iCal feed via Settings → Connections → iCal. Subscription row shows status `active` + `lastSyncAt` recent. But `/app/calendar` shows zero events from the feed.

### Investigation steps

1. Check the actual `events` table for rows with `sourceType = 'ical_subscription'` for Ryuto's userId:
   ```sql
   SELECT id, title, starts_at, source_type, source_account_id
   FROM events
   WHERE user_id = '<ryuto-user-id>' AND source_type = 'ical_subscription'
   LIMIT 20;
   ```
2. If zero rows → the sync isn't writing to events table. Check `lib/integrations/ical/sync.ts:135` (where `upsertFromSourceRow` is called) — is the call actually firing? Add temporary logging to the sync loop to count rows-written-per-sync.
3. If rows exist but not on `/app/calendar` → check `app/app/calendar/page.tsx` query — does it filter by `sourceType` and exclude `ical_subscription`? Probably not, but verify.
4. If rows exist within wrong date window → the sync window in `lib/integrations/ical/sync.ts:12` (60-day) might be too narrow; verify the feed's events fall within it.

Most likely root cause (educated guess): the sync window or the feed parsing skips events. Fix will depend on what investigation finds. Document the actual root cause in the commit message.

### Verify

- Re-sync the feed (manual via QStash console or trigger via the iCal chat tool added in Fix 2).
- `/app/calendar` shows the imported events with `sourceType=ical_subscription` badge.

---

## Fix 2 — iCal chat-first subscribe tool (chat-first principle)

### Why

Ryuto's directive: "何事も chat first で行きましょう" (everything chat-first). The user should be able to paste an iCal URL into chat and have the agent set up the subscription via tool, not navigate to Settings → Connections.

### Spec

New tool in `lib/agent/tools/`. Suggested name: `ical_subscribe`. Mutability: `write`.

- Parameters: `url: string` (the iCal URL — `webcal://` or `https://`)
- Server-side validation: SSRF guard (reuse `lib/utils/ssrf-guard.ts`), VCALENDAR header probe, 60s timeout
- On success: insert row into `icalSubscriptions` table (mirror Settings → Add code path), trigger immediate first sync, return the subscription label + count of events imported
- On failure (unreachable, not VCALENDAR, etc.): structured error returned to LLM so the assistant explains the failure

System prompt update (`lib/agent/prompts/main.ts`): add a small rule under the existing tool descriptions:

> When the user pastes an iCal / `.ics` / `webcal://` URL in chat (or asks to "subscribe to my school's calendar feed"), call `ical_subscribe` directly. Don't tell them to navigate to Settings.

### Verify

- Chat: paste `https://www.officeholidays.com/ics-clean/japan` → agent runs the tool, returns "Subscribed — N events imported" → events appear in `/app/calendar`
- Paste invalid URL → agent surfaces the error in plain language
- Paste a URL the user already has → idempotent: tool detects existing subscription and returns "Already subscribed" instead of duplicating

---

## Fix 3 — Chat title still missing in some chats

### Symptom

Ryuto observed at least one chat without an auto-generated title, even though PR #83 added the SSE handler. Possible regression conditions:

- Chats where the assistant response is a tool-call only (no `text_delta` events)
- Chats where the first user message triggered an error that aborted the stream before title generation
- Chats where the title generation succeeded server-side but the SSE event was emitted before the client SSE loop registered the handler (race)

### Fix

Investigate the actual failing chat:

1. Reproduce by creating a fresh chat with a tool-call-heavy first message (e.g. "5/16 学校休む" — known to trigger eager reads only)
2. Check the chat row in DB: is `chats.title` populated? If yes → client display issue. If no → server didn't generate.
3. Trace `app/api/chat/route.ts:130-140` — is `generateChatTitle` being called for tool-call-only responses? The condition `if (!chat.title && assistantId && fullText)` requires `fullText` to be non-empty. If the assistant response was 100% tool calls with no text, `fullText` is empty → title never generated.

Likely fix: relax the condition. Even tool-call-only chats deserve a title — generate it from the FIRST USER MESSAGE alone if `fullText` is empty.

```ts
if (!chat.title && assistantId) {
  const firstUser = await firstUserMessage(chatId);
  if (firstUser) {
    const titleSeed = fullText || firstUser; // fall back to user msg
    const title = await generateChatTitle(userId, chatId, firstUser, titleSeed);
    send({ type: "title", title });
  }
}
```

Verify the title model handles user-message-only seeds gracefully.

### Verify

- Send "5/16 学校休む" in a fresh chat → title generates within ~2s, even though assistant response was tool-call-heavy
- Reload chat → title persists from DB

---

## Fix 4 — `[Steadii]` prefix on calendar events: move to end + soften

### Symptom

Calendar events imported by syllabus auto-import are titled `[Steadii] MAT223 Assignment 1 due`. The prefix forces the user to click into the event to see what it is — the meaningful part is occluded in the timeline view. Ryuto wants the agent-creation marker at the END (or removed entirely from the visible title).

### Fix

`lib/agent/proactive/syllabus-import.ts:47, 214`:

```ts
// Before:
const STEADII_PREFIX = "[Steadii]";
const title = `${STEADII_PREFIX} ${evt.classCode ? evt.classCode + " " : ""}${evt.label}`.trim();

// After (option A — suffix marker):
const STEADII_SUFFIX = " · Steadii";
const title = `${evt.classCode ? evt.classCode + " " : ""}${evt.label}${STEADII_SUFFIX}`.trim();

// Or option B — drop visible marker entirely, rely on description for traceability:
const title = `${evt.classCode ? evt.classCode + " " : ""}${evt.label}`.trim();
// description already says "Imported from Steadii syllabus {id}" per line 215 — that's enough provenance
```

**Recommended: Option B.** Reasons:
- Calendar UI already visually compressed; cleanest title wins
- Provenance lives in the event description (`description` field already includes "Imported from Steadii syllabus {id}")
- User can still trace which events came from Steadii via the description / external metadata
- Removes "Steadii" branding noise from the user's daily calendar view

If Ryuto prefers a visible marker, fall back to Option A (suffix).

Also dedup logic: if a previously-imported event has the old `[Steadii] ...` prefix, the new sync won't dedup-match it (title comparison would fail). Consider: (a) one-time migration to rename existing rows, OR (b) widen `matchToCalendar` dedup to ignore the prefix when comparing. Pick (b) — simpler, no migration risk.

### Verify

- Re-run syllabus auto-import → new events have clean titles (no `[Steadii]` prefix)
- Old events from previous import still recognized by dedup (no double-add)
- Event description still says "Imported from Steadii syllabus ..." for traceability

---

## Fix 5 — Notification UX overhaul: bell + digest, separate from inbox triage queue

### Why (sparring decisions confirmed 2026-04-29)

**Q1 → (a) bell icon** as the notification surface (existing component, α-scope appropriate, no new web-push infra)

**Q2 → (b) inbox にもう surface しない** — auto-action records (syllabus import, future auto-send, proactive scanner outputs) move out of `/app/inbox`. Inbox stays purely for user-actionable items (drafts pending confirmation, ambiguous matches needing user input).

**Q3 → unified policy** for ALL auto actions: current syllabus auto-import + future email auto-send + future proactive scanner outputs all flow through the same bell + digest channel.

### Spec

#### Storage

The current code in `syllabus-import.ts:189-193` calls `recordAutoActionLog()` (per Phase 8 D11 communication-first principle). Investigate where this writes:

- If it writes to `agentProposals` table → inbox surfaces it (current bug). Needs to write to a SEPARATE surface.
- If it writes to `audit_log` → inbox doesn't query, but bell needs to query audit_log filtered to a new "user-visible" subset.

Recommended: introduce a new lightweight table `agent_auto_actions` (or rename / split out the relevant audit_log entries) with columns:
- `id`, `user_id`, `kind` (enum: `syllabus_import` | `email_auto_send` | `proactive_scanner` | future), `summary` (short user-facing string), `reasoning` (longer), `source_refs` (JSON, links to underlying syllabus / email / event), `created_at`, `dismissed_at` (nullable), `seen_at` (nullable for unread/read)
- Index: `(user_id, created_at desc) where dismissed_at is null` for bell query

#### Bell

Bell component (`components/layout/notification-bell-client.tsx`) currently shows high-risk inbox items per `project_pre_launch_redesign.md`. Extend to a 2-section dropdown:

1. **"Needs review"** (existing — high-risk inbox items pending user action)
2. **"Steadii noticed"** (new — recent rows from `agent_auto_actions`, ordered by `created_at desc`, max 10)

Each "Steadii noticed" row: short summary line + timestamp + click-through to detail (existing inbox proposal-detail page pattern can be reused for the detail surface, just don't surface in inbox list itself).

Auto-mark-seen on bell open. Auto-clear (dismiss) after 7 days OR on explicit user "Dismiss" action. Counter on bell badge = unseen count across both sections.

#### Inbox

`/app/inbox` query: filter to user-actionable rows only. Specifically EXCLUDE the auto-action records (syllabus import, etc.). The proposal-detail page (`/app/inbox/proposals/[id]`) can stay as the detail surface — bell links to it.

#### Digest

7am digest already has a "Steadii noticed" subsection per Phase 8 D11. Verify it pulls from the same `agent_auto_actions` source post-refactor (or whatever storage replaces audit_log filtering). Same filter: `dismissed_at IS NULL` + last 24h.

### Verify

- Upload a syllabus → events imported, "Steadii noticed: シラバスから N 件追加" appears in bell, NOT in `/app/inbox` triage list
- Click the bell entry → land on the proposal-detail page (existing UX preserved)
- 7am digest body includes the same line under "Steadii noticed" subsection
- After 7 days (or after explicit Dismiss) → row stops appearing in bell

### Migration note

Existing audit_log entries from prior syllabus imports: don't backfill into the new table. They've already been seen (or stale). Start fresh with new policy.

---

## Fix 6 — Proposed actions: parse + render as pill buttons

### Symptom

Per screenshot, the agent's response surfaces "Proposed actions:" block with raw text:
```
Proposed actions:
• [calendar_create_event] 5/16 欠席予定を追加
• [tasks_create] 5/16 欠席対応のタスクを追加
```

The `[calendar_create_event]` and `[tasks_create]` tool names leak through to the user. The system prompt at `lib/agent/prompts/main.ts:48` instructs the model to emit this format, but `components/chat/chat-view.tsx` has no parser to render it as buttons.

### Fix

Add a parser + button renderer in the chat-view rendering pipeline:

1. **Parser**: After receiving the assistant response (or per-token during streaming), detect the `Proposed actions:` block at the END of the message body. Extract bullets matching `^[-*•]\s*\[([a-z_]+)\]\s*(.+)$` → `{toolName, label}` array.
2. **Renderer**: Hide the raw `Proposed actions:` block from the rendered markdown. Render the extracted actions as pill buttons below the assistant message body. Match the existing "+ Add to mistakes" pill style (orange amber outline — see screenshot for the existing pill design).
3. **Action wiring**: Click a pill → POST to `/api/chat/confirm` (or whatever the existing tool-call confirmation route is) with `{toolName, label, chatId}`. The server resolves the tool name to its execute path and runs it (or, if the tool requires args beyond what the label has, opens a follow-up chat turn asking for clarification — same pattern as confirmation flow).

The per-tool args question: a label like "5/16 欠席予定を追加" doesn't have structured args. The server can either:
- (a) Hand back to the LLM with a system message "User clicked: [calendar_create_event] 5/16 欠席予定を追加 — generate the tool call with full args" and let the model construct the call
- (b) Invent a "deferred tool intent" pattern where the agent emits structured `{tool, args}` JSON in a special block and the parser extracts that

Pick (a) — simpler, leverages existing model. The LLM has full conversation context to fill args.

### Verify

- "5/16 学校休む" → assistant response shows reasoning text + pill buttons (no raw `[calendar_create_event]` text)
- Click a pill → tool fires, agent executes (with confirmation flow if write tool), success surfaced inline
- Pill style matches existing "+ Add to mistakes" (amber outline + small text)

### Out of scope

- Multi-step interactive confirmation UI (just fire the tool via existing flow)
- Pill keyboard navigation / arrow keys (post-α)

---

## Fix 7 — MS Graph token refresh race condition

### Source

Code review of PR #91 (commit fadeb89) flagged 2 CRITICAL findings; only #1 (token refresh race) is α-relevant. Other findings (#2 expired refresh UX, defensive Graph response validation, etc.) are post-α queue.

### Symptom

`lib/integrations/microsoft/graph-client.ts:107-128` `getMsGraphForUser` caches the refreshed token in the in-memory `row` object to avoid re-reading DB. If two simultaneous tool calls both hit `isExpired` on the same stale row, both call `refreshAccessToken` without mutual exclusion. The second refresh returns a NEW refresh_token from MS (line 85-86) which Postgres records, but the first call's in-memory mutation is now stale. On the next request, the stored refresh_token is the second caller's, and the first caller's in-memory copy is a now-dead refresh_token. Subsequent reuse breaks once the access_token expires.

### Fix

Add per-user refresh mutex. Two implementation options:

**Option A — in-memory mutex map** (single-process):

```ts
const refreshLocks = new Map<string, Promise<RefreshResult>>();

async function getMsGraphForUser(userId: string) {
  const row = await loadAccountRow(userId);
  if (!isExpired(row)) return graphClient(row.access_token);

  const lockKey = `ms:${userId}:${row.providerAccountId}`;
  let pending = refreshLocks.get(lockKey);
  if (!pending) {
    pending = refreshAccessToken(row).finally(() => refreshLocks.delete(lockKey));
    refreshLocks.set(lockKey, pending);
  }
  const fresh = await pending;
  return graphClient(fresh.access_token);
}
```

**Option B — Postgres advisory lock** (multi-process / Vercel serverless safe):

```ts
await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ms:${userId}:${row.providerAccountId}`}))`);
// then refresh inside the same transaction
```

Vercel serverless: Option A is process-local. Two concurrent serverless invocations still race. **Pick Option B** for production safety.

Apply same pattern to Google's token refresh path (`lib/integrations/google/`) for consistency, even if no incident has been observed there.

### Test

Spawn two parallel `getMsGraphForUser` calls in a test, assert that only ONE `refreshAccessToken` HTTP call is made. Use vitest's `vi.spyOn` on the refresh function.

### Verify

- Manual: hard to repro without concurrent load. Trust the test.

---

---

## Fix 8 — First-time sender role picker: inline (not modal) + broader taxonomy + class type-in

### Symptom

Ryuto's dogfood finding: the "Who is this sender?" confirmation appears on every first contact and is intrusive. Plus, the current 5-role taxonomy (Professor / TA / Classmate / Admin / Other per memory `project_agent_model.md`) is too academic-narrow — students email about clubs, internships, family, friends, recruiters, etc. and forcing them into "Other" loses signal.

### Spec

**Surface change**: replace the blocking modal with an **inline section at the top of `/app/inbox/[id]` (inbox detail page)** for emails where the sender is unclassified. Format:

```
┌─────────────────────────────────────────────────────┐
│ New sender — help Steadii classify (optional)       │
│                                                     │
│ Who: [Professor] [TA] [Classmate] [Admin]           │
│      [Career] [Personal] [Other]                    │
│                                                     │
│ Class (optional): [select existing ▼] or            │
│                   [+ type new class name]           │
│                                                     │
│ [Skip — let Steadii decide]                         │
└─────────────────────────────────────────────────────┘
```

Single-tap on a Who pill commits + persists + collapses the section. If user adds a Class (existing or new), commit both together. Skip dismisses without saving — Steadii falls back to LLM-only classification for that sender going forward.

**Once classified, never re-ask** for that sender again. (Bug-or-by-design check: the current modal might be triggering on already-known senders due to lookup miss — verify the persistence path works correctly.)

### Taxonomy (revised)

7 categories replacing the current 5:

| Category | Examples | Default risk-tier hint |
|---|---|---|
| **Professor / Instructor** | course teaching faculty | AUTO-MEDIUM |
| **TA / Tutor** | course TAs, peer tutors | AUTO-MEDIUM |
| **Classmate** | fellow students | → L2 |
| **Admin / Office** | registrar, financial aid, housing, IT | AUTO-MEDIUM |
| **Career** | recruiters, internship coordinators, interviewers | **AUTO-HIGH** (existing L1 rule) |
| **Personal** | family, friends, clubs, social | AUTO-LOW |
| **Other** | catch-all (newsletters that slipped past L1, ambiguous) | → L2 |

The risk-tier hints feed the L1 rules at `lib/agent/email/rules-global.ts` — extend the per-role mapping to cover the 4 new types (Career / Personal / Admin / Other split from old "Other"). Existing AUTO-HIGH rules (academic integrity, grades, scholarships, etc.) continue to override the per-sender role.

### Class type-in

The Class dropdown in the inline section currently surfaces existing classes from the user's `classes` table. Add a "+ Type new class name" option below the dropdown that opens a small inline input. On submit, calls the existing `createClass()` from `lib/classes/save.ts:26` with `{ name, code: null, color: <next palette> }` — same path the syllabus auto-create uses (Bug 2 in PR #83).

After creation, the new class is selected for the sender mapping AND becomes available in the dropdown for future use.

### Persistence

Sender → role/class mapping persists per (user, sender_email or sender_domain). Verify the existing schema has a column or table for this; if not, add one.

Memory note: per `project_agent_model.md` "Settings UI — B. Learned contacts": "table of sender/domain → role → risk tier → learning source." That section already exists in Settings → Agent Rules. The inline picker here is a faster entry point that writes to the same store. Sync with the Settings table.

### Verify

- New email from unclassified sender → inline section at top of inbox detail page (NOT a modal)
- Tap "Career" → section collapses, sender persisted as Career, future emails from same sender don't show the picker again
- Tap "Personal" + select existing class "PSY101" → both persisted
- Tap "Classmate" + "+ Type new class name" → input appears → type "MAT235" + Enter → class created in `classes` table + selected for mapping
- Skip → section collapses, sender remains unclassified, future emails STILL show the section (so user can classify later)
- Settings → Agent Rules → "Learned contacts" shows the just-classified senders

### Out of scope

- Bulk-classify multiple unclassified senders from a Settings view (post-α)
- Edit a sender's role from the inline picker (must go to Settings → Agent Rules; or post-α add an "Edit" button on the picker for already-classified senders)

---

## Fix 9 — Sidebar nav icon containers: rounded-md → sharp square (no rounding)

### Symptom

Sidebar nav items (Inbox / Home / Chats / Classes / Calendar / Tasks per the locked 6-item rail) currently render the active-item icon inside a rounded-square card (`rounded-md` = 6px radius). Ryuto wants **sharp square** corners (border-radius: 0) to match the diamond brand mark's geometric / Raycast-precision aesthetic.

### Files

- **In-app sidebar**: `components/layout/sidebar-nav.tsx` — find the icon container span. Likely `className` includes `rounded-md` or `rounded-lg` on the active-item highlight box. Change to no rounding (`rounded-none` or just remove the rounded class).
- **Landing animation sidebar mock**: `components/landing/hero-animation.tsx:185` — `className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-200 ${...}`}`. Change `rounded-md` → `rounded-none` to match.
- Verify nothing else in `components/layout/` (e.g. mobile-nav.tsx) renders a rounded sidebar item — match if so.

### Verify

- `/app/*` — sidebar active item highlight is a sharp square (no rounded corners)
- `/` (landing) — hero animation sidebar shows the same sharp square shape on the active icon
- Diamond brand mark (top of sidebar) + sharp square nav items reads as a coherent geometric language (no shape inconsistency)

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred — `project_agent_model.md`'s 5-role taxonomy is being broadened by this PR (sparring decision 2026-04-29); update memory accordingly
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- Fix 5 (notification UX overhaul) is the largest piece — if the bundle becomes too big to ship as one PR, split Fix 5 into a follow-up and ship the rest first; flag in your final report

## Verification plan

After implementing all 7 fixes:

1. `pnpm typecheck` — clean
2. `pnpm test` — green
3. Manual smoke per each fix's verify section
4. Re-test the iCal subscription flow end-to-end (Settings + chat-first paste both work)

## When done

Per AGENTS.md §12, your final report MUST include "Memory entries to update":

- `project_agent_model.md` — note the unified bell + digest auto-action policy (Q3 decision); inbox is user-actionable only
- `project_pre_launch_redesign.md` — bell now has 2-section dropdown ("Needs review" + "Steadii noticed")
- `project_steadii.md` α launch readiness — bump status; remaining is dogfood smoke + invite send

Plus standard report bits.
