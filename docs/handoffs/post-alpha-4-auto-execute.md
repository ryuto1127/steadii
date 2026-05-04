# Post-α #4 — Auto-execute Tier 2 / Tier 3

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — risk-tier model (AUTO_HIGH / AUTO_MEDIUM / AUTO_LOW), 10s undo window, hierarchy CC detection, classification error budget, "any single regret incident → agent send capability disabled" rollback policy
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_5_design.md` — Tier 1 (auto-archive) shipped pattern; "Auto-execute Tier 2 / 3 → post-α #4" line is what this PR cashes in
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — flag any new migration so sparring runs `pnpm db:migrate` post-merge
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`

Reference Wave 5's auto-archive implementation as the structural template:

- `lib/agent/email/auto-archive.ts` — `autoArchiveDefaultEnabled()` + `isAutoArchiveEligible()` + `maybeAutoArchive()` 3-gate pattern
- `lib/agent/email/audit.ts` + `lib/agent/dogfood/activation.ts`
- `lib/db/migrations/0029_wave_5_launch_prep.sql` — additive migration shape (new columns + new table + partial index)
- `app/app/settings/page.tsx` Inbox section — toggle + safety-ramp note pattern
- `app/app/inbox/page.tsx` — `Hidden ({n})` filter chip + restore action wiring

This PR ships the **infrastructure** for Tier 2 / Tier 3 auto-execution behind an env flag default OFF, gated to flip ON only after Wave 5's safety ramp completes with regret rate = 0 (per `project_agent_model.md` "medium-risk autonomy gated on post-α regret=0").

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected: commit `1f8726c` polish(app) #134 or any sparring inline landing after. If main isn't there, **STOP**.

Branch: `post-alpha-4-auto-execute`. Don't push without Ryuto's explicit authorization.

---

## Strategic context

Wave 5 shipped Tier 1 auto-archive (`risk_tier='low'` + classifier confidence ≥ 0.95 → silent archive). This PR extends that pattern to two more risk tiers.

**Tier 2** (medium risk, fully reversible, no external party hit):
- A. **Auto-snooze** — useful-but-not-actionable items (course announcements without deadlines, weekly club digests, syllabus update emails that don't add new dates). Snooze for default 7 days, resurface in Inbox.
- B. **Calendar trivial-reschedule auto-confirm** — when a time conflict is detected AND there's an obvious resolution (USER-OWNED event, no external attendees, alternative slot empty in same day), auto-execute the move.

**Tier 3** (medium-high risk, externally visible action):
- C. **Short ack-reply auto-send** — incoming email is clearly a "needs ack" pattern ("got it, thanks", "OK confirmed", "see you then" semantics). Steadii drafts a tone-matched short ack and auto-sends after a 60-second cancellation window.

All three are **opt-in per category**, default OFF, and **invisible until env flag flipped** (the Wave 5 ramp pattern, taken one step further).

---

## Feature 1 — Auto-snooze (Tier 2)

### Behavior

- Triage classifier runs as today → produces `bucket` + `confidence` (already exists from Wave 5)
- New classifier output: `snoozeCandidate: boolean` + `snoozeDays: number` — set true for "useful but not actionable now" patterns. Heuristics:
  - course announcement without action verb
  - weekly digest sender already-confirmed by user
  - syllabus-update notification with no date change (cross-check with `events` table)
- If user has `auto_snooze_enabled = true` AND `snoozeCandidate` AND `confidence ≥ 0.95` AND no `learnedOptOut`:
  - Set `inbox_items.status = 'snoozed'`, `snoozed_until = now() + snoozeDays`, `auto_snoozed = true`
  - Audit log entry: `action='auto_snooze'`
  - When `snoozed_until` passes, cron flips status back to `pending` and fires the standard inbox notification

### UI

- **Inbox filter chip** "Snoozed ({n})" — same pattern as Wave 5 `Hidden ({n})`. Click reveals snoozed items inline; per-row "Restore" action sets `status='pending'` + flags `user_unsnoozed_at`.
- **Settings → Inbox** new toggle: "Auto-snooze items I don't need to see right now" with the safety-ramp note.

### Learning signal

- User unsnoozes a previously auto-snoozed item → insert `agent_rules` row with `risk_tier='medium'` for similar pattern (sender domain + subject keywords). Future similar items: `learnedOptOut=true` → won't qualify.

---

## Feature 2 — Calendar trivial-reschedule auto-confirm (Tier 2)

### Behavior

The Wave 1-3 conflict detector already surfaces time conflicts as Type A queue cards. This adds a pre-card filter: when the conflict is "trivially resolvable", auto-resolve and surface as Type D (post-action) instead of Type A (decision-required).

**Trivially resolvable** = ALL of:
- Both conflicting events are USER-OWNED (no external attendees, no calendar invitees)
- Resolution: move ONE event to an empty slot in the same day, same duration, within the same calendar
- The "to be moved" event has no recurrence (single instance only)
- Confidence: 100% (rule-based, not LLM — either qualifies or doesn't)

If user has `auto_reschedule_enabled = true`:
- Move the event via Google Calendar API
- Insert audit log: `action='auto_reschedule'` with original + new times
- Surface as Type D card in Recent Activity: "Moved 'Study session' from 14:00 → 16:00 (was conflicting with class)"
- 5-minute undo window from the Type D card: "Undo" button calls a server action that moves the event back

If `auto_reschedule_enabled = false` OR conflict isn't trivially resolvable: fall through to the existing Type A queue card behavior (no behavior change).

### UI

- **Settings → Inbox** (or new "Calendar" subsection if cleaner) new toggle: "Auto-resolve obvious calendar conflicts"
- **Recent Activity** Type D entries gain an "Undo" button when `created_at < now - 5 min`. Existing Type D cards in `app/app/page.tsx` already supported this archetype per Wave 2 spec — extend with the `undo` action.

### Learning signal

- User clicks Undo on an auto-rescheduled event → log `user_undid=true` on the audit row. Insert `agent_rules` for similar future pattern (e.g. specific event title or recurring class) so they won't auto-resolve.

---

## Feature 3 — Short ack-reply auto-send (Tier 3)

### Behavior

This is the highest-risk category — externally visible action. **Most paranoid safety design.**

Triage classifier extension: detect `ackOnly: boolean` for incoming emails that match clear "needs ack" patterns:
- Confirmations: "Got it, see you Thursday at 10" / "Sounds good" / "Confirmed"
- Schedule acks: "OK, 14:00 works for me" / "I'll be there"
- Receipt acks: "Thanks for sending" / "Received, will review"

If user has `auto_reply_enabled = true` AND `ackOnly` AND `confidence ≥ 0.98` (note: higher than Tier 1/2) AND sender is in user's confirmed-contacts list AND email is NOT in AUTO_HIGH bucket (academic integrity / grades / hierarchy / first-time domain):

1. Steadii drafts a tone-matched short ack reply (same model used today for draft generation)
2. Insert row in NEW `pending_auto_actions` table:
   ```
   id | user_id | kind ('auto_reply') | inbox_item_id | draft_id | executes_at (now+60s) | cancelled_at | executed_at | status
   ```
3. Push notification + in-app toast banner:
   "Steadii will auto-reply 'Got it, see you Thursday' to Prof. Tanaka in 60s. Tap to cancel."
4. New cron `/api/cron/auto-execute-flush` runs every minute: picks rows where `executes_at <= now` AND `cancelled_at IS NULL` AND `executed_at IS NULL` → fires the `send-enqueue` flow → marks `executed_at`
5. If user taps "Cancel" within 60s: `cancelled_at = now`, draft remains in queue as a normal Type B card for manual review

### Settings UI

- **Settings → Inbox** new toggle: "Auto-send short acknowledgment replies"
- **Sub-control**: "Only to:" selector — `confirmed contacts only` (default) | `domain whitelist` (text input)
- **Safety note**: explicit copy that this sends emails on user's behalf with a 60-second cancel window

### Learning signal

- User taps Cancel → log `user_cancelled=true` on the pending row → insert `agent_rules` row downgrading similar future ack patterns from this sender (won't auto-reply next time).
- User sends back a correction email after auto-reply went out (heuristic: outgoing email to same thread within 1h with substantively different content) → log `user_corrected=true` → trigger immediate disable of `auto_reply_enabled` for the user + admin notification (per the rollback policy: "any single regret incident → agent send capability disabled").

### Excluded categories (HARD GATES)

- AUTO_HIGH bucket (any tier above ack)
- First-time sender domain (always confirms per `project_agent_model.md`)
- Threads where any participant matches hierarchy CC detection (supervisor / PI / lab director)
- Threads tagged with academic integrity / grade / scholarship keywords
- Anything where `ackOnly` confidence < 0.98

---

## Schema migration `0030_post_alpha_4_auto_execute.sql`

Additive only:

```sql
-- inbox_items: snooze state
ALTER TABLE inbox_items ADD COLUMN snoozed_until timestamptz;
ALTER TABLE inbox_items ADD COLUMN auto_snoozed boolean NOT NULL DEFAULT false;
ALTER TABLE inbox_items ADD COLUMN user_unsnoozed_at timestamptz;

-- users: 3 new toggles
ALTER TABLE users ADD COLUMN auto_snooze_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN auto_reschedule_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN auto_reply_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN auto_reply_allowed_scope text NOT NULL DEFAULT 'confirmed_contacts';
  -- enum-ish: 'confirmed_contacts' | 'domain_whitelist' | 'off'

-- pending_auto_actions: delay-window queue for tier 3 sends
CREATE TABLE pending_auto_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,  -- 'auto_reply' (extensible for future kinds)
  inbox_item_id uuid REFERENCES inbox_items(id) ON DELETE SET NULL,
  draft_id uuid REFERENCES agent_drafts(id) ON DELETE SET NULL,
  executes_at timestamptz NOT NULL,
  cancelled_at timestamptz,
  executed_at timestamptz,
  status text NOT NULL DEFAULT 'pending',  -- 'pending' | 'executed' | 'cancelled' | 'failed'
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_pending_auto_actions_due
  ON pending_auto_actions (executes_at)
  WHERE cancelled_at IS NULL AND executed_at IS NULL;
```

---

## Code structure

Mirror Wave 5 — pure decision functions + side-effecting wrappers:

- `lib/agent/email/auto-snooze.ts` — `autoSnoozeDefaultEnabled()` / `isAutoSnoozeEligible()` / `maybeAutoSnooze()`
- `lib/agent/calendar/auto-reschedule.ts` — `isTriviallyResolvable()` / `maybeAutoReschedule()` (+ a Google Calendar move helper that records the original event ID for undo)
- `lib/agent/email/auto-reply.ts` — `isAutoReplyEligible()` / `enqueueAutoReply()` (writes `pending_auto_actions` row, doesn't send)
- `lib/agent/auto-execute/flush.ts` — cron handler, picks due rows, executes per `kind`
- `app/api/cron/auto-execute-flush/route.ts` — wraps `flush.ts` with `withHeartbeat` (per Wave 5 cron pattern)

Env flag for the whole subsystem:

```typescript
export function autoExecuteTier23Enabled(): boolean {
  const v = process.env.AUTO_EXECUTE_TIER_2_3_ENABLED;
  return v === "true" || v === "1" || v === "yes";
}
```

Settings toggles only render when this env flag returns true. Until Ryuto flips it post-Wave-5-ramp, the whole subsystem is invisible to users — schema and code shipped but inert.

---

## Tests

- `tests/auto-snooze-classifier.test.ts` — `isAutoSnoozeEligible` matrix (toggle / bucket / confidence / learnedOptOut combinations)
- `tests/auto-snooze-integration.test.ts` — full flow: email arrives → classifier flags → snooze → cron resurfaces → audit log entries
- `tests/auto-reschedule.test.ts` — `isTriviallyResolvable` returns true only for the 4-criteria conjunction; Google Calendar move + undo
- `tests/auto-reply-pending.test.ts` — `enqueueAutoReply` writes pending row with correct `executes_at`; cron flush respects 60s window; cancel within window prevents send; learning-signal insertion on cancel
- `tests/auto-execute-cron-heartbeat.test.ts` — heartbeat row inserted per tick (extends Wave 5 pattern)

Total target: **886 → 916+ tests** (existing 886 stay green, +30 new across 5 files).

---

## Verification

Per AGENTS.md §13, capture screenshots @ 1440×900 in BOTH locales (EN + JA). Required:

- Settings → Inbox section showing 3 new toggles in invisible state (env flag false) — should render as "Coming soon: Tier 2 / Tier 3 auto-execute" placeholder OR not render at all (engineer's call, document the choice)
- Settings → Inbox section with env flag true: 3 toggles + auto-reply scope sub-control + safety note
- Inbox `Snoozed ({n})` filter chip + revealed snoozed items + restore button
- Recent Activity Type D entries with active "Undo" button (auto-reschedule case)
- Auto-reply 60s cancel toast / banner
- Weekly digest extension: "Steadii auto-snoozed N this week / auto-rescheduled N events / auto-replied to N emails"

For env-flag-off captures, use `AUTO_EXECUTE_TIER_2_3_ENABLED=` (unset) in `.env.local`; for env-flag-on captures, set it to `true` and restart dev (`feedback_turbopack_css_cache.md` if CSS changes also stale).

---

## Out of scope

- Auto-decline meeting invites (too high risk, separate cycle)
- Auto-compose substantive replies (NEVER auto without confirm)
- Auto-create calendar events from email (already covered by syllabus auto-import)
- Notion / MS Graph parallel paths (Gmail-first per AGENTS.md §1)
- Mobile shell
- Tier 4 (auto-execute Tier 2 of `risk_tier='medium'` proposals like extension request drafts) — separate post-α cycle if reached

---

## Sequence after merge

1. Sparring runs `pnpm db:migrate` against prod (per `feedback_prod_migration_manual.md`) — additive migration safe to apply
2. Wait for Wave 5 safety ramp window to close (~2026-05-16)
3. Evaluate Wave 5 regret rate: if **0** → flip `AUTO_EXECUTE_TIER_2_3_ENABLED=true` via tiny follow-up PR. If **>0** → defer Tier 2/3 indefinitely, keep env flag false, post-mortem the regret incident first.
4. With env flag true, Settings toggles become visible. Users opt in per category. Each category has its own learning signal feedback loop.
5. Track regret rate per category. Any single regret on Tier 3 (auto-reply) → immediate per-user disable + admin notification per `project_agent_model.md` rollback policy.

---

## Final report (per AGENTS.md §12)

- Branch / PR name: `post-alpha-4-auto-execute`
- Per-feature summary (snooze / reschedule / reply) with screenshot pairs EN+JA
- Schema migration filename + columns/tables added
- Cron registered + heartbeat verified
- Tests added (5 files, +30 tests target)
- **Migration flag**: yes — `lib/db/migrations/0030_post_alpha_4_auto_execute.sql`. Sparring will apply post-merge.
- **Memory entries to update**: `project_wave_5_design.md` post-α queue line "post-α #4" should be marked SHIPPED with the PR sha. Possibly extend `project_agent_model.md` with realized auto-execute behavior once Ryuto flips the env flag.
- **Out-of-scope flags**: anything that wanted to be done but is Tier 4+ or future-cycle.
- **Launch checklist deltas**: any prod-only verification needed before flipping the env flag (e.g. dry-run snooze on Ryuto's account first).
