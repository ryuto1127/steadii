# Steadii Phase 6 W1 — Gmail OAuth + L1 Triage + Inbox Schema + First-24h Ingest

## Context

You are the implementation engineer for Steadii. This is **W1 of Phase 6** (the agent core), the first week of a 4-week plan:

- **W1 (this prompt)**: Gmail OAuth, L1 rule-based triage, Inbox schema, first-24h ingest on signup
- W2: L2 LLM (classify + draft) + credit-enforcement bridge hookup
- W3: Confirm UX + 7am email digest + Settings → Agent Rules page + Inbox item-detail view
- W4: Staged autonomy rollout + dogfood metrics

Phase 5 (Billing) is complete. Pre-W1 read-only scoping is complete and lives at `docs/handoffs/phase6-prew1-scoping.md` — **read that file first**; it is the authoritative map of current repo state and the gaps you are closing.

## Read before starting

Auto-memory (under `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/`):

- `MEMORY.md` — index
- `project_steadii.md` — product overview, phase state
- `project_agent_model.md` — **authoritative agent design**: risk-tiered autonomy, L1 bucket definitions (IGNORE / AUTO_HIGH / AUTO_MEDIUM / AUTO_LOW), L2 split, Gmail/CASA decision, safety/undo policy
- `project_decisions.md` — pricing + model routing + tier capabilities (W1 does not touch these but they frame W2)
- `project_pre_launch_redesign.md` — Inbox is the 5th sidebar item at top with `g i` shortcut; Geist typography; amber accent; Lucide icons only; no emoji; empty-state pattern "fact → next action"
- `feedback_role_split.md` — you are the engineer; do not re-spar scope
- `feedback_prompts_in_english.md` — English prompts/code/commits, Japanese only when talking to Ryuto

Repo files:

- `docs/handoffs/phase6-prew1-scoping.md` — the scoping report. **Every claim in this W1 prompt is traceable to a specific finding there.** If a claim seems wrong, trust current code and flag it before diverging.
- `AGENTS.md` — repo conventions (tests, migrations, audit log)
- `lib/db/schema.ts` — current schema head
- `lib/integrations/google/calendar.ts` — the pattern to mirror for `gmail.ts`
- `lib/auth/config.ts` — scope list edit target
- `lib/auth/encrypted-adapter.ts` + `lib/auth/oauth-tokens.ts` — token encryption (inherited for free by Gmail)

## Decision precedence — READ THIS CAREFULLY

**The memory files `project_agent_model.md` and `project_decisions.md` are authoritative.** Existing code may conflict with them — the scoping doc section 2.8 enumerates twelve `C1`–`C12` conflicts. Your W1 scope handles **C1 + C2 + C3** explicitly (onboarding adds Gmail, Notion becomes optional, sidebar grows to 5). The rest are W2/W3/W4 work; do not "drive-by fix" them.

**When conflict occurs within W1 scope, fix the code, not the decisions.** Examples:

- The onboarding flow currently requires Notion (`lib/onboarding/is-complete.ts:7-9`). Memory says Notion is optional. You rewrite `isOnboardingComplete()` to require only `gmailConnected + calendarConnected`; Notion stays connectable but non-blocking.
- The sidebar has 4 items. Memory locks 5. You add Inbox at index 0.

**Exception — escalate first** only when the conflict requires a large strategy shift: rewriting the auth stack, renaming public routes with external consumers, irreversible data migrations. None of W1's work reaches that bar.

## Scope of W1 (strictly)

**In scope:**

1. **Gmail scopes on OAuth consent.** Add `gmail.modify` + `gmail.send` to the single consent screen at `lib/auth/config.ts:26`. Upfront, not progressive (memory locked).
2. **`lib/integrations/google/gmail.ts`** + `GmailNotConnectedError`, modeled on `calendar.ts`. Expose `getGmailForUser(userId)`.
3. **Optional refactor: `lib/integrations/google/_oauth-client.ts`** — shared OAuth2 client factory to deduplicate the same pattern already copy-pasted in `calendar.ts`, `classroom.ts`, `tasks.ts`. Only do this if the diff stays under ~150 lines net; skip if it balloons.
4. **Gmail fetcher**: `lib/integrations/google/gmail-fetch.ts` exporting `listRecentMessages(userId, sinceTs)` and `getMessage(userId, messageId)`. Pagination + Sentry-wrapped errors.
5. **Schema migration (`0013_*.sql`)** adding three new tables (`inbox_items`, `agent_rules`, `agent_drafts`) and two new `users` columns (`digest_hour_local`, `digest_enabled`). Exact DDL in §"Schema" below.
6. **L1 rule registry**: `lib/agent/email/rules.ts` — pure functions, EN+JA keyword lists per memory §"Triage L1 rules".
7. **L1 triage entry point**: `lib/agent/email/triage.ts` exporting `triageMessage(userId, gmailMsg)` and `applyTriageResult(userId, gmailMsg, result)`.
8. **First-24h ingest**: `lib/agent/email/ingest-recent.ts` exporting `ingestLast24h(userId)`. Hook into the post-onboarding redirect so first dashboard load isn't empty.
9. **Sidebar: 5 items with Inbox at top**. Edit `components/layout/nav-items.ts` + the `ICONS` map in `components/layout/sidebar-nav.tsx`. `g i` shortcut. Lucide `Inbox` icon. Update existing sidebar tests.
10. **Inbox route shell**: `app/app/inbox/page.tsx` — server component rendering a Raycast-style list of `status='open'` items. No item-detail page. Empty state: "You're clear." (factual + light) when no items; "Connect Gmail to start triage." when Gmail scope not granted.
11. **Onboarding rewrite (option B — see Decisions below)**: add Gmail as an explicit step; flip Notion from required to optional in the same change. Update `lib/onboarding/is-complete.ts`.
12. **Re-auth banner** in `app/app/layout.tsx`: detect existing users whose `accounts.scope` lacks Gmail, show a dismissible banner prompting re-sign-in. One query on layout render; cache per-request.
13. **Audit logging**: every email-side write (`inbox_items` insert, rule application, ingest run, ingest failure) emits an `audit_log` row. Add `lib/agent/email/audit.ts` helper for consistency.
14. **New TaskType entries**: add `email_classify` + `email_draft` to `lib/agent/models.ts` `TaskType` union and `taskTypeMetersCredits()`. W1 doesn't emit these, but landing the types now avoids a W2 tree-shaking churn.
15. **Tests**: L1 rule unit tests (≥1 positive + ≥1 negative per bucket), sidebar test updates, onboarding-status test update, Gmail fetcher stubbed against JSON fixtures under `tests/fixtures/gmail/`.
16. **Sentry instrumentation** around every Gmail API call, tagged with user id.

**Explicitly out of scope for W1 — do not implement, do not stub in W1 files:**

- L2 LLM classify or draft — W2. No OpenAI calls on the email path in W1.
- Credit enforcement hookup (`assertCreditsAvailable` callsites) — W2. L1 is free.
- Per-feature pause on credit exhaustion — W2.
- Item-detail page for inbox items — W3.
- 7am email digest + Resend/Postmark vendor pick + cron — W3.
- Header notification bell — W3.
- Home Dashboard 4th "pending: N" card — W3.
- Settings → Agent Rules transparency section — W3.
- `gmail_send` tool + 20s undo window + `send_queue` table — W3.
- Staged autonomy rollout gates — W4.
- Pub/Sub watch for ongoing ingest (W1 ships one-shot first-24h only; ongoing ingest lands later)
- CASA verification — post-W4 operator task
- Any change to `events` table or `source_type` enum — inbox items live in their own table
- Multi-language keyword expansion beyond EN + JA — post-α
- Custom Gmail labels (e.g. "Steadii/Triaged") — not locked in memory; don't invent

## Concrete decisions handed over

The scoping doc surfaced six Open Questions. Sparring side resolved them as follows — do not re-litigate:

1. **Onboarding: option B** — insert Gmail as an explicit step AND flip Notion required → optional in the same change. Full 3-step memory-locked rewrite stays W3 work.
2. **Ignore-bucket retention: yes, store.** Persist ignored items with `bucket='ignore'` and `status='dismissed'` at insert time. 30-day prune is NOT shipped in W1 (no cron yet). Leave rows; W3/W4 will add the prune job.
3. **Ongoing ingest mechanism (Pub/Sub vs poll): not W1.** One-shot first-24h only. Flag in a short "W3 operator prep" note appended to the scoping doc if Pub/Sub is the likely answer.
4. **Notion reconnect → re-ingest emails: no.** Out of scope.
5. **Sidebar visibility for Gmail-not-connected users: option (a) — always show Inbox.** Empty state copy: "Connect Gmail to start triage." with a link to `/app/settings` (or the re-auth banner action).
6. **Audit log volume: fine for α.** Do not pre-optimize.

**Additional locked decisions (from memory, restated for hand-off clarity):**

- **Environment: TEST MODE.** Google Cloud Console stays in "Testing" app-verification state for W1 + all α. Add Ryuto's own account (`admin@example.com`) to the test-user list before running `ingestLast24h` end-to-end. **Do not flip to "In production" or file for verification during W1** — that is a CASA Tier 2 task post-W4.
- **Currency / pricing: N/A to W1.** No billing code changes.
- **Dogfood user: Ryuto is `is_admin=true`.** Admin users see the Inbox item like everyone else; admin bypass (unlimited credits) is a W2 concern, not a W1 concern.
- **Encryption: inherited.** `scope` is a plain-text column on `accounts`; tokens are already encrypted by `EncryptedDrizzleAdapter`. Do not invent a second encryption layer for Gmail.
- **No custom Gmail labels in W1.** Only read + draft creation (W2+). No label mutations.
- **First-time sender detection** lives on `inbox_items.first_time_sender` (boolean, default false, set true if no prior `inbox_items` row for this user exists with the same `sender_domain`). Memory says first-time domain forces high risk — but risk-tier is W2 work; W1 just records the flag.

## Schema

Edit `lib/db/schema.ts`, run `pnpm db:generate`, commit the generated SQL under `lib/db/migrations/0013_<random>.sql`, then `pnpm db:migrate` locally to verify clean apply.

**Conventions (match existing):**

- `uuid` PKs with `defaultRandom()`
- `snake_case` in DB, Drizzle maps to camelCase TS
- `FK ... ON DELETE CASCADE from users`
- `created_at`, `updated_at` on every table
- `deleted_at` soft-delete on user-facing tables (`inbox_items`, `agent_rules`)
- Export `InboxItem`, `NewInboxItem`, `AgentRule`, `NewAgentRule`, `AgentDraft`, `NewAgentDraft` types from `schema.ts` following the `EventRow / NewEventRow` pattern
- JSONB fields need `$type<...>` casts in Drizzle

### Tables

**`inbox_items`** — the agent's queue. One row per Gmail message seen by L1.

Columns (all NOT NULL unless marked nullable):
- `id` uuid PK
- `user_id` uuid FK → users ON DELETE CASCADE
- `source_type` text — literal `'gmail'` for W1
- `source_account_id` text — `accounts.providerAccountId`
- `external_id` text — Gmail message id
- `thread_external_id` text nullable — Gmail threadId
- `sender_email` text
- `sender_name` text nullable
- `sender_domain` text — Postgres `GENERATED ALWAYS AS (split_part(sender_email,'@',2)) STORED`
- `sender_role` text nullable — `'professor'|'ta'|'classmate'|'admin'|'other'`
- `recipient_to` text[] default `'{}'`
- `recipient_cc` text[] default `'{}'`
- `subject` text nullable
- `snippet` text nullable
- `received_at` timestamptz
- `bucket` text — `'auto_high'|'auto_medium'|'auto_low'|'ignore'|'l2_pending'`
- `risk_tier` text nullable — `'low'|'medium'|'high'` (W1 leaves NULL; W2 fills)
- `rule_provenance` jsonb — `$type<RuleProvenance[]>` (array of `{ ruleId, source, why }`)
- `first_time_sender` boolean default false
- `status` text default `'open'` — `'open'|'snoozed'|'archived'|'sent'|'dismissed'`
- `reviewed_at` timestamptz nullable
- `resolved_at` timestamptz nullable
- `created_at`, `updated_at`, `deleted_at`

Constraints:
- UNIQUE `(user_id, source_type, external_id)`

Indexes:
- `(user_id, status, received_at DESC) WHERE deleted_at IS NULL`
- `(user_id, bucket) WHERE deleted_at IS NULL`
- `(user_id, thread_external_id)`

**`agent_rules`** — per-user learned/manual/chat rules only. Globals stay in code (`lib/agent/email/rules-global.ts`).

Columns:
- `id` uuid PK
- `user_id` uuid FK
- `scope` text — `'sender'|'domain'|'subject_keyword'|'thread'`
- `match_value` text — original casing preserved for display
- `match_normalized` text — lowercased/trimmed for index probe
- `risk_tier` text nullable
- `bucket` text nullable
- `sender_role` text nullable
- `source` text — `'learned'|'manual'|'chat'`
- `reason` text nullable — human-readable why
- `enabled` boolean default true
- `created_at`, `updated_at`, `deleted_at`

Constraints:
- UNIQUE `(user_id, scope, match_normalized)`

Indexes:
- `(user_id, scope) WHERE enabled = true AND deleted_at IS NULL`

**`agent_drafts`** — W1 writes no rows; schema lands for W2 to use.

Columns:
- `id` uuid PK
- `user_id` uuid FK
- `inbox_item_id` uuid FK → inbox_items ON DELETE CASCADE
- `classify_model` text nullable
- `draft_model` text nullable
- `classify_usage_id` uuid nullable FK → usage_events ON DELETE SET NULL
- `draft_usage_id` uuid nullable FK → usage_events ON DELETE SET NULL
- `risk_tier` text — `'low'|'medium'|'high'`
- `action` text — `'draft_reply'|'archive'|'snooze'|'no_op'|'ask_clarifying'`
- `reasoning` text nullable
- `draft_subject` text nullable
- `draft_body` text nullable
- `draft_to` text[] default `'{}'`
- `draft_cc` text[] default `'{}'`
- `draft_in_reply_to` text nullable
- `status` text default `'pending'` — `'pending'|'edited'|'approved'|'sent'|'dismissed'|'expired'`
- `approved_at`, `sent_at` timestamptz nullable
- `gmail_sent_message_id` text nullable
- `created_at`, `updated_at`

Indexes:
- `(user_id, status, created_at DESC)`
- `(inbox_item_id)`

**`users` additions:**

```sql
ALTER TABLE users ADD COLUMN digest_hour_local SMALLINT NOT NULL DEFAULT 7;
ALTER TABLE users ADD COLUMN digest_enabled    BOOLEAN  NOT NULL DEFAULT true;
```

W1 does not read these columns. W3 will.

## L1 rule buckets (authoritative spec)

Source: `project_agent_model.md` §"Triage L1 rules". The rule registry in `lib/agent/email/rules.ts` must implement these and only these in W1. Keyword lists are EN + JA.

**IGNORE** (never surface):
- `List-Unsubscribe` header present AND sender domain is in a promo/marketing list (common senders: `mailchimp`, `sendgrid.net`, `mktomail`, `e.*`, `news.*`, etc. — start with a short list, grow later)
- `noreply@` / `no-reply@` / `donotreply@` without action verbs in subject/body
- Gmail-classified spam or promotions category (Gmail API label IDs `SPAM`, `CATEGORY_PROMOTIONS`)
- Auto-reply to user's own send (detect by `In-Reply-To` matching user's own outbound message id — stub for W1, just use a simple "from-self" check)

**AUTO_HIGH** (strict; L2 cannot downgrade — W1 just records, W2 enforces):
- Keywords: `plagiarism`, `misconduct`, `academic integrity`, `剽窃`, `不正行為`, `学術不正`
- Grade terms: `grade appeal`, `final grade`, `transcript`, `GPA`, `成績`, `単位`, `評定`
- Research hierarchy: from/CC matches a registered supervisor/PI/lab director (W1 has no registration UI; check the `agent_rules` table for user-learned rules with `sender_role='professor'` or `sender_role='admin'` — empty for now)
- Scholarship/financial aid: `scholarship`, `financial aid`, `renewal`, `tuition`, `奨学金`, `学費`
- Recommendation letters: `recommendation letter`, `reference letter`, `推薦状`
- Grad school: `graduate school`, `grad school application`, `admissions`, `大学院`
- Internship/job: `internship offer`, `interview invitation`, `job offer`, `インターン`, `面接`, `内定`
- **First-time sender domain** (no prior `inbox_items` row for this user with this `sender_domain`)

**AUTO_MEDIUM**:
- Sender domain matches `agent_rules` row with `sender_role in ('professor','ta')`
- Subject contains `extension`, `reschedule`, `office hour`, `due`, `deadline`, `締切`, `延長`, `オフィスアワー`
- Question marks in subject + from known education domain (`.edu`, `.ac.jp`, `.ac.uk`) — W1 heuristic

**AUTO_LOW**:
- TA office-hours confirmation patterns
- Club RSVPs (heuristic: subject contains `RSVP`, `meeting`, `club`, subject/body short)
- Course announcements (from known course-domain pattern + subject lacks question mark)
- Short acknowledgments (body under 50 chars, no action verbs)

**→ L2 (`bucket = 'l2_pending'`)**: anything not matching above. W1 does not call L2; the row is inserted with `bucket='l2_pending'` and the Inbox UI shows it as "awaiting classification" style. Memory target is L2-referral rate **<20%**.

**Bucket resolution order:** IGNORE → AUTO_HIGH → AUTO_MEDIUM → AUTO_LOW → L2_PENDING. First match wins. Record every matched rule (not just the winning one) in `rule_provenance` so the W3 Settings transparency UI can show the full chain.

## Implementation order

Each step sized to roughly half a day. Do not bundle.

1. **Gmail scopes** — `lib/auth/config.ts:26` edit; add `gmail.modify` + `gmail.send` to the scope string.
2. **`lib/integrations/google/gmail.ts`** with `getGmailForUser()` + `GmailNotConnectedError`. Mirror `calendar.ts` exactly; refresh-token callback handler included.
3. **(Optional) `lib/integrations/google/_oauth-client.ts`** — only if net diff < ~150 lines.
4. **Schema: three tables + two user columns** — edit `lib/db/schema.ts`; export types; `pnpm db:generate`; commit the migration; `pnpm db:migrate` locally to verify.
5. **L1 rule registry (`lib/agent/email/rules.ts`)** — pure functions, no I/O. Export: `classifyEmail(gmailMsg, userContext): TriageResult`.
6. **L1 triage entry point (`lib/agent/email/triage.ts`)** — wraps `classifyEmail` + writes to DB + emits audit. Export: `triageMessage`, `applyTriageResult`.
7. **Gmail fetcher (`lib/integrations/google/gmail-fetch.ts`)** — `listRecentMessages`, `getMessage`, with pagination + Sentry wrapping. Rate-limit back-off: respect `429` + `Retry-After` header.
8. **First-24h ingest (`lib/agent/email/ingest-recent.ts`)** — orchestrates fetch → triage → apply. Idempotent via the unique constraint on `(user_id, source_type, external_id)`.
9. **Onboarding (option B)** — add Gmail connect step; flip Notion to optional; update `isOnboardingComplete()` to require `gmailConnected && calendarConnected` only.
10. **Onboarding → ingest hook** — call `ingestLast24h(userId)` as a fire-and-forget server action on the "finish onboarding → /app" transition. Don't block the redirect on the ingest.
11. **Sidebar: 5 items + `g i`** — `nav-items.ts`, `sidebar-nav.tsx` ICONS map; update `tests/sidebar-active.test.ts` + `tests/sidebar-keyboard-nav.test.ts`.
12. **Inbox route shell** — `app/app/inbox/page.tsx`, server component, query `inbox_items`, render list, empty state branches.
13. **Re-auth banner** — detect pre-Gmail users in `app/app/layout.tsx`; show dismissible banner. Dismissal state in `localStorage` (client-side) is fine for α.
14. **Audit log helper** — `lib/agent/email/audit.ts`; use from steps 6, 8.
15. **TaskType additions** — `lib/agent/models.ts` `TaskType` + `taskTypeMetersCredits()`.
16. **Sentry instrumentation** — wrap Gmail calls with `Sentry.startSpan` + `Sentry.captureException` on catch.
17. **Tests** — L1 rules (per-bucket pos + neg), sidebar, onboarding-status, fetcher with JSON fixtures under `tests/fixtures/gmail/`.
18. **Typecheck + test + build** — `pnpm typecheck && pnpm test && pnpm build`. Fix drift.
19. **Manual smoke** — fresh test-user signup → grant Gmail → onboarding completes → `/app` loads → `/app/inbox` shows populated items matching expected bucket distribution.

## Test expectations

- **Unit tests for `classifyEmail`**: one positive + one negative case per bucket (IGNORE, AUTO_HIGH, AUTO_MEDIUM, AUTO_LOW, L2_PENDING fallback). Use real-shape Gmail JSON payloads from `tests/fixtures/gmail/`.
- **Fetcher tests**: stub `googleapis` response, verify pagination loop terminates, verify `429` + `Retry-After` is honored.
- **Ingest tests**: fixture-driven end-to-end of `ingestLast24h` with in-memory mock DB; verify idempotency on re-run.
- **Sidebar tests**: existing `tests/sidebar-active.test.ts` + `tests/sidebar-keyboard-nav.test.ts` updated to assert 5 items, Inbox at index 0, `g i` mapping.
- **Onboarding-status test**: `lib/onboarding/is-complete.test.ts` (may need creation) — Notion-missing returns true, Gmail-missing returns false.
- **No integration tests** hitting real Postgres or real Google. Match AGENTS.md §10 pattern.
- **Target**: all green. No test-skipping, no `it.todo`.

## Commit strategy

Follow the repo's existing per-feature commit style (see `git log --oneline -20` for examples like `feat(billing): /invite/<code> landing`). Suggested split:

1. `feat(auth): add Gmail scopes to OAuth consent`
2. `feat(integrations): add Gmail client with refresh handling`
3. `feat(db): add inbox_items, agent_rules, agent_drafts tables + digest columns`
4. `feat(agent): L1 email triage rules + registry (EN+JA)`
5. `feat(agent): first-24h Gmail ingest on signup`
6. `feat(onboarding): add Gmail step; Notion becomes optional`
7. `feat(ui): Inbox sidebar item + inbox route shell`
8. `feat(ui): re-auth banner for pre-Gmail users`
9. `test(agent): L1 triage fixtures and per-bucket cases`
10. `chore(observability): Sentry spans around Gmail API calls`

Each commit should pass `pnpm typecheck && pnpm test` independently. Do not squash before review — Ryuto wants to read them one at a time.

## Success criteria / deliverable

W1 is done when:

- [ ] `pnpm typecheck && pnpm test && pnpm build` all green
- [ ] Ryuto can sign up fresh (or re-auth his admin account), go through onboarding, and land on `/app` with `/app/inbox` populated by the last 24h of his Gmail, correctly bucketed
- [ ] Inbox sidebar item is at position 0, `g i` works
- [ ] `/app/inbox` empty state shows "Connect Gmail to start triage." for users who haven't granted scope (test with a second test account)
- [ ] Re-auth banner shows for pre-Gmail users and goes away after re-consent
- [ ] Per-bucket count distribution on Ryuto's inbox is sanity-checked manually — report numbers in the PR description
- [ ] All 10+ commits on a single branch off `main` named `phase6-w1`
- [ ] PR opened via `gh pr create` with a test-plan section (see AGENTS.md if it specifies PR body shape)

When you believe W1 is complete, output a short status to Ryuto: branch name, PR URL, per-bucket count on his inbox, any locked-decision conflicts you hit. Do **not** merge the PR yourself — Ryuto reviews.

## If you get stuck

- **Locked-decision conflict not listed in C1–C12**: stop, surface to Ryuto with a 3-line summary and two options.
- **Google API behavior diverges from scoping doc assumption** (e.g. `prompt: "consent"` does not re-issue scope as expected): document in the PR description, proceed with the workaround that preserves the memory-locked UX (single upfront consent).
- **Schema DDL diverges from memory's intent** (e.g. generated column syntax fails in Postgres 15 vs 16): simplify — drop the generated column, compute `sender_domain` in application code. Don't stall on it.
- **Test flakes around real-time fixtures**: use fixed timestamps, not `new Date()`.
- **`ingestLast24h` takes >10s for a heavy inbox**: that's fine for W1. Add a `console.warn` with duration; optimization is W3.
