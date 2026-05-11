# Engineer-43 — Queue UX wave: pre-brief reach + scanner cleanup + Gmail Push + Type C summary

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_qstash_orphan_schedules.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md`

Reference shipped patterns:

- `lib/agent/pre-brief/scanner.ts` — gating that excludes MS / iCal events.
- `lib/agent/proactive/rules/` — 5-rule registry, `exam_under_prepared` now dead after PR #182 dropped mistakes.
- `lib/agent/queue/build.ts` — `fetchPendingDrafts` filters by action enum; Type C notify_only currently always surfaces.
- `lib/agent/email/email-ingest.ts` / `lib/integrations/google/gmail-fetch.ts` — Gmail polling path.
- `lib/agent/email/classify-deep.ts` — `runDeepPass` output extension point (already has `reasoning`, `actionItems`; adding `shortSummary`).

---

## Strategic context

Ryuto dogfood feedback summary as of 2026-05-11:

- **Pre-brief never fires** for him because the scanner only accepts Google Calendar events with attendees. His meetings come via MS Outlook + iCal subscriptions.
- **Type A scanner rules** have a dead one (`exam_under_prepared`, since mistakes are dropped per PR #182). Plus the rule set is narrow — only fires for syllabus-bound users.
- **Type C notify_only cards** show in queue even after he's read the underlying Gmail message in Gmail UI — feels like double notification. He wants real-time read-state filtering.
- **Type C card body** is generic ("Important from {sender}, no reply expected"); he wants the actual content summary so he doesn't have to open the page.

This engineer ships all four as one wave to land the queue UX in its final α-launch shape.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent commit: PR #195 (engineer-41) or later. If behind, **STOP**.

Branch: `engineer-43-queue-ux-wave`. Don't push without Ryuto's explicit authorization.

---

## What changes

### Part 1 — Pre-brief reach (~150 LOC)

`lib/agent/pre-brief/scanner.ts`:

- Drop `event.sourceType !== "google_calendar"` gate in `extractAttendees`. Support MS (`microsoft_graph` sourceType) + iCal (`ical_subscription` sourceType).
- Attendee field extraction:
  - Google: `sourceMetadata.attendees` (existing)
  - MS Graph: `sourceMetadata.attendees` shape differs — extract `emailAddress.address` + `emailAddress.name`
  - iCal: ATTENDEE lines parsed into `sourceMetadata.attendees` at ingest time (verify ingest already does this; if not, add)
- `looksNonAcademic` blocklist — make it less aggressive. Current list includes "doctor" / "dentist" which mis-fires on academic contexts. Replace with a tighter list of obviously non-academic English keywords ("haircut", "dental", "vet").

Tests update for the new sourceTypes.

### Part 2 — Scanner rule cleanup (~200 LOC)

`lib/agent/proactive/rules/`:

- **Delete** `exam-under-prepared.ts` and its entry in `index.ts`. Mistakes dropped (PR #182) → rule is dead.
- **Replace** with `classroom-deadline-imminent.ts`:
  - Detects Google Classroom coursework with dueDate within 24h and no Steadii activity (no reclassify / no draft / no recent open)
  - Issue type: `"classroom_deadline_imminent"` (new enum value)
  - Add migration if `AgentProposalIssueType` enum is a check-constrained text column (verify in schema)
- **Add** `calendar_double_booking.ts`:
  - Same calendar slot has 2+ events
  - Issue type: `"calendar_double_booking"`
- **Tighten** existing rules so they work without syllabus too:
  - `time_conflict`: also detects when 2 Google Classroom events overlap (no syllabus needed)
  - `workload_over_capacity`: count Google Tasks + MS To Do in addition to Steadii assignments

Tests: per new rule + adjusted existing rule tests.

### Part 3 — Type C realtime unread filter via Gmail Push (~400 LOC)

This is the biggest piece. Three sub-parts:

#### 3a. Pub/Sub topic + watch infrastructure
- New env vars: `GMAIL_PUBSUB_PROJECT`, `GMAIL_PUBSUB_TOPIC` (Ryuto sets these on Vercel post-merge)
- New helper `lib/integrations/google/gmail-watch.ts`:
  - `setupWatchForUser(userId)` calls `gmail.users.watch({ topicName, labelIds: ["UNREAD"] })`, persists `historyId` + `expiresAt` to a new `users.gmail_watch` jsonb column
  - `refreshWatch(userId)` re-calls when `expiresAt - now < 24h`
- New cron `/api/cron/gmail-watch-refresh` (daily) → iterates users → refreshes any near-expiry watches

#### 3b. Webhook receiver
- New route `/api/webhooks/gmail-push` accepting Pub/Sub POST with the standard auth header
- Verify signature
- Decode payload → `{ emailAddress, historyId }`
- Look up user by email, call `gmail.users.history.list({ startHistoryId, historyTypes: ["labelAdded", "labelRemoved"] })` → handle each:
  - `labelAdded "UNREAD"` → mark `inbox_items.gmailReadAt = null`
  - `labelRemoved "UNREAD"` → mark `inbox_items.gmailReadAt = now()`
- Migration: add `inbox_items.gmail_read_at timestamptz` column

#### 3c. Queue filter
- `lib/agent/queue/build.ts` `fetchPendingDrafts` for `action='notify_only'`: filter out rows whose `inbox_items.gmail_read_at IS NOT NULL` AND `gmail_read_at < created_at + 24h`. The 24h window keeps "just-read" still showing briefly so the user can act on it.
- Add a Settings toggle: `users.preferences.hideReadFromQueue` (default true) so users who want everything can disable.

Manual deploy steps post-merge:
1. `pnpm db:migrate` against prod (new migration 0036)
2. Create GCP Pub/Sub topic `gmail-push-prod`, grant Gmail publish-permission per Google docs
3. Set Vercel env vars
4. Add Upstash schedule for `/api/cron/gmail-watch-refresh` @ daily 4am UTC
5. Trigger watch setup for existing users via a one-shot admin action

### Part 4 — Type C card content summary (~200 LOC)

`lib/agent/email/classify-deep.ts`:

- Add `shortSummary: string` to the deep-pass JSON schema:
  - For `notify_only` action: required, 1-2 sentence summary of the email
  - For other actions: optional / null
  - Length cap 280 chars
- Update system prompt with instruction + examples
- Update `DeepPassResult` type

`lib/agent/email/l2.ts`:

- Persist `deep.shortSummary` onto `agent_drafts.short_summary` (new column, migration 0036 same migration as Part 3 webhook column)

`lib/agent/queue/build.ts`:

- `draftToTypeC` body: if `draft.shortSummary` present, use it. Else fall back to current generic copy.

`components/agent/queue-card.tsx` Type C render: no change — already renders `card.body`. The substance flows through.

---

## Files

- `lib/agent/pre-brief/scanner.ts` — sourceType + blocklist (~80 LOC)
- `lib/agent/proactive/rules/exam-under-prepared.ts` — DELETE
- `lib/agent/proactive/rules/classroom-deadline-imminent.ts` (NEW, ~100 LOC)
- `lib/agent/proactive/rules/calendar-double-booking.ts` (NEW, ~80 LOC)
- `lib/agent/proactive/rules/time-conflict.ts` — Classroom support (~30 LOC)
- `lib/agent/proactive/rules/workload-over-capacity.ts` — Tasks support (~30 LOC)
- `lib/agent/proactive/rules/index.ts` — registry update
- `lib/integrations/google/gmail-watch.ts` (NEW, ~120 LOC)
- `app/api/webhooks/gmail-push/route.ts` (NEW, ~150 LOC)
- `app/api/cron/gmail-watch-refresh/route.ts` (NEW, ~80 LOC)
- `lib/agent/queue/build.ts` — Type C filter + summary fallback (~50 LOC)
- `lib/agent/email/classify-deep.ts` — shortSummary in schema + prompt (~50 LOC)
- `lib/agent/email/l2.ts` — persist shortSummary (~10 LOC)
- `lib/db/migrations/0036_queue_ux_wave.sql` + journal entry (~30 LOC)
- `lib/db/schema.ts` — `users.gmail_watch` jsonb + `inbox_items.gmail_read_at` + `agent_drafts.short_summary` + `users.preferences.hideReadFromQueue` (~30 LOC)
- `app/app/settings/page.tsx` — toggle for hideReadFromQueue (~30 LOC)
- `lib/i18n/translations/en.ts` + `ja.ts` (~20 LOC)
- Tests (~400 LOC)

Total: ~1500 LOC.

---

## Tests

- `pre-brief-ms-ical.test.ts` — extractAttendees works for MS + iCal sourceTypes
- `pre-brief-blocklist-narrowed.test.ts` — old false-positives no longer skip
- `classroom-deadline-imminent.test.ts` — new rule fires correctly
- `calendar-double-booking.test.ts` — new rule
- `gmail-watch.test.ts` — setup + refresh paths
- `gmail-push-webhook.test.ts` — history.list parsing, labelAdded / labelRemoved → gmail_read_at flips
- `queue-type-c-read-filter.test.ts` — read items filtered (with 24h grace)
- `type-c-summary.test.ts` — shortSummary surfaces in card body

Aim: ~1150 → ~1200+. `pnpm test` + `pnpm tsc --noEmit` clean.

---

## Verification

Per AGENTS.md §13:

- `/app` showing pre-brief card for an MS Outlook meeting EN + JA
- Type C card with substantive summary (not generic copy) EN + JA
- Settings toggle for hide-read-from-queue
- Smoke test: read an inbox_items row via Gmail UI → ~5 sec later, refresh /app → Type C card gone from queue
- (or document why smoke test isn't possible if Pub/Sub isn't fully set up at verify time — engineer can drop a manual SQL UPDATE on gmail_read_at to simulate)

---

## Out of scope

- **Auto-regenerate drafts on confirmation resolve** — defer to engineer-44 if needed
- **Cross-user Pub/Sub setup** — engineer ships the code; Ryuto does the GCP console setup
- **Inbox UI surfacing of read state** — only queue filtering for now
- **iCal subscriptions ATTENDEE parse at ingest** — if not already done at ingest, defer; the pre-brief reach part just needs sourceMetadata.attendees populated which the iCal parser may need a follow-up to do

---

## Critical constraints

- **Migration 0036 + journal entry** must ship together (engineer-39 lesson).
- **Upstash schedule** for `/api/cron/gmail-watch-refresh` must be registered post-deploy (Ryuto adds via console per `feedback_qstash_orphan_schedules.md`).
- **GCP Pub/Sub setup** is Ryuto-only manual step. Spec includes a checklist in the PR description.
- **Gmail watch expiry**: ignore at peril — watches die after 7 days, the refresh cron must run, OR users stop getting real-time read updates silently.
- **Don't commit changes to `.claude/launch.json`**.
- **Vitest** — `pkill -9 -f vitest` if hung.

---

## Final report (per AGENTS.md §12)

- Branch / PR
- Tests delta from ~1150 baseline
- Migration + journal entry confirmation
- Pub/Sub topic name + IAM grant confirmation
- Watch refresh schedule registered
- Screenshots EN + JA per AGENTS.md §13
- Memory updates: sparring updates `feedback_qstash_orphan_schedules.md` canonical schedule list (8 → 9 with `gmail-watch-refresh`) post-merge.
