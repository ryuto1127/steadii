# Polish — W-Integrations Settings UI gaps + onboarding skip verification

W-Integrations (MS Graph + iCal + Suggestion Subsystem) shipped 2026-04-25 (commits `062cf07` + `a149021`). Backend wiring is complete. A 2026-04-29 gap audit surfaced 4 code-side issues that block onboarding-skip users from connecting MS / iCal post-onboarding, plus one schema-correctness verification.

All four are α blockers (α target Apr-May 2026). One small PR.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Most recent expected: `9dc7366 Merge pull request #84 from ryuto1127/docs/handoff-completion-contract` or later. If main isn't at that or later, **STOP**.

Branch: `polish-w-integrations-settings`. Don't push without Ryuto's explicit authorization.

---

## Gap 1 — Settings → Connections has NO MS 365 section

### Symptom

`app/app/settings/page.tsx` (Connections page) renders sections for Notion, Google Calendar, Gmail — but **no Microsoft 365** section. Users who skipped the optional integrations on onboarding Step 2 cannot reach the MS connect flow afterwards. The auth provider is wired (`lib/auth/config.ts:50-68` registers MicrosoftEntraId with `Calendars.Read + Tasks.Read + offline_access`), the Graph client works (`lib/integrations/microsoft/graph-client.ts`), the fanout integrates MS sources (`lib/agent/email/fanout.ts:21-22, 275-276`) — but the Settings UI surface is missing.

### Fix

Mirror the existing Google Calendar section pattern in `app/app/settings/page.tsx`:

- **If MS account is linked** (check `accounts` table for `provider = 'microsoft-entra-id'` scoped to the user): show "Microsoft 365 connected · <displayName or email>" + Disconnect button. Disconnect should revoke the linked account row + clear cached MS-side data (calendar events with `sourceType = 'microsoft_graph'` if applicable — verify the source type used).
- **If not linked**: "Connect Microsoft 365" button → kicks off the next-auth signIn flow with provider `microsoft-entra-id`. Use the same shape as the existing Google connect button (likely `<form action={connectAction}>` + server action that calls `signIn`).

Do NOT request Mail.Read scope at any layer. The Calendar + To Do scope set is locked per memory `project_ms_graph_scope.md`.

### Verify

- Sign out → sign in fresh (no MS link) → Settings → MS section says "Connect Microsoft 365"
- Click Connect → MS OAuth consent shows Calendars.Read + Tasks.Read + offline_access only
- After consent, Settings → MS section says "Microsoft 365 connected · <name>"
- Click Disconnect → row removed; MS section reverts to "Connect"
- Re-sign in → no double-link

---

## Gap 2 — Settings has NO iCal subscription form

### Symptom

iCal infra is fully wired: `lib/integrations/ical/{parser,queries,sync}.ts`, `app/api/cron/ical-sync/route.ts` (6h cadence), `icalSubscriptions` table at `lib/db/schema.ts:1453+`, ETag conditional GET, 3-failure auto-deactivate. But there's **no visible URL paste form in Settings → Connections** (the gap audit could not find one). Users who skipped onboarding Step 2 cannot add an iCal feed afterwards.

### Investigation step (do this first)

Verify whether the form exists somewhere else — possibly under a `#ical` fragment, a sub-route like `/app/settings/integrations`, or only on the onboarding page. Grep:

```
grep -rn "icalSubscriptions\|ical_subscription\|paste.*ical\|ical.*url" \
  app/ components/ --include="*.tsx" --include="*.ts"
```

If the form exists but is hard to reach: route-link it from Settings → Connections.

If it doesn't exist anywhere except onboarding: build the form on the Settings → Connections page, mirroring the existing Notion add-resource pattern. Spec:

- Input: text field accepting `webcal://`, `https://`, `http://` URLs
- Validation (server-side): URL parses; reachable; returns valid VCALENDAR header on probe; SSRF guard via existing `lib/utils/ssrf-guard.ts`
- Submit: insert into `icalSubscriptions` (label = derived from feed `X-WR-CALNAME` if present, else hostname), trigger immediate first sync via the existing sync helper
- List existing subscriptions below the form: label, URL preview, last-sync time, status (active / deactivated-with-error), Reactivate button (clears `failureCount` → triggers next sync), Remove button

Copy: simple, neutral. "Paste a calendar feed URL (.ics) — Steadii will read events from it every 6 hours." The contextual trigger copy (`sources.ts:34-35` + `contextual-suggestion.tsx:40`) is verified neutral; mirror that voice.

### Verify

- Settings → Connections shows iCal section with input form
- Paste a real iCal URL (UToronto Acorn export, or any public test feed) → row appears in list, sync runs, events appear in `/app/calendar`
- Paste invalid URL → friendly error, no row inserted
- Paste `webcal://...` → normalized to https before storing
- Reactivate button on a deactivated row resets failureCount, triggers sync

---

## Gap 3 — Notion import action missing from Settings (low priority but in scope)

### Symptom

Notion import is implemented (`lib/integrations/notion/import-to-postgres.ts`) but the Settings → Connections "Notion connected" view (when a user has linked Notion) doesn't expose a way to **trigger** the import. The contextual trigger on the mistakes tab gives users one entry point, but a returning user who connected Notion via Step 2 has no Settings-side button.

### Fix

In the Notion section of Settings → Connections, when Notion is connected, add an "Import from Notion" button. On click, calls a server action that runs `runNotionImportToPostgres({ userId })` (or whatever the existing function is named — verify in `lib/integrations/notion/import-to-postgres.ts`). Show progress / completion via toast or inline status.

If the import is long-running, queue it (existing QStash pattern) and show "Import in progress — we'll notify when complete" instead of blocking.

### Verify

- User with linked Notion + at least one Steadii parent page sees the "Import from Notion" button in Settings
- Click → import runs, mistake_notes / syllabi rows appear in Postgres, toast confirms

---

## Gap 4 — Verify `onboarding_integrations_skipped_at` column + persist behavior

### Investigation

The audit could not confirm: (a) the column exists in `users` table schema, (b) the skip action persists the timestamp correctly, (c) the onboarding page guard reads it correctly to never re-show the page.

Steps:

1. Read `lib/db/schema.ts` — find `users` table, confirm `onboarding_integrations_skipped_at` column exists (timestamp, nullable).
2. Find the skip action handler (likely `app/(auth)/onboarding/actions.ts` `skipIntegrationsStepAction` or similar). Verify it sets the column to `now()`.
3. Find the onboarding page guard (likely `app/(auth)/onboarding/page.tsx`). Verify it checks the column + redirects past Step 2 if set.
4. If any of these is missing, add it. If column is missing, write a Drizzle migration.

### Verify

- New user: complete Step 1 (Google) → land on Step 2 (Optional integrations) → click Skip → redirected to `/app` → re-visit `/onboarding` → bounces straight to `/app` (does NOT show Step 2 again)
- Already-onboarded user: visiting `/onboarding` doesn't loop them back through Step 2

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Conversation Japanese; commits + PR body English
- Don't push without Ryuto's explicit authorization
- MS scope stays Calendar + To Do (NOT Mail) per `project_ms_graph_scope.md`

---

## Verification plan

After implementing all four:

1. `pnpm typecheck` — clean
2. `pnpm test` — all green
3. Manual smoke per Gap 1, 2, 3, 4 verify sections above
4. Confirm onboarding regression check (returning user with Step 2 already skipped doesn't get pushed back)

---

## Context files to read first

- `app/app/settings/page.tsx` — Settings → Connections target file (Gaps 1, 2, 3)
- `lib/auth/config.ts` (lines 50-68) — MicrosoftEntraId provider config
- `lib/integrations/microsoft/{graph-client,calendar,tasks}.ts` — MS Graph client
- `lib/integrations/ical/{parser,queries,sync}.ts` — iCal infra
- `lib/integrations/notion/import-to-postgres.ts` — Notion import function
- `lib/db/schema.ts` — `users` table (Gap 4) + `icalSubscriptions` table + `accounts` table
- `app/(auth)/onboarding/page.tsx` + `app/(auth)/onboarding/actions.ts` — Gap 4
- `lib/utils/ssrf-guard.ts` — for iCal URL validation
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_ms_graph_scope.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md` (W-Integrations bullet)

---

## When done

Report back with:

- Branch name + final commit hashes (per-gap commits OK)
- Verification log (typecheck, tests, manual smoke for all 4 gaps)
- Any deviations from this brief + 1-line reason each
- **Memory entries to update** (per AGENTS.md §12):
  - For each memory entry the work has shipped/obsoleted/contradicted: file + section + suggested change
  - If none, write "none"

Likely candidates: `project_steadii.md` W-Integrations bullet — flip "Verification status" subline from "no dedicated dogfood report yet" to a more accurate state once these gaps are fixed.
