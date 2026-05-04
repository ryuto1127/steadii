# Post-α #5 — Weekly retrospective digest + in-app Activity page

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md` — secretary positioning, α target, Gmail-first
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md` — pure secretary not tutor; retention via recurring touchpoints
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — flag the migration so sparring runs `pnpm db:migrate` post-merge
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`

Reference shipped patterns:

- `lib/digest/build.ts` — daily morning digest (subject building / EN+JA / HTML+text / Resend dispatch). Mirror its shape for weekly.
- `app/api/cron/digest/route.ts` — QStash-triggered cron with `withHeartbeat` + Sentry span + per-user error isolation. Same skeleton for weekly.
- `lib/digest/picker.ts` — eligibility scan by local-hour-cross. Extend for weekly cadence.
- `components/agent/recent-activity.tsx` — Home footer 10-item activity. Extract its query into a shared loader and reuse on the new full-page view.

---

## Strategic context

α retention depends on recurring touchpoints. The daily morning digest is transactional ("here's what's pending"). What's missing is a **weekly retrospective** — the moment users stop and feel "Steadii actually did a lot for me this week" → trust + social-proof + retention compound.

Pair with an in-app **Activity page** (`/app/activity`) that surfaces the same audit data without the 10-item footer cap, so users can see Steadii's full work record any time.

This PR ships **both halves** because they share the same query layer (audit_log + drafts + proposals) and shipping them together avoids duplicating the data plumbing.

**Out of scope** (defer to follow-up cycles):
- "What Steadii learned about you" (`agent_rules` viewer) — engineer-31 candidate
- Week-ahead deadline preview in the Sunday email — Sparring may add inline post-merge
- Mobile-specific layout — broader mobile pass is a separate cycle
- Real-time activity stream — current pull-on-load is fine for α scale

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected: PR #135 commit `84b2c48` or any sparring inline after this handoff doc lands. If main isn't there, **STOP**.

Branch: `post-alpha-5-weekly-activity`. Don't push without Ryuto's explicit authorization.

---

## Feature 1 — Weekly retrospective digest (Sunday 5pm local)

### Behavior

New cron runs hourly (same QStash schedule as daily digest, separate route). For each user whose local Sunday-17:00 crossed into the current tick AND whose `weekly_digest_enabled = true` AND who hasn't received a weekly in the last 6 days:

1. Aggregate the trailing 7-day window from:
   - `audit_log` rows with `action IN ('auto_archive', 'calendar_event_imported', 'syllabus_event_imported')` → counts
   - `agent_drafts` rows with `status='sent'` (manual + auto) and `status='dismissed'` → counts
   - `agent_proposals` rows with `status='resolved'` → count
2. Pick "top 3 moments" — heuristic:
   - HIGH-risk-tier drafts that user sent unmodified (= Steadii nailed a hard one) → priority 1
   - Drafts/proposals with deadline keywords in subject (`deadline`, `due`, `期限`, `締切`, `提出`, `submit`) → priority 2
   - Calendar imports from syllabus (= proactive catch) → priority 3
3. Compute conservative time-saved estimate:
   - Each archived: 8s
   - Each draft sent unmodified: 75s
   - Each draft sent after edit: 25s
   - Each calendar import: 45s
   - Each proposal resolved: 30s
   - Sum → render as "~Nm Ks"
4. Render Sunday-evening tone email + send via Resend

If aggregate counts are all zero (genuinely empty week — onboarding-day-1 user, etc.) → suppress send. Don't email "you did nothing this week".

### Email content

**Subject** (locale-aware, content-aware):
- EN heavy week: `Your week with Steadii — 47 archived, 12 drafted, 3 deadlines caught`
- EN light week: `A quiet week — Steadii did 8 things`
- JA heavy week: `今週の Steadii — 47 件アーカイブ、12 件下書き、締切 3 件キャッチ`
- JA light week: `静かな週でした — Steadii は 8 件対応`

**Body sections** (in order):
1. **Stats grid** — archived / drafted / sent / deadlines caught + time-saved estimate
2. **Top 3 moments** — narrative bullets ("Caught the ECON 200 essay due Friday before you noticed", "Drafted the reply to Prof. Tanaka while you were in class")
3. **CTA** — "See the full activity log →" linking to `/app/activity?utm_source=weekly_digest`

No deep-links into individual drafts (this is retrospective, not actionable).

### Files

- `lib/digest/weekly-build.ts` — `buildWeeklyPayload(userId)` + `buildWeeklySubject` + `buildWeeklyText` + `buildWeeklyHtml`
- `lib/digest/weekly-picker.ts` — `pickEligibleUsersForWeeklyTick(tickAt)` + `markWeeklyDigestSent`
- `lib/digest/time-saved.ts` — `estimateSecondsSaved(stats)` (pure, unit-tested)
- `lib/digest/top-moments.ts` — `selectTopMoments(rows, limit=3)` (pure, unit-tested)
- `app/api/cron/weekly-digest/route.ts` — QStash route mirroring `app/api/cron/digest/route.ts` (heartbeat + Sentry + per-user isolation)

### QStash registration

Document in DEPLOY.md / handoff final-report which QStash schedule to add (mirror the daily digest cadence: hourly POST). Sparring will add the QStash schedule via console post-merge.

---

## Feature 2 — In-app Activity page (`/app/activity`)

### Behavior

Full-page version of the existing `recent-activity.tsx` footer. Same data sources, no 10-item cap.

### Layout

- **Stats card at top** — 4 mini-cards horizontally: This Week / This Month / All Time / Time Saved (the same `time-saved.ts` calc, scoped per range)
- **Timeline below** — grouped by day (e.g. "Today", "Yesterday", "Wed May 1", ...), each entry rendered like the existing footer rows but with full subject + sender visible
- **Pagination** — load 30 rows initially, "Load more" button appends next 30. Server action for the cursor query.
- **Empty state** — when user has no audit data yet: "Steadii hasn't done anything yet — connect Gmail to get started" with link to `/app/settings` if Gmail not connected, else "Your first ingest will appear here"

### Files

- `app/app/activity/page.tsx` — server component, top stats + initial 30 rows
- `app/app/activity/_components/activity-stats-card.tsx`
- `app/app/activity/_components/activity-timeline.tsx`
- `app/app/activity/_components/activity-load-more.tsx` — client component for pagination
- `app/app/activity/actions.ts` — `loadActivityPage(cursor)` server action
- `lib/activity/load.ts` — extract the unified-row query from `recent-activity.tsx` into a reusable loader (`loadActivityRows({userId, since, until, limit, cursor})`). Refactor the existing footer to call this loader.

### Sidebar entry

Add "Activity" link to the sidebar (between existing entries — engineer judges where it fits the IA). Pattern: same NavLink component the other items use.

---

## Schema migration `0030_post_alpha_5_weekly_activity.sql`

Additive only:

```sql
ALTER TABLE users ADD COLUMN weekly_digest_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN weekly_digest_dow_local smallint NOT NULL DEFAULT 0; -- 0=Sun … 6=Sat
ALTER TABLE users ADD COLUMN weekly_digest_hour_local smallint NOT NULL DEFAULT 17; -- 5pm
ALTER TABLE users ADD COLUMN last_weekly_digest_sent_at timestamptz;
```

No new tables. No new indexes (the eligibility scan uses the same shape as the daily picker).

---

## Settings UI

Existing Settings → Inbox or Notifications section gains a toggle:
- Label: "Weekly Sunday recap email" / 「週次の振り返りメール (日曜)」
- Default ON (this is the retention hook — don't gate it behind opt-in for α)
- Sub-line: "Sent every Sunday at 5pm in your timezone with what Steadii did this week."

Place it directly below the existing "Daily morning digest" toggle so they read as a pair.

---

## Tests

Aim: existing 886 stay green, +18 new across 4 files → **904+** total.

- `tests/weekly-digest-time-saved.test.ts` (~5 tests) — `estimateSecondsSaved` matrix; zero-input → 0; reasonable-week → expected sum; large-week → no overflow
- `tests/weekly-digest-top-moments.test.ts` (~5 tests) — high-risk-sent-unmodified beats deadline-keyword beats calendar-import; ties break by recency; cap at 3
- `tests/weekly-digest-build.test.ts` (~4 tests) — payload assembly EN + JA, subject heavy/light variant, suppress when all-zero
- `tests/weekly-digest-picker.test.ts` (~4 tests) — Sunday-17:00 local cross fires; non-Sunday tick skips; already-sent-this-week skips; respects toggle off

Activity page query is exercised by existing `recent-activity` tests + a smoke test in `tests/activity-page-smoke.test.ts` if needed.

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` in BOTH locales (EN + JA). Required:

- Weekly digest email — heavy week (EN + JA)
- Weekly digest email — light week (EN + JA)
- `/app/activity` page with stats card + timeline (EN + JA)
- `/app/activity` empty state
- Settings toggle (Daily + Weekly toggles visible together)

Generate the digest preview by triggering the cron route locally with a fixture user, capture the rendered HTML in a browser. Don't actually send to Resend in dev (the existing daily-digest pattern uses `console.warn` when `RESEND_API_KEY` unset — same pattern here).

---

## Sequence after merge

1. Sparring runs `pnpm db:migrate` against prod (per `feedback_prod_migration_manual.md`)
2. Sparring adds QStash schedule entry pointing at `/api/cron/weekly-digest` (hourly POST). The internal Sunday-17:00 cross is the gate, not the QStash cadence.
3. Wait for first Sunday tick post-deploy → verify Resend logs show send + audit_log entries marked
4. Monitor `/api/health` heartbeat for `weekly-digest` cron name
5. After first 2 weekly cycles, evaluate engagement (open rate via Resend dashboard if available; otherwise inferred from `/app/activity` traffic spike Sunday evenings)

---

## Final report (per AGENTS.md §12)

- Branch / PR: `post-alpha-5-weekly-activity`
- Schema migration filename + columns added
- Cron route registered + heartbeat name + QStash registration instructions
- Tests added (4 files, +18 tests target)
- Screenshots: 7 pairs minimum (5 from Verification list × EN/JA where applicable)
- **Migration flag**: yes — `lib/db/migrations/0030_post_alpha_5_weekly_activity.sql`. Sparring applies post-merge.
- **Memory entries to update**: `project_steadii.md` α-launch surface list should mention weekly digest. `project_decisions.md` if any new locked decision (e.g. weekly default-ON gate).
- **Out-of-scope flags**: anything that wanted to be done but is engineer-31 / future cycle.
- **Open questions for sparring**: anything where the spec was ambiguous and engineer made a judgment call.
