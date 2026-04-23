# Phase 6 Pre-W1 Scoping Report

Read-only investigation pass for the W1 prompt author. No code, schema, or
Stripe state was changed by this pass. References below are to current
working-tree files (commit `d734310` at investigation time).

---

## 1. Executive summary

- **No Gmail anywhere.** `lib/integrations/google/` ships Calendar, Tasks,
  and Classroom only. The OAuth `authorization.params.scope` string at
  [lib/auth/config.ts:26](lib/auth/config.ts:26) does not request any
  `gmail.*` scope. There is also no `gmail` lib, no `gmail_v1` import, no
  Gmail webhook/Pub-Sub, and no test fixture for Gmail messages.
- **OAuth is single-provider, single-row.** Google data lives in the
  shared `accounts` row keyed by `(provider="google", providerAccountId)`.
  Adding Gmail = mutating that one row's `scope` field, not a new account.
  Refresh-token encryption (`AES-256-GCM`, prefix `enc:v1:`) is already in
  place at [lib/auth/oauth-tokens.ts](lib/auth/oauth-tokens.ts) — Gmail
  inherits it for free.
- **The `lib/agent/` scaffolding is the in-app *chat* agent, not the
  email agent.** Orchestrator, tool-registry, confirmation, and
  `pending_tool_calls` are designed around streaming chat completions
  with synchronous tool calls. The Phase 6 email agent is an
  *asynchronous* loop (poll → classify → draft → wait for human review)
  and will share the model client, the usage recorder, and probably the
  per-tool audit pattern, but not the orchestrator loop itself.
- **Credit enforcement exists but is not yet wired anywhere.**
  `assertCreditsAvailable(userId)` and `BillingQuotaExceededError` are
  exported from [lib/billing/credits.ts:138](lib/billing/credits.ts:138)
  with zero callsites in `lib/`. The Phase 5 W2 hookup the memory
  references is *not* present in the codebase. W1 does not need this gate
  yet (L1 rules are free), but W2 will have to add the callsite as
  well as decide where it lives.
- **Schema is well-formed for what exists, but has no Inbox tables.**
  `lib/db/schema.ts` ends at the `events` table (the L4 canonical store
  for Calendar / Tasks / Classroom). There are no `inbox_items`,
  `agent_rules`, `agent_drafts`, `send_queue`, or `gmail_*` tables.
  Migrations are linear (`0000`–`0012`) and managed by Drizzle Kit
  (`pnpm db:generate` → `pnpm db:migrate`).
- **Inbox UI is not scaffolded.** `components/layout/nav-items.ts`
  declares 4 items (`home`, `chats`, `classes`, `calendar`) — Inbox is
  missing entirely. No `g i` shortcut, no notification bell, no
  `app/app/inbox/` route. The pre-launch redesign memo locked Inbox at
  the top of a 5-item sidebar; the code is one item short.
- **No digest infra at all.** No email-sending package
  (`resend`/`postmark`/`nodemailer`/`sendgrid`/SES), no cron/QStash/
  Inngest dependency, no `app/api/cron/` route, no service worker, no
  VAPID key. The user table has a `timezone` column already (good for
  digest scheduling); everything else needs to be net-new.
- **Tests use Vitest with heavy module mocks.** No DB integration
  fixtures; no recorded HTTP fixtures for Google APIs. Webhook tests
  feed pre-parsed `Stripe.Event` objects to internal helpers per
  AGENTS.md §10. The same shape works for Gmail Pub/Sub if W1 adopts
  webhooks.
- **Onboarding flow is *behind* memory.** [app/(auth)/onboarding/page.tsx](app/(auth)/onboarding/page.tsx)
  has 4 steps including a *required* Notion connect — but
  `project_steadii.md` and the agent-model memo demoted Notion to
  optional. Memory also calls for a 3-step, ~90-second onboarding with
  Gmail scope grant as Step 2. Current onboarding has zero awareness of
  Gmail. This is a known divergence; W1 needs to address it (at minimum,
  add a Gmail step) but the broader rewrite is a W3-ish task.
- **Confirmation model is binary, not risk-tiered.** The current
  `agent_confirmation_mode` preference takes `"all" | "destructive_only" |
  "none"` and `requiresConfirmation()` looks at a `read|write|destructive`
  mutability tag. Phase 6's risk-tiered (low/medium/high) model is a
  superset; it doesn't conflict, but the current preference enum and the
  Settings UI both need extending. W1 itself only needs to accept that
  the new system runs *alongside* the old one (chat-side keeps its enum;
  email-side gets a new one).
- **Past-due banner exists in `app/app/layout.tsx`; cap-behavior banner
  also exists** but it asserts that "agent drafts and other metered
  features pause until reset" — copy that anticipates Phase 6 but
  currently has no enforcement behind it. W1 doesn't change this; W2 will.

---

## 2. Section-by-section findings

### 2.1 Google OAuth and Gmail API

**Current state.** Auth.js v5 (`5.0.0-beta.25`) with the encrypted
Drizzle adapter. JWT session strategy. Google is the *only* provider.
The single OAuth call at [lib/auth/config.ts:23-31](lib/auth/config.ts:23)
requests, in one consent screen:

```
openid email profile
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/tasks
https://www.googleapis.com/auth/classroom.courses.readonly
https://www.googleapis.com/auth/classroom.coursework.me.readonly
https://www.googleapis.com/auth/classroom.announcements.readonly
```

`prompt: "consent"` and `access_type: "offline"` are set, so refresh
tokens are issued and we get re-consent on every login (good — the
tokens get re-wrapped through the encrypted adapter cleanly when scopes
change).

**Token storage.** `accounts` table stores `refresh_token` /
`access_token` / `id_token` as opaque text fields. The
`EncryptedDrizzleAdapter` in [lib/auth/encrypted-adapter.ts](lib/auth/encrypted-adapter.ts)
wraps `linkAccount` so initial inserts go through `encryptAccountTokens()`.
Reads are unwrapped on the spot inside each integration's
`getXForUser()` helper using `decryptOAuthToken()`. Cipher format:
`enc:v1:<base64-aes256gcm>` from [lib/auth/oauth-tokens.ts:9](lib/auth/oauth-tokens.ts:9).
There is a one-shot backfill script at `scripts/encrypt-oauth-tokens.ts`
for legacy plaintext rows.

**Refresh handling.** Each integration registers its own
`oauth2.on("tokens", ...)` callback that re-encrypts and persists the
new `access_token` + `expires_at` after a refresh. Same pattern in all
three: [calendar.ts:39-57](lib/integrations/google/calendar.ts:39),
[classroom.ts:41-59](lib/integrations/google/classroom.ts:41),
[tasks.ts:39-57](lib/integrations/google/tasks.ts:39). A future
`getGmailForUser()` should follow the identical shape verbatim. There is
no centralized OAuth client factory; each integration constructs its own
`google.auth.OAuth2`.

**Gmail API status.** None. `grep -i gmail` finds matches only in
`AGENTS.md` (a comment about Gmail being the core product) and in
`tests/academic-email.test.ts` (which tests `.edu` regex matching, not
Gmail API). No `googleapis/gmail`, no `gmail_v1`, no
`gmail.googleapis.com`. Adding it is a new file:
`lib/integrations/google/gmail.ts` modeled on `calendar.ts`.

**Verification status.** `prompt: "consent"` works without verification
for test users. Google Cloud Console state is not visible in the repo
(it's manual operator config). Memory says we are in Testing mode and
that CASA Tier 2 (~$540/yr) ships before public launch — *not* during
W1. So W1 can assume "Testing mode, ≤100 test users" and rely on
`prompt: "consent"` + the existing scope upgrade pattern.

**Scope conflict reality check.** Google does *not* allow incremental
auth without re-prompting if a new scope is requested mid-session — the
`include_granted_scopes` parameter helps but still triggers consent
when restricted scopes (Gmail) are added. Practical implication: adding
Gmail scope to the existing string and forcing a re-consent on next
login is the cleanest path. The decryption + token-refresh code stays
identical.

#### Gap / Risk / Action needed in W1

- **Add to scope string** at [lib/auth/config.ts:26](lib/auth/config.ts:26):
  `https://www.googleapis.com/auth/gmail.modify`
  `https://www.googleapis.com/auth/gmail.send`
  Memory locks this as upfront, single-screen. Two restricted scopes;
  expect the "Google hasn't verified this app" warning to remain until
  CASA Tier 2 is filed post-W4. Test users are pre-approved via the OAuth
  consent screen test-user list.
- **Add `lib/integrations/google/gmail.ts`** with `getGmailForUser()` +
  a `GmailNotConnectedError` modeled on the three existing integrations.
  The `scope.includes("gmail")` check is what gates connectivity.
- **Re-consent UX.** Existing users will need to sign out / sign in to
  pick up the new scope. The Settings → Connections "Sign out to
  re-auth" link at [app/app/settings/page.tsx:148](app/app/settings/page.tsx:148)
  already exists for the analogous Calendar case; reuse it for Gmail.
  No new code if we accept the same friction, but the error copy needs
  to mention Gmail too.
- **Risk: existing users on the trial silently lose access.** Once the
  scope changes, their stored access tokens are still valid for the
  *old* scope set; Gmail calls will fail with `insufficient scope`
  until they re-OAuth. Solution = a banner in `app/app/layout.tsx` that
  detects "user signed in pre-Gmail" by inspecting the `accounts.scope`
  field, and prompts re-auth. Cheap to add; do it in W1 to avoid silent
  failures during dogfood.
- **Risk: refresh-token revocation cascades.** When a user revokes one
  Google scope from their account dashboard, *all* scopes go too. The
  app should handle `invalid_grant` on Gmail calls by surfacing
  `GMAIL_NOT_CONNECTED` and pointing the user back through OAuth. The
  three existing integrations don't do this gracefully (they bubble the
  raw error). Consider a shared helper in W1 since email-loop failures
  must be observable.

### 2.2 Existing "agent" scaffolding

**Files in `lib/agent/`:**

| File | Purpose | Reusable for email agent? |
|------|---------|---------------------------|
| `orchestrator.ts` | Streaming chat completion loop with inline tool dispatch, OpenAI conversation persistence, and confirmation-pause handling | **Partial.** The streaming loop is chat-specific and not what the email agent needs. The persistence/usage/audit patterns transfer 1:1. |
| `tool-registry.ts` | Aggregates `NOTION_TOOLS`, `CALENDAR_TOOLS`, `TASKS_TOOLS`, `CLASSROOM_TOOLS`, `SYLLABUS_TOOLS`, `summarizeWeekTool` and exposes `getToolByName()` + `openAIToolDefs()` | **Yes** — extend by adding `GMAIL_TOOLS` once they exist. |
| `tools/types.ts` | Defines `ToolExecutor`, `ToolSchema` (`mutability: "read" \| "write" \| "destructive"`), `ToolExecutionContext` | **Yes** — Gmail tools follow the same shape. The mutability enum may need a `risk: "low" \| "medium" \| "high"` companion (separate from `mutability`) for the email loop. |
| `tools/{calendar,classroom,notion,syllabus,tasks,summarize-week}.ts` | Per-area tool clusters — each tool exports a `{ schema, execute }` pair. Tools log to `audit_log` themselves (not a wrapper). | **Yes** as a pattern. Add `tools/gmail.ts` for L1/L2 email actions (label, reply-as-draft, send, archive, etc.). |
| `confirmation.ts` | `requiresConfirmation(mode, mutability)` — a 9-cell truth table | **Compatible but insufficient.** Risk-tiered email confirmations are a different axis (low/medium/high), not a different mode. Don't replace this; add a parallel `riskTier(item) → "low" \| "medium" \| "high"` decision and a separate confirm path for email items. |
| `context.ts` + `serialize-context.ts` | Builds the per-user system-prompt context (Notion connection, registered resources, this week's calendar) for the chat agent | **Reusable as a pattern.** Email-agent classification context (sender, last 2 thread messages, role hints) is a different payload — write a sibling `context-email.ts`. |
| `messages.ts` | DB row → OpenAI `ChatCompletionMessageParam` adapter with attachments | Chat-only. Not relevant to email. |
| `models.ts` | `selectModel(taskType)` + cost/credit math. **`TaskType` does not yet include any email task types.** | **Yes, must extend.** Add at minimum: `"email_classify"` (Mini), `"email_draft"` (Complex/full GPT-5.4). Add corresponding entries to `taskTypeMetersCredits()`. Memory says classify ≈ 0.75 credits, draft ≈ 3.9 credits — those numbers need to actually fall out of the existing `usdToCredits()` math given the prompt sizes, which is W2's problem to verify. |
| `usage.ts` | `recordUsage()` — inserts into `usage_events`, computes credits via `usdToCredits` | **Yes, reusable verbatim.** New task types just plug in. |
| `preferences.ts` | `getUserConfirmationMode()`, `getUserTimezone()`, etc. | **Yes.** Add `getUserAgentRiskMatrix()` or similar for risk-tier overrides; or store rules in a new `agent_rules` table and read from there. |
| `prompts/main.ts` | Single chat system prompt | Chat-only. Email agent will need its own family of prompts. |
| `chat-actions.ts`, `calendar-actions.ts`, `tasks-actions.ts` | Server actions that wrap the underlying tools for direct UI invocation (so e.g. the calendar page can create an event without going through chat) | **Yes — convention to follow for `email-actions.ts`** if/when the Inbox UI needs to confirm a draft, archive, etc. without a chat round-trip. |
| `serialize-context.ts`, `stream-events.ts` | Helpers for the chat orchestrator | Chat-only. |

**Confirmation persistence.** `pending_tool_calls` is the existing
"paused tool" table — chat-agent emits it when a destructive tool is
proposed and `confirmation_mode != none`. The Phase 6 email agent's
"draft awaiting confirmation" state is conceptually similar but the
data is much richer (subject, body, recipients, risk reasoning). Two
options for W1:
1. Reuse `pending_tool_calls` and stash the draft in `args` (cheap;
   overloads the table).
2. New `agent_drafts` table (cleaner; lets us index on
   user/status/createdAt).
   Recommendation: option 2. The tables serve different lifecycles
   (chat tool calls live ~minutes, email drafts live hours and may
   need re-render).

**Mutability vs risk.** Today every tool is one of `read|write|
destructive`. For email actions, a "send a reply to your professor" is
`write` mechanically but `medium` risk semantically. The cleanest split
for W1 is to keep `mutability` as the API-level safety tag (which the
chat-side confirm mode reads) and add a separate `riskTier` field on
the `agent_drafts` row, set by the L1 rules / L2 classify pass.

#### Gap / Risk / Action needed in W1

- **No email orchestrator yet.** W1 ships only L1 rules + classify
  pipeline (no LLM draft yet — that's W2). Implement as a single
  `lib/agent/email/triage.ts` entry point: `triageMessage(userId, gmailMsg)`.
  Don't bolt it onto `orchestrator.ts`.
- **Tool mutability for email.** Add `gmail_archive`, `gmail_label`
  (low risk), `gmail_create_draft` (write, medium-risk), `gmail_send`
  (write, but post-confirm). `gmail_send` is the only one that *must*
  honor the 20s undo window. Don't add `gmail_send` in W1; defer until
  W3 confirm UX.
- **Don't pre-build the L2 split** in W1. Memory locks the two-step
  classify (Mini) → draft (Full) split — that's W2. W1 ships rules-only
  triage + the inbox row that records which rule fired and why.
- **Add `email_classify` + `email_draft` task types** to `models.ts`
  even in W1, because logging accuracy needs them; but don't wire any
  tool to them yet. Cheap forward-compatibility.

### 2.3 Database schema

**Tables in [lib/db/schema.ts](lib/db/schema.ts) as of HEAD:**

| Table | Purpose | Phase 6 relevance |
|-------|---------|-------------------|
| `users` | Identity, plan flags, trial, retention | Has every column Phase 6 needs except, perhaps, a `digest_hour_local` and `digest_enabled` for W3. |
| `blob_assets` | Vercel Blob registry | Unrelated. |
| `accounts` | Auth.js OAuth account rows (one per provider per user) | Gmail rides on the existing Google row. |
| `sessions`, `verification_tokens` | Auth.js standard | Unrelated. |
| `notion_connections`, `registered_resources` | Notion integration + the four Steadii DBs | Unrelated to Gmail. |
| `audit_log` | Append-only log of agent actions (tool calls + billing events) | **Use for every email-side action** — preserves the "transparency reinforces α trust" rollback policy. |
| `chats`, `messages`, `message_attachments` | Chat history | Unrelated (the email "draft review" UI is *not* a chat thread, per the redesign memo). |
| `usage_events` | Per-LLM-call token + credit record | **Reuse verbatim** — `email_classify` / `email_draft` are new task types, but the row shape is unchanged. |
| `subscriptions`, `invoices`, `processed_stripe_events`, `topup_balances` | Stripe mirrors | Unrelated. |
| `pending_tool_calls` | Chat-agent "tool awaiting confirm" rows | Could be reused; recommendation is to add `agent_drafts` instead (see §2.2). |
| `events` | L4 canonical event store. `source_type` enum is `google_calendar | google_tasks | google_classroom_coursework`. `kind` enum is `event | task | assignment`. | **Don't overload.** Email items are a different *kind* of artifact (no start time, no calendar bucket); they belong in their own table. |

**`users` columns post-Phase 5:**
- `id`, `name`, `email`, `email_verified`, `image`
- `plan` (`free|student|pro` enum), `plan_interval` (`monthly|yearly|four_month`)
- `preferences` JSONB (`theme`, `locale`, `agentConfirmationMode`)
- `timezone`, `onboarding_step`
- `is_admin`, `founding_member`, `grandfather_price_locked_until`
- `trial_started_at`
- `data_retention_expires_at`
- `created_at`, `updated_at`, `deleted_at`

Memory's "user-table shape post-Phase 5" claim matches this 1:1.

**Migration framework.** `drizzle-kit` (0.31.x) generates
SQL files into `lib/db/migrations/`. Numbered linearly `0000`–`0012`.
Applied in dev via `pnpm db:migrate` (the local script) or pushed via
`pnpm db:push` (no migration file). Production runs the same migrate
script. There is no rollback path baked in — each migration is
forward-only. Naming convention is `NNNN_random_words.sql`, generated
automatically by Drizzle Kit. Recent migration `0012_noisy_leper_queen.sql`
adds `topup_balances` (the latest Phase 5 addition).

**Soft-delete convention.** Present on `users`, `chats`, `messages`,
`blob_assets`. The `events` table uses a different shape (`deleted_at`
timestamptz used for sync reconciliation, not user-initiated delete).
Inbox tables should follow the user-facing soft-delete convention:
`deletedAt` nullable timestamp, FK with `ON DELETE CASCADE` from `users`.

**UUID generation.** All PKs are `uuid` with `defaultRandom()`. No
sequential IDs anywhere. Do the same for new tables.

#### Gap / Risk / Action needed in W1

- **Need 3 new tables in W1**: `inbox_items`, `agent_rules`, plus an
  `agent_drafts` table even though W1 doesn't write drafts (so that the
  schema lands once instead of being reshaped in W2). See §3 below for
  the proposed DDL.
- **`events` table is *not* the right home for emails.** Reuse the
  `source_type` enum *only* if you genuinely treat them as the same
  kind of artifact downstream — and the redesign memo says you don't
  (Inbox is a separate sidebar item from Calendar). New tables.
- **No risk-tier column on the user.** Add a `digest_hour_local`
  (smallint default 7) and `digest_enabled` (boolean default true) on
  `users` *now* even though W1 doesn't ship the digest sender; it
  prevents a second migration in W3 and lets the W3 prompt reach for
  the column without ceremony.
- **Migration count is small (12).** No risk of conflicts; standard
  `pnpm db:generate` flow works.

### 2.4 Credit enforcement bridge

**Public API.** From [lib/billing/credits.ts](lib/billing/credits.ts):

```ts
export async function getCreditBalance(userId): Promise<CreditBalance>
export async function assertCreditsAvailable(userId): Promise<CreditBalance>
export class BillingQuotaExceededError extends Error { code, balance }
```

`assertCreditsAvailable()`:
- calls `isUnlimitedPlan(userId)` first — admins skip the check;
- otherwise calls `getCreditBalance(userId)`;
- if `balance.exceeded`, throws `BillingQuotaExceededError(balance)`;
- otherwise returns the balance.

`balance.exceeded` is `used >= monthlyCredits + topupTotal` (i.e.
"monthly pool fully consumed AND no top-up packs remain").

**How cost is measured.** `recordUsage()` at
[lib/agent/usage.ts:23](lib/agent/usage.ts:23) is *post-call only* —
it inserts a `usage_events` row after the OpenAI request returns,
computing cost from `prompt_tokens` + `completion_tokens` +
`prompt_tokens_details.cached_tokens`. Cost → credits via
`usdToCredits(usd) = floor(usd * 200)`. Today only `mistake_explain`
and `syllabus_extract` actually deduct; chat / tool_call tasks insert
rows with `creditsUsed = 0`.

**Where it's wired (or not).**
```
$ grep -rn assertCreditsAvailable lib/
lib/billing/credits.ts:138:export async function assertCreditsAvailable(...)
lib/billing/credits.ts:146:  if (balance.exceeded) throw new BillingQuotaExceededError(balance);
```
**Zero callsites in `lib/`.** Test files reference it (mocking it for
the orchestrator-error-event test), and `app/app/layout.tsx` /
`app/app/settings/page.tsx` call `getCreditBalance` for *display*, but
no production code path actually *gates* on credit availability today.
The Phase 5 W2 hookup that the memory implies happened did *not*
materialize. This is an undocumented gap.

**What W1 / W2 need.** Memory says:
- L1 = free (no model call → no credit cost; logging is fine).
- L2 classify ≈ 0.75 credits per email.
- L2 draft ≈ 3.9 credits per email.
- Cap exhaustion: **draft generation hard-pauses; classify continues.**
  Mistake-explain / syllabus-extract also pause until top-up or reset.
- Chat is *not* credit-metered (rate-limited via
  `enforceChatLimits()` in [lib/utils/rate-limit.ts:107](lib/utils/rate-limit.ts:107)).

The current credit module supports a binary
"unlimited / quota / exceeded" decision. **It does not yet support
per-feature pause toggles.** A draft-only pause requires either:
1. A new `assertDraftCreditsAvailable(userId)` that asserts both
   "credits non-exhausted" and "user has not opted into a
   draft-paused state" — *or* —
2. A `getFeatureGate(userId, "email_draft")` function that returns
   `"open" | "paused"`.

W1 doesn't ship drafts, so neither is needed in W1. **W2 is when this
extension lives.** What W1 should do, defensively:
- Use `getCreditBalance()` (read-only) when persisting `inbox_items`
  to record the at-time balance for downstream metrics.
- Don't add an L1-rules credit deduct — L1 is free per memory.

**Arithmetic check.** From `models.ts`:
- Mini pricing: input $0.75/M, output $4.50/M, cached $0.075/M.
- Memory's "classify ≈ 0.75 credits" = $0.00375 per call.
  $0.00375 ÷ ($0.75/1M) for input + ($4.50/1M) for output, with the
  ~2k in / 500 out budget → input cost = $0.0015, output cost =
  $0.00225, total = $0.00375. Floor(0.00375 × 200) = 0 credits.
  **The math doesn't round up to 0.75.** Memory's number assumes a
  fractional-credit accounting that the code rounds away.
- Same issue for draft: Full GPT-5.4 at 3k in / 800 out → input
  $0.0075, output $0.012, total $0.0195. ×200 = 3.9. Floor → 3.
  Memory's 3.9 is the unfloored, unrealized value.

This *is* a discrepancy worth flagging in W2. For W1 (no LLM draft),
it's irrelevant. The fix space for W2: change `usdToCredits` to
round-half-up or to a finer integer denomination (e.g. millicredits),
then aggregate at display time. Don't pre-fix in W1.

#### Gap / Risk / Action needed in W1

- **Don't add a credit gate to L1 triage.** L1 is free.
- **Add `email_classify` and `email_draft` to the `TaskType` union** in
  `lib/agent/models.ts` and to `taskTypeMetersCredits()`. W1 won't
  emit these task types, but having them in the type is forward-prep.
- **Document the missing W2 hookup** in the W1 prompt explicitly so
  the W2 prompt can address it without surprise: the `assertCredits-
  Available()` callsite landing in `lib/syllabus/extract.ts` and
  `lib/mistakes/save.ts` is technically W2's responsibility, not W1's.
- **Floor-rounding bug for sub-1-credit tasks** is a known issue —
  surface it in W2's "open questions" but don't fix in W1.

### 2.5 Inbox UI scaffolding

**Sidebar.** [components/layout/nav-items.ts:6-11](components/layout/nav-items.ts:6):
```ts
export const NAV_ITEM_KEYS = [
  "home",
  "chats",
  "classes",
  "calendar",
] as const;
```

Four items, no Inbox. The memo `project_pre_launch_redesign.md` says
the sidebar is locked at five items, **Inbox at the top**, with `g i`
shortcut. The codebase is one item short.

**Sidebar implementation.** [components/layout/sidebar.tsx](components/layout/sidebar.tsx)
is a server component (Arc-rail-plus-overlay). Adding Inbox is a
single-file change to `nav-items.ts` (extending `NAV_ITEM_KEYS`,
`NAV_HREFS`, `NAV_SHORTCUTS`) plus the `ICONS` map in
`sidebar-nav.tsx`. The keyboard shortcut chord (`g`-then-letter) is
generic — adding `i` for Inbox is one entry.

**Inbox route.** None exists. `app/app/` contains `admin/`, `assignments/`,
`calendar/`, `chat/`, `chats/`, `classes/`, `mistakes/`, `resources/`,
`settings/`, `syllabus/` plus `page.tsx` (Home). No `inbox/`.

**Notification bell.** No matches for `notification|bell` in
`components/layout/`. Not built. Memory describes it as a header
overlay with 3–5 high-risk items.

**Home Dashboard.** [app/app/page.tsx](app/app/page.tsx) renders 3
bento cards (Today's schedule, Due soon, Past week). Memory wants a
4th card showing "pending: N items" agent summary. Not present.

**Empty/error states.** Empty states already follow the
`fact → next action`, no-illustration pattern (e.g.
[app/app/page.tsx:276-279](app/app/page.tsx:276), [components/ui/empty-state](components/ui/empty-state.tsx)
referenced from `app/app/page.tsx:103-108`). Inbox empty state should
match — terse fact + 1 action ("You're clear." style).

#### Gap / Risk / Action needed in W1

- **W1 does ship the Inbox sidebar entry + the inbox route shell**
  (per the memory's "Inbox schema + first-24h ingest" framing for W1).
  Route can render a placeholder if no items yet, but the sidebar
  position must be locked in W1 to avoid a churn migration in W3.
- **`g i` shortcut** is a 1-line change — add it now.
- **Notification bell + dashboard "pending: N" card** are W3
  deliverables per the memo. W1 only adds the sidebar + the empty
  inbox route.
- **Sidebar tests.** [tests/sidebar-active.test.ts](tests/sidebar-active.test.ts)
  and [tests/sidebar-keyboard-nav.test.ts](tests/sidebar-keyboard-nav.test.ts)
  exist — they will need an updated fixture for the 5-item version.

### 2.6 Digest / notification infrastructure

**Email sending.** No package. `pnpm-lock.yaml` does mention `resend`
and `nodemailer` etc. but only as transitive matches in unrelated
dependency graphs (case-insensitive grep). No application import. Need
to add a package and an env var for the digest sender.

Vendor candidates per memory's α-budget tone:
- **Resend** — modern, simple SDK, $20/mo for 50k emails (free tier 3k/mo).
- **Postmark** — strong deliverability for transactional, $15/mo for 10k.
- **SES** — cheapest, 80¢ / 10k after the first 62k/mo on-EC2 tier; no
  EC2 means standard free pricing ($0.10 / 1k). Heavy IAM/setup tax.

For α (≤10 users × 1 digest/day = 300 emails/mo) any of them is free.
Resend is the lowest-effort. **This is a product decision; flag in the
"Open questions" section.**

**Cron / scheduled jobs.** None. No `vercel.json` cron config; no
QStash; no Inngest dependency. Memory wants the digest at 7am local
*per user* — this requires either:
- a single 30-min-cadence cron that picks up users whose local-7am-
  window intersects "now"; or
- a per-user scheduled job (QStash / Inngest can do this).

For α, the coarse polling cron is fine.

**Vercel cron.** Vercel supports cron via `vercel.json`. The endpoint
is a regular Next route protected by the `CRON_SECRET` header. Free on
Hobby plan up to 2 daily jobs. We'd need to handle authentication +
idempotency ourselves.

**Web push.** No service worker, no VAPID public key, no `web-push`
library. Memory says this is supplementary and only for desktop α; iOS
relies on email digest. **Defer entirely past W1.**

**User timezone.** Already on `users.timezone` (string IANA TZ); set
during onboarding via [components/settings/timezone-input.tsx](components/settings/timezone-input.tsx).
Used for daily-window math in [lib/dashboard/today.ts:20-31](lib/dashboard/today.ts:20).
Digest scheduling can use this column directly.

#### Gap / Risk / Action needed in W1

- **W1 ships none of the digest plumbing.** Per the memo W1 = OAuth +
  L1 + Inbox schema + first-24h ingest. Digest is W3.
- **Recommendation: keep W1 free of cron/email-sender additions** so
  W3 can pick the vendor based on what's actually shipped (and so the
  W2 credit work doesn't have to think about cron jobs).
- **Add `digest_hour_local` (smallint) + `digest_enabled` (boolean)
  to `users` in W1** so W3 doesn't re-migrate. Defaults: 7, true.

### 2.7 Observability and test patterns

**Sentry.** [sentry.server.config.ts](sentry.server.config.ts) +
[sentry.client.config.ts](sentry.client.config.ts) +
[sentry.edge.config.ts](sentry.edge.config.ts) + an
[instrumentation.ts](instrumentation.ts) hook. `tracesSampleRate: 0.1`
on both. `sendDefaultPii: false`. No custom `beforeSend` filter — PII
scrubbing relies entirely on the SDK default, which is *light*.
Comments say "revisit before β" for the client-side breadcrumb
redaction.

**No structured logger.** Code uses `console.log` / `console.error`
directly. Search reveals dozens of call sites. For Phase 6 there will
be a lot more error paths (Gmail sync failures, classification
fallbacks, scheduler retries) — fine to keep using `console.*` for α
but the W3 digest-sender failure paths should at least be Sentry-tagged.

**Logging in tools.** Each tool inserts an `audit_log` row after
its `execute()` runs. This is the convention and email tools must
follow it.

**External API wrapping.** No central HTTP wrapper. Each integration
constructs its own client. Sentry wraps Next requests automatically;
non-Next code paths (the eventual digest cron, the eventual Gmail
poller) need explicit `Sentry.startSpan` or at least
`Sentry.captureException` on the catch path.

**Tests.** Vitest, `environment: "node"`. Heavy use of `vi.mock(...)`
to stub DB and drizzle modules — see e.g.
[tests/credit-gate.test.ts:3-25](tests/credit-gate.test.ts:3) which
mocks `@/lib/db/client`, `@/lib/db/schema`, and `drizzle-orm` to a
no-op surface. There is **no integration test infrastructure** that
hits a real Postgres or a real Google API. Test-only `server-only.ts`
shim at [tests/shims/server-only.ts](tests/shims/server-only.ts).

Implications for W1:
- Test L1 rules in pure functions (input: synthetic Gmail message,
  output: bucket + reasoning). No need for DB.
- Test the rule registry and the per-bucket logic with table-driven
  tests in the style of `tests/academic-email.test.ts`.
- Don't try to stand up a Gmail API integration test. Use recorded
  fixtures (JSON of the Gmail `message.get` payload) under
  `tests/fixtures/gmail/`.

**No e2e infrastructure.** Per AGENTS.md §10. OK for α.

#### Gap / Risk / Action needed in W1

- **Add JSON fixtures** under `tests/fixtures/gmail/` for at least one
  representative email per L1 bucket (auto-high, auto-medium, auto-low,
  ignore). Use real Gmail API JSON shape so the W2 LLM-classify code
  can reuse them.
- **Wrap every Gmail API call in a try/catch with `Sentry.capture-
  Exception`** plus an `audit_log` failure row. The α "transparency
  reinforces trust" rollback policy makes silent Gmail failures
  unacceptable.
- **Rule unit tests** are the W1 quality gate. Target ≥1 test per
  bucket, plus 1 negative test per bucket (an item that *almost*
  matches but doesn't).

### 2.8 Locked-decision conflicts

These are places where *current code* contradicts a memory-locked
decision. **Do not fix these in this pass.** Listed for the W1 prompt
to address.

| # | Locked decision | Current state | Where |
|---|----------------|---------------|-------|
| C1 | Onboarding has 3 steps (~90s), Step 2 = Gmail scope grant | Onboarding has **4 steps**, Notion is *required*, **no Gmail step at all** | [app/(auth)/onboarding/page.tsx](app/(auth)/onboarding/page.tsx), [lib/onboarding/is-complete.ts](lib/onboarding/is-complete.ts:7) |
| C2 | Notion is **optional** (accuracy booster) | `isOnboardingComplete()` requires `notionConnected && notionSetupComplete && calendarConnected`. Free trial cannot start without Notion. | [lib/onboarding/is-complete.ts:7-9](lib/onboarding/is-complete.ts:7) |
| C3 | Sidebar is 5 items, Inbox at top with `g i` | Sidebar is 4 items: home/chats/classes/calendar | [components/layout/nav-items.ts:6-11](components/layout/nav-items.ts:6) |
| C4 | Risk-tiered confirmation (low/medium/high) for email | Single binary mode (`destructive_only|all|none`) shared across chat tools | [lib/agent/confirmation.ts](lib/agent/confirmation.ts), [components/layout/...](nothing) |
| C5 | First-time domain → high risk until user confirms | No first-time-sender concept anywhere | n/a |
| C6 | Cap exhaustion = drafts pause, classify continues | `assertCreditsAvailable` is binary (exceeded vs not); no per-feature pause | [lib/billing/credits.ts:138](lib/billing/credits.ts:138) |
| C7 | Credit cost: classify ≈ 0.75, draft ≈ 3.9 | `usdToCredits = floor(usd*200)`; sub-1 costs round to 0 (see §2.4 arithmetic) | [lib/agent/models.ts:98-100](lib/agent/models.ts:98) |
| C8 | Layout banner says "agent drafts and other metered features pause until reset" | Copy is shipped but no enforcement is wired (see §2.4 — `assertCreditsAvailable` has zero callers) | [app/app/layout.tsx:91](app/app/layout.tsx:91) |
| C9 | Settings → Agent Rules section (Profile / Agent Rules / Notifications / Connected Accounts / Subscription & Data) | Settings is a single page with 7 ad-hoc sections; no Agent Rules anywhere | [app/app/settings/page.tsx](app/app/settings/page.tsx) |
| C10 | "Pending: N items" 4th card on Home Dashboard | 3 cards (Today / Due soon / Past week) | [app/app/page.tsx:163](app/app/page.tsx:163) |
| C11 | Header notification bell, visible from any page | Not implemented | n/a |
| C12 | `events` canonical store carries calendar + tasks + classroom + (future Gmail?) | `source_type` enum lacks any email value; **Gmail belongs in its own table**, not here. Memory doesn't actually conflict — re-confirming the design. | [lib/db/schema.ts:388-394](lib/db/schema.ts:388) |

C5, C9, C10, C11 are W3 deliverables per the memo. C1, C2, C3 must
move in W1 (or at least C3 + a partial fix to C1 to add Gmail). C4, C6,
C7 are W2 work. C8 is dormant copy that will be backed by enforcement
in W2.

---

## 3. Proposed W1 data model

Three new tables in W1, plus two `users` columns. All columns
`snake_case` in the DB; Drizzle auto-maps to camelCase TS. UUIDv7-style
PKs (`uuid().defaultRandom()`). Every FK explicit with
`onDelete: cascade` from `users`. `created_at` / `updated_at` on every
table. Soft-delete (`deleted_at`) on user-facing tables (`inbox_items`,
`agent_rules`).

### 3.1 `inbox_items`

The agent's queue. One row per Gmail message that the L1 rules
considered actionable (or referred to L2). Items in the `ignore`
bucket may either be skipped entirely or stored with `bucket="ignore"`
for false-negative-rescue analytics — recommendation: **store
ignored items too** for the first 30 days, then evaluate retention.

```sql
CREATE TABLE inbox_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Source identity
  source_type        TEXT NOT NULL,          -- 'gmail' (future: 'classroom_announcement', etc.)
  source_account_id  TEXT NOT NULL,          -- accounts.providerAccountId
  external_id        TEXT NOT NULL,          -- Gmail message id
  thread_external_id TEXT,                   -- Gmail threadId

  -- Sender + subject snapshot (denormalized for inbox list rendering
  -- without re-hitting Gmail; Gmail is canonical for body content).
  sender_email       TEXT NOT NULL,
  sender_name        TEXT,
  sender_domain      TEXT NOT NULL,          -- generated as substring after '@'
  sender_role        TEXT,                   -- 'professor'|'ta'|'classmate'|'admin'|'other'|null
  recipient_to       TEXT[] NOT NULL DEFAULT '{}',
  recipient_cc       TEXT[] NOT NULL DEFAULT '{}',
  subject            TEXT,
  snippet            TEXT,                   -- Gmail's snippet, ~150 chars
  received_at        TIMESTAMPTZ NOT NULL,

  -- Triage outcome
  bucket             TEXT NOT NULL,          -- 'auto_high'|'auto_medium'|'auto_low'|'ignore'|'l2_pending'
  risk_tier          TEXT,                   -- 'low'|'medium'|'high'|null until classified
  rule_provenance    JSONB,                  -- {ruleId: 'GLOBAL_AUTO_HIGH_GRADE_APPEAL', source: 'global', why: 'matched keyword "transcript"'}
  first_time_sender  BOOLEAN NOT NULL DEFAULT false,

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'open',
                     -- 'open'|'snoozed'|'archived'|'sent'|'dismissed'
  reviewed_at        TIMESTAMPTZ,
  resolved_at        TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,

  CONSTRAINT inbox_items_external_unique UNIQUE (user_id, source_type, external_id)
);

CREATE INDEX inbox_items_user_status_received_idx
  ON inbox_items (user_id, status, received_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX inbox_items_user_bucket_idx
  ON inbox_items (user_id, bucket)
  WHERE deleted_at IS NULL;
CREATE INDEX inbox_items_user_thread_idx
  ON inbox_items (user_id, thread_external_id);
```

Justification:
- `bucket` is the L1 outcome; `risk_tier` is the L2 outcome (filled in W2).
- `rule_provenance` = JSON for forward compat (multiple matched rules
  recorded in order; lets the Settings → Agent Rules transparency UI
  show "why this got triaged here").
- `first_time_sender` materialized for cheap filtering (memory:
  first-time domain forces high risk).
- Generated `sender_domain` (Postgres `GENERATED ALWAYS AS`) gives a
  cheap index for "have we seen this domain before?" without LIKE
  scans. (Drizzle-side: SQL fragment.)
- The `(user_id, source_type, external_id)` unique constraint prevents
  double-ingest when the Gmail watch fires twice for the same message.
- The partial index on `WHERE deleted_at IS NULL` keeps the hot path
  small.

### 3.2 `agent_rules`

The "rules currently applied to your inbox" surface. Stores both
operator-maintained globals (provenance label `🌐`) and per-user
overrides (provenance labels `🧠 Learned`, `⚙️ Manual`, `💬 Chat`).
Globals can be expressed in code (JSON in `lib/agent/email/rules-
global.ts`), OR persisted with `user_id IS NULL`. Recommendation:
**code, not table** for globals — they're operator-maintained, not
user-editable, and a code constant simplifies typechecking. The
`agent_rules` table holds *only* per-user rules.

```sql
CREATE TABLE agent_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  scope           TEXT NOT NULL,           -- 'sender'|'domain'|'subject_keyword'|'thread'
  match_value     TEXT NOT NULL,           -- email/domain/keyword/threadId
  match_normalized TEXT NOT NULL,          -- lowercased, trimmed; UNIQUE per user

  risk_tier       TEXT,                    -- 'low'|'medium'|'high'|null
  bucket          TEXT,                    -- 'auto_high'|'auto_medium'|'auto_low'|'ignore'|null
  sender_role     TEXT,                    -- 'professor'|'ta'|'classmate'|'admin'|'other'|null

  source          TEXT NOT NULL,           -- 'learned'|'manual'|'chat'
  reason          TEXT,                    -- one-line human-readable why

  enabled         BOOLEAN NOT NULL DEFAULT true,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CONSTRAINT agent_rules_user_scope_match_unique
    UNIQUE (user_id, scope, match_normalized)
);

CREATE INDEX agent_rules_user_scope_enabled_idx
  ON agent_rules (user_id, scope)
  WHERE enabled = true AND deleted_at IS NULL;
```

Justification:
- `scope` lets the L1 engine ask "is this domain learned?" / "is this
  sender learned?" with a single index probe.
- `risk_tier` and `bucket` are nullable because some rules only assert
  a `sender_role` (e.g. "this person is a TA") without overriding the
  bucket. The L1 engine merges signals.
- `source` doubles as the provenance label in Settings.
- `match_normalized` is what the index probes against; `match_value`
  preserves the original casing for display.

### 3.3 `agent_drafts`

W1 does *not* generate drafts — that's W2. Schema lands in W1 anyway
so W2 doesn't reshape it. W1 inserts no rows here.

```sql
CREATE TABLE agent_drafts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  inbox_item_id      UUID NOT NULL REFERENCES inbox_items(id) ON DELETE CASCADE,

  -- LLM provenance
  classify_model     TEXT,                  -- e.g. 'gpt-5.4-mini'
  draft_model        TEXT,                  -- e.g. 'gpt-5.4'
  classify_usage_id  UUID REFERENCES usage_events(id) ON DELETE SET NULL,
  draft_usage_id     UUID REFERENCES usage_events(id) ON DELETE SET NULL,

  -- Decision
  risk_tier          TEXT NOT NULL,         -- 'low'|'medium'|'high'
  action             TEXT NOT NULL,         -- 'draft_reply'|'archive'|'snooze'|'no_op'|'ask_clarifying'
  reasoning          TEXT,                  -- LLM's explanation, surfaced in UI

  -- Draft body (only when action='draft_reply')
  draft_subject      TEXT,
  draft_body         TEXT,
  draft_to           TEXT[] NOT NULL DEFAULT '{}',
  draft_cc           TEXT[] NOT NULL DEFAULT '{}',
  draft_in_reply_to  TEXT,                  -- Gmail message id we're replying to

  -- Lifecycle
  status             TEXT NOT NULL DEFAULT 'pending',
                     -- 'pending'|'edited'|'approved'|'sent'|'dismissed'|'expired'
  approved_at        TIMESTAMPTZ,
  sent_at            TIMESTAMPTZ,
  gmail_sent_message_id TEXT,               -- response from gmail.send

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX agent_drafts_user_status_idx
  ON agent_drafts (user_id, status, created_at DESC);
CREATE INDEX agent_drafts_inbox_item_idx
  ON agent_drafts (inbox_item_id);
```

Justification:
- One inbox item can have multiple draft attempts (re-classify, user
  asks for "try again with a different tone") — but W1 doesn't ship
  that, so a single active draft per item is fine. Don't add a
  `parent_draft_id` self-reference until the use case lands.
- `classify_usage_id` / `draft_usage_id` link to the existing
  `usage_events` rows so credit accounting traces cleanly back to the
  draft it paid for.
- `gmail_sent_message_id` lets the W3 send-and-undo flow re-fetch
  the just-sent message to render confirmation UI.

### 3.4 (Defer) `send_queue` / `undo_window_pending`

The 20s undo window is a W3 concern. W1 should *not* ship the
table; it requires a worker (cron / setTimeout / QStash delayed
message) that will be picked when the digest infra is. Pre-shipping
the schema invites premature decisions. Defer.

### 3.5 `users` column additions in W1

```sql
ALTER TABLE users ADD COLUMN digest_hour_local SMALLINT NOT NULL DEFAULT 7;
ALTER TABLE users ADD COLUMN digest_enabled    BOOLEAN  NOT NULL DEFAULT true;
```

Both are referenced by W3 / W4 work; landing them in W1 saves a later
migration. No code in W1 actually reads them.

### 3.6 Migration name

`0013_<random>.sql`, generated by `pnpm db:generate` after editing
`lib/db/schema.ts`. Drizzle Kit picks the random suffix.

---

## 4. Proposed W1 implementation order

Each step is sized to roughly half a day of focused work.

1. **Add Gmail scopes to OAuth config.** Single-line edit at
   [lib/auth/config.ts:26](lib/auth/config.ts:26). Add
   `gmail.modify` + `gmail.send` to the space-separated scope string.
   No test impact (auth tests don't validate the scope string today).
   *Depends on: nothing.*

2. **Add `lib/integrations/google/gmail.ts`** + `GmailNotConnectedError`,
   modeled on `calendar.ts`. Factor out the "build OAuth2 client +
   refresh handler" boilerplate into a shared helper if appetite
   permits — three copies already exist, this would be the fourth.
   Recommended factoring: `lib/integrations/google/_oauth-client.ts`
   exporting `getGoogleOAuth2Client(userId, requiredScopeFragment)`.
   *Depends on: step 1.*

3. **Schema: add `inbox_items`, `agent_rules`, `agent_drafts` tables
   and `users.{digest_hour_local, digest_enabled}` columns.**
   Edit `lib/db/schema.ts`, then `pnpm db:generate`. Run `pnpm db:migrate`
   in dev to confirm clean apply. *Depends on: nothing (parallel-safe
   with steps 1-2).*

4. **Type exports.** Make sure `InboxItem`, `NewInboxItem`,
   `AgentRule`, `AgentDraft` types are exported from `lib/db/schema.ts`
   following the `EventRow / NewEventRow` pattern. Cheap.
   *Depends on: step 3.*

5. **L1 rule registry.** Create `lib/agent/email/rules.ts` with the
   global rule list per memory's L1 spec — IGNORE / AUTO_HIGH /
   AUTO_MEDIUM / AUTO_LOW buckets, EN+JA keyword lists, hierarchy CC
   detection skeleton (without LLM signature parsing yet — that's W2).
   Pure functions. *Depends on: nothing.*

6. **L1 triage entry point.** `lib/agent/email/triage.ts` exporting
   `triageMessage(userId, gmailMsg) → { bucket, ruleProvenance,
   firstTimeSender }`. Also `applyTriageResult(userId, gmailMsg,
   result) → InboxItem` that writes the row and emits an `audit_log`.
   *Depends on: steps 4 + 5.*

7. **Gmail message fetcher.** `lib/integrations/google/gmail-fetch.ts`
   with `listRecentMessages(userId, sinceTs)` and
   `getMessage(userId, messageId)`. Both wrap pagination + Sentry
   error handling. *Depends on: step 2.*

8. **First-24h ingest job.** `lib/agent/email/ingest-recent.ts`
   exporting `ingestLast24h(userId)`. Called from the user creation
   path (Auth.js `events.createUser`) so that brand-new users have an
   inbox to look at on first dashboard load. Fast-fail with
   `GmailNotConnectedError` no-op if scope not granted (e.g. legacy
   user mid-rollout).
   *Depends on: steps 6 + 7.*

9. **Sidebar update: 5 items with Inbox at top.** Edit
   [components/layout/nav-items.ts](components/layout/nav-items.ts) +
   the `ICONS` map in [components/layout/sidebar-nav.tsx](components/layout/sidebar-nav.tsx).
   Use `Inbox` (lucide) icon, shortcut `i`. Update sidebar tests:
   [tests/sidebar-active.test.ts](tests/sidebar-active.test.ts),
   [tests/sidebar-keyboard-nav.test.ts](tests/sidebar-keyboard-nav.test.ts).
   *Depends on: nothing.*

10. **Inbox route shell.** `app/app/inbox/page.tsx` — server component,
    queries `inbox_items` for the current user filtered to
    `status='open'`, renders a Raycast-style row-per-item list. Empty
    state ("You're clear." pattern). No item-detail page yet (W3
    confirm-UX work).
    *Depends on: steps 4 + 9.*

11. **Onboarding: insert Gmail step.** *Minimum* delta to onboarding
    so new users grant Gmail scope. The full 3-step rewrite is W3 —
    W1 just adds Gmail scope grant as an additional step (so the
    current 4 becomes 5, or fold Notion-required → Notion-optional in
    one go — conservative path is the additive change). Update
    [lib/onboarding/is-complete.ts](lib/onboarding/is-complete.ts:7)
    to include `gmailConnected`. *Note: this conflicts with the
    "Notion is optional" decision (C2); the W1 prompt should resolve
    by either making Notion optional now or accepting the tech debt.
    Recommendation: make Notion optional in W1 since the UI cost is
    cheap and it removes a real blocker for trial signups.*
    *Depends on: step 1.*

12. **Onboarding ingest hook.** Trigger `ingestLast24h(userId)` in
    the user-creation path or the post-onboarding redirect handler
    so the first-load Inbox isn't empty. Best fit: a server action
    on the "finish onboarding → /app" transition.
    *Depends on: steps 8 + 11.*

13. **Audit log entries.** Verify every email-side write
    (`inbox_items` insert, rule application, ingest run) emits an
    `audit_log` row. Add a `lib/agent/email/audit.ts` helper. Cheap
    once the conventions are clear. *Depends on: steps 6 + 8.*

14. **Tests.** Per-bucket fixture + assertion in
    `tests/agent-email-rules.test.ts`. Negative-match tests. Sidebar
    test updates. Onboarding-status update test. Gmail-fetcher unit
    test stubbed against fixture JSON.
    *Depends on: steps 5 + 6 + 9 + 11.*

15. **Sentry instrumentation around Gmail calls.** Wrap
    `getGmailForUser`, `listRecentMessages`, `getMessage` so that
    OAuth failures and rate-limits are captured with the user id as a
    tag. *Depends on: step 7.*

16. **Type-check + test pass.** `pnpm typecheck`, `pnpm test`,
    `pnpm build`. Fix any drift. *Depends on: everything above.*

17. **Manual smoke test.** Sign in as a fresh test-user account, go
    through onboarding (granting Gmail), confirm the first-24h ingest
    populates the Inbox sidebar with 1+ items, confirm the bucket
    distribution roughly matches the L1 spec. Document findings in a
    short addendum. *Depends on: 16.*

Steps that depend on a Phase-5 module the investigation could not
verify exists:
- **None.** Every Phase 5 module the W1 plan touches (`accounts`
  table, `audit_log`, `usage_events`, encrypted adapter, scope
  detection in `getOnboardingStatus`) is verified present in HEAD.

---

## 5. Open questions for Ryuto

These need a product decision before W1 code can start. Each is
specific and not answered in current memory.

1. **Onboarding: bite the bullet on the rewrite, or strictly additive?**
   - Option A: in W1, do the full memory-locked 3-step rewrite (Step 2
     = Gmail). Largest delta in W1 but no tech debt.
   - Option B: insert Gmail as a 4th/5th step alongside existing Notion
     flow; flip Notion to optional in the same change. Medium delta;
     the cleanest middle ground.
   - Option C: bare-minimum additive — append Gmail as Step 5, leave
     Notion required. Smallest delta but explicitly contradicts memory
     (C2). Worst long-term.
   - Recommendation: **B**.

2. **Ignore-bucket retention.** Should W1 persist `inbox_items` rows
   for items that L1 rules send to the IGNORE bucket, so we can
   measure false-negative rescue rate (per memory: "false-negative
   rescue count" is a tracked α metric)? Storage cost is negligible
   for α; analytic value is real. Recommendation: **yes, store with
   `bucket='ignore'` and `status='dismissed'` defaulted at insert**,
   prune at 30d.

3. **Gmail polling vs Pub/Sub watch.** The first-24h ingest is one-shot,
   but ongoing ingest (W3) needs *something*. Decision can wait till
   W3, but if Pub/Sub watch is the eventual answer, W1 should at least
   confirm the GCP project has the right APIs enabled (operator action,
   not code). Flag here so it's not forgotten.

4. **Notion `discoverResources()` runs on every chat send** — see
   [lib/agent/orchestrator.ts:69](lib/agent/orchestrator.ts:69). When
   Notion goes optional, this becomes a no-op for users without Notion;
   that's fine. But if a user *connects* Notion mid-trial, do we
   re-trigger ingest of recent emails (since Notion now adds class-
   relation context)? Recommendation: **no, leave it** — adds W2
   complexity that the α user count doesn't justify.

5. **Sidebar behavior for users mid-rollout.** Existing users (incl.
   Ryuto's admin) won't have Gmail scope until they re-OAuth. Do we:
   - (a) show the Inbox sidebar item with an empty "connect Gmail"
     state, or
   - (b) hide the Inbox item entirely until Gmail connects?
   Memory locks the *position*, not the *visibility-when-disconnected*.
   Recommendation: **(a)** — keeps the layout stable across re-auth
   and educates users about the new feature.

6. **Audit log volume.** Every triaged email = 1+ `audit_log` rows.
   For a heavy student inbox (50 emails/day) that's ~1500 rows/user/
   month. At 10 α users, ~15k/mo. Fine. Just confirm the table doesn't
   grow indexes that get hot — current schema has no index on
   `audit_log` other than the PK. Probably fine for α.

---

## 6. Assumptions made

Listed so Ryuto can correct anything that's wrong.

**Memory-staleness assumptions.**
- `feedback_prompts_in_english.md` carried a system-reminder noting
  it's 3 days old; treated content as current since nothing in repo
  contradicts it.
- The agent-model memo says the Phase 5 W2 credit-enforcement bridge
  is the integration point for Phase 6 — but no callsite for
  `assertCreditsAvailable` exists in `lib/`. **Assumed**: the bridge
  was *partially* built (the function exists, the call hookup was
  deferred). The W1 prompt should treat hookup as a W2 task.

**Code-state assumptions.**
- `prompt: "consent"` + Auth.js will re-issue a fresh consent screen
  when the scope string changes. Verified empirically by Google docs;
  not unit-tested in this repo.
- The `accounts.scope` field is a single space-delimited string after
  Google issues consent (matches Google's response shape). Encryption
  does not touch the `scope` column.
- Vitest mocks are sufficient for L1 rule unit tests — no Postgres
  needed. Confirmed by inspecting existing test patterns.
- The Inbox sidebar entry's icon is the lucide `Inbox` icon (memory
  doesn't specify; this is consistent with memory's "Lucide icons
  only" rule).
- `users.timezone` is in IANA format (e.g. `America/Vancouver`) when
  set. Validated by [lib/agent/preferences.ts:65-72](lib/agent/preferences.ts:65)
  using `Intl.DateTimeFormat`.
- `is_admin` users should still see the Inbox item (no admin-specific
  hide path). Memory doesn't say otherwise.
- Drizzle's `JSONB` column type maps to TS `unknown` unless a
  `$type<...>` cast is used. The proposed `rule_provenance` and
  `source_metadata` JSONB fields will need `$type<...>` declarations
  in `schema.ts`.

**Product assumptions** (pulled from memory; flagging if I built on a
secondary inference):
- Notion stays *connectable* in W1; only the *requirement* to connect
  goes away. Trial start no longer gates on Notion completion.
- Risk-tier classification (low/medium/high) is per-`inbox_item` and
  per-`agent_draft`, not per-`agent_rule`. Rules contribute *bucket*
  (ignore/low/medium/high), and the L2 classify pass refines into
  risk tiers.
- The user's primary Gmail label set is sufficient — no custom Gmail
  labels are created by W1. Memory doesn't say to create labels; if
  product wants e.g. "Steadii/Triaged", that's a separate decision.
- The `events.createUser` Auth.js hook fires *before* onboarding
  redirect; therefore inserting an `ingestLast24h` call there is
  safe even though the user hasn't granted Gmail yet (the call no-ops
  on `GmailNotConnectedError`). Verified by inspecting
  [lib/auth/config.ts:53-66](lib/auth/config.ts:53).

**Out-of-scope work assumed deferred** (per W1 memo, restating for
clarity):
- L2 LLM (classify + draft): W2.
- Per-feature pause behavior on credit cap exhaustion: W2.
- Confirm UX, digest, Settings → Agent Rules: W3.
- Staged autonomy rollout, dogfood metrics: W4.
- Service worker / web push, mobile shell: post-α.
- Multi-language keyword expansion beyond EN/JA: post-α.
- L3 user-feedback learning: post-α.

---
