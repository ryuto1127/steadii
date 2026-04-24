# Steadii Phase 6 W3 — Confirm UX + 7am Digest + Settings Transparency + Undo Send

## Context

You are the implementation engineer for Steadii. This is **W3 of Phase 6** (agent core). W1 shipped Gmail OAuth + L1 rule triage + Inbox schema + 24h ingest. W2 shipped the L2 pipeline (risk pass → deep pass with retrieval → draft), email_embeddings infra, credit gate, supervisor role, and a batch of post-review refinements. Both are merged to main. Dogfood has started — `agent_drafts` is populating, retrieval provenance is rich, risk classification is accurate on sample.

W3 is the **α-launch-blocker week**. After W3 + W4 (dogfood metrics + staged autonomy), we invite 10 users. The value proposition the product actually delivers to them lives almost entirely in the surfaces this week ships:

- **Users review + send drafts** → confirm UX, 20s undo, `gmail_send` tool
- **Users see agent reasoning** → "Why this draft" panel, "Thinking · complete" summary bar
- **Users control the agent** → Settings → Agent Rules (transparency) + Notifications
- **Users stay in the loop without opening the app** → 7am email digest

Phase 6 outline (for your map):
- W1 ✅ Gmail OAuth + L1 + Inbox schema + 24h ingest
- W2 ✅ L2 (risk + deep + draft) + embedding cache + credit bridge
- **W3 (this prompt)**: Confirm UX + digest + Settings transparency + undo/send
- W4: Staged autonomy + dogfood metrics + glass-box narrative in landing/onboarding

## Read before starting

Auto-memory (under `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/`):

- `MEMORY.md` — index
- `project_steadii.md` — product overview
- `project_agent_model.md` — **authoritative**. Especially: "Safety / anti-misfire design", "Email digest design", "Settings UI design", "Agent UI placement" sections.
- `project_decisions.md` — **read the 2026-04-23 entries** for tier rule (same features all tiers; credit volume is the only axis) + glass-box brand + Phase 6/7 rescoping.
- `project_pre_launch_redesign.md` — the Inbox/chat UX pattern is locked: "Inbox view is a full-screen triage queue; opening an item → chat-style draft review UI"
- `feedback_role_split.md` + `feedback_prompts_in_english.md`

Repo docs:
- `docs/handoffs/phase6-prew1-scoping.md` — repo state pre-W1 (many references still valid)
- `docs/handoffs/phase6-w1.md` — W1 scope/decisions
- `docs/handoffs/phase6-w2.md` — W2 scope/decisions
- `AGENTS.md` — test/commit/migration conventions

Key W2 artifacts to build on:
- `lib/agent/email/l2.ts` — pipeline; populates `agent_drafts`
- `lib/agent/email/retrieval.ts` — cosine retrieval helper
- `lib/agent/email/thread.ts` — inbox-local thread lookup (last 2 messages in same thread)
- `lib/agent/email/embeddings.ts` — embed-on-ingest + CLI backfill

## Decision precedence

**Memory files (esp. the 2026-04-23 entries) are authoritative.** If you find code that contradicts them, fix the code — don't preserve the contradiction. Notable constraints in effect:

- **No tier-gating**: Free / Student / Pro get identical draft review, same digest, same undo, same transparency. Credit volume is the only axis.
- **Glass-box narrative**: reasoning is always surfaced; retrieval sources always show; "nothing happens secretly" is the product promise.
- **No draft auto-sent**: every outbound reply goes through explicit user confirm + 20s undo window. No exceptions in W3.

Locked-decision conflicts not already handled (as of post-W2):
- **C5** (first-time domain role picker) — W3 ships this UI.
- **C9** (Settings → Agent Rules page) — W3 ships this.
- **C10** (Home Dashboard "pending: N" 4th card) — W3 ships this.
- **C11** (Header notification bell) — W3 ships this.

## Environment

- **Test mode**: Google Cloud Console stays in Testing through all of Phase 6. No CASA verification work in W3.
- **Email vendor**: **Resend** (sparring-side decision; see §"Decisions handed over"). Free tier 3k emails/month is enough for α × 1 digest/day × 10 users × 30 days = 300 emails. Add `RESEND_API_KEY` to env.
- **Cron**: **Vercel cron** via `vercel.json`. Free on Hobby, sufficient for one polling job.
- **pgvector**: already enabled (W2). No new extension work.
- **Neon**: standard migrations via `pnpm db:migrate`. Migration numbering continues from 0015.

## Scope of W3 (strictly)

**In scope:**

1. **`/app/inbox/[id]` draft review page** — server component, queries inbox_items + agent_drafts. Layout per the pre-launch-redesign mockup:
   - Header: sender, subject, received_at, tier pill
   - "Thinking · complete" summary bar rendering `retrieval_provenance` (X emails surfaced of Y total, sources with similarity scores)
   - Agent proposed action (draft_reply / archive / snooze / no_op / ask_clarifying / paused) with clear treatment for each
   - "Why this draft" panel — `agent_drafts.reasoning` rendered as bullets where the model used structured format, else paragraph
   - Draft body (read-only textarea) + inline Edit mode
   - Action buttons per state (Send / Edit / Snooze / Archive / Dismiss)
2. **`gmail_send` tool** — new, in `lib/agent/tools/gmail.ts` or similar. Uses `users.drafts.create` then `users.drafts.send`. Required: draft_id returned to DB. Tool mutability=`destructive` so confirmation is mandatory regardless of user mode.
3. **`send_queue` table + worker** — delayed send via a pending row with `send_at` timestamp. Cron (or setTimeout fallback for α) dispatches rows where now ≥ send_at. Per-row cancel via DELETE within the 20-second window.
4. **Undo UX** — after Send click: agent_draft transitions to `status='sent_pending'`, inserts a send_queue row with send_at = now + 20s, returns to user with a sticky "Sent · undo (20s)" toast. On undo: delete send_queue row, agent_draft back to `status='approved'`. On timeout: worker runs Gmail send, updates `agent_drafts.status='sent'` + records `gmail_sent_message_id`.
5. **Home dashboard 4th card** — "Pending: N items" where N = count(agent_drafts WHERE status='pending' AND action IN ('draft_reply', 'ask_clarifying') AND userId). Position: first in the grid (ahead of Today's schedule), per memory: "Home Dashboard gains a 4th card showing 'pending: N items' agent summary". Card links to `/app/inbox`.
6. **Header notification bell** — server component rendered in `app/app/layout.tsx`. Bell icon in top-right of main island. On hover or click, popover shows 3–5 most-recent HIGH-risk pending drafts with clickable rows → `/app/inbox/[id]`. No polling; relies on Next.js refresh on navigation (fine for α).
7. **Settings → Agent Rules section** — new dedicated page OR subsection in existing Settings. Per memory has 3 subsections:
   - **A. Global rules** (read-only): AUTO_HIGH keywords, IGNORE patterns from `lib/agent/email/rules-global.ts`. Tooltips explain each rule.
   - **B. Learned contacts** (editable): table of rows from `agent_rules` table. Columns: sender/domain · role · risk tier · source (learned / manual / chat) · delete button.
   - **C. Custom overrides** (editable) → **DEFERRED per memory** (post-α chat-based natural-language rule creation). Ship A and B only.
8. **Settings → Notifications section** — digest hour picker (smallint 0-23, default 7), digest enabled toggle (default true), undo window slider (10-60s, default 20, stored in a new `undo_window_seconds` column on users), high-risk immediate on/off toggle (for future push; W3 ships the toggle, backend no-ops since push isn't wired).
9. **7am digest email** — Resend-backed, fired by Vercel cron every 30 min. Cron picks users whose `digest_hour_local` × user tz ∈ [now-30min, now]. Build message: N pending drafts (high-risk first), per-item summary (1 line each), deep link to `/app/inbox/[id]`. **Never include body preview** (per memory — user must open Steadii to see/confirm drafts). Skip sending if pending = 0. From-name: "Steadii Agent". Subject: dynamic content-aware ("3 drafts ready — 1 urgent" etc.).
10. **Gmail thread fetch beyond inbox_items** — upgrade `lib/agent/email/thread.ts` so if the inbox-local lookup returns < 2 messages for a thread, fall back to Gmail API `users.threads.get` to retrieve the prior 2 messages. Required for threads where some predecessors landed in `bucket='ignore'` or were received before the 24h ingest window.
11. **Auto-trigger ingest on first Gmail-scope detection** — in `app/app/layout.tsx`, detect "gmail scope granted AND zero inbox_items rows for this user AND no recent ingest attempt". Fire `ingestLast24h` in a server action (fire-and-forget with `void`). Record "last ingest attempt at" on `users` table (new column `last_gmail_ingest_at`, timestamptz nullable) so repeated page loads don't spam.
12. **First-time-sender role picker dialog** — when opening an inbox item where `first_time_sender=true` AND no `agent_rules` row exists for that sender, show a modal: "Who is this sender? Professor / TA / Classmate / Admin / Supervisor / Other". Selection writes to `agent_rules` (scope='sender', match_value=senderEmail, sender_role=chosen, source='manual'). Dismissal is allowed but the modal re-appears on next open until resolved.
13. **`gmail_send` credit metering** — the send itself is NOT credit-metered (it's a Gmail API call, not an LLM call). But log it in `audit_log` with `action='gmail.send'`.
14. **Tests**:
    - `tests/send-queue-undo.test.ts` — enqueue, cancel within 20s, auto-send after 20s (time-mocked).
    - `tests/gmail-send-tool.test.ts` — tool schema + execute path with mocked Gmail API.
    - `tests/digest-renderer.test.ts` — build digest for user with N pending drafts; assert subject + body shape + skip-on-zero behavior.
    - `tests/cron-digest-picker.test.ts` — given a set of users with various `digest_hour_local`/tz, assert which ones get picked in a given 30-min window.
    - Updates to any existing test that checks inbox-page markup (a new "Pending" Home card appears).
15. **Sentry instrumentation** — spans around Gmail send, digest build, cron tick.

**Explicitly out of scope for W3:**

- Settings → Agent Rules subsection C (chat-based natural-language rule creation) → post-α
- Data export / download-my-data → post-α
- Fine-grained notification tuning (per-tier, per-rule) → post-α
- Web push notifications (service worker + VAPID) → post-α (memory: "iOS-heavy user base → email digest is primary")
- Mobile PWA tuning → post-α (memory: web-only α)
- Pro+ tier → Phase 7
- Multi-source retrieval (Syllabus / Mistakes / Classroom / Calendar embeddings) → Phase 7 W1
- Glass-box copy in landing page / onboarding → W4
- Staged autonomy rollout (W4 Day 4-7 "low-risk fire-and-report") → W4
- Multi-language keyword expansion beyond EN/JA → post-α
- Retrieval precision metric collection → W4

## Concrete decisions handed over

Do not re-litigate:

1. **Email vendor: Resend.** Not Postmark, not SES. Rationale: lowest-effort SDK, free tier covers α comfortably, good DX for dynamic subjects. Package: `resend`.
2. **Cron: Vercel cron** via `vercel.json`. Endpoint: `/api/cron/digest` protected by `CRON_SECRET` header. Runs every 30 minutes.
3. **Undo window default: 20s.** Configurable per-user via `users.undo_window_seconds` (10-60s slider in Settings). Worker dispatches at `send_at = sent_at + undo_window_seconds`.
4. **Send queue implementation: DB table, not in-memory or external queue.** `send_queue` has `agent_draft_id`, `user_id`, `gmail_draft_id` (Gmail's own draft resource), `send_at`, `attempted_at`, `status` (`pending`/`sent`/`cancelled`/`failed`). Cron picks rows where `status='pending' AND send_at <= now()`.
5. **Two-step Gmail send flow**: (a) `users.drafts.create` on Send click — gives Gmail a draft ID the user could also see in their Gmail UI; (b) `users.drafts.send` when undo window elapses — promotes draft to sent. On undo: `users.drafts.delete`.
6. **Digest subject is dynamic, not templated.** Build it in code from the pending count and risk distribution. Examples:
   - "3 drafts ready — 1 urgent, 2 routine"
   - "⚠️ High-risk item needs attention"
   - "Light day: 2 drafts"
   - Skip sending if pending = 0 (memory: "never train 'it's OK to ignore' reflex")
7. **Digest body: subject + deep link per item, no body preview.** Memory explicitly forbids body preview (would let users reply from Gmail, bypassing confirm).
8. **Digest from-name: "Steadii Agent"**, not Ryuto's name, not blank. Explicit agent identity.
9. **Notification bell content: 3-5 highest-risk pending items**, ordered by risk DESC then received_at DESC. No grouping, no unread counts, no dot. Keep minimal.
10. **Role picker options: Professor / TA / Classmate / Admin / Supervisor / Other.** Order matters (most common student contact first). "Supervisor" added per the earlier sparring decision — maps to AUTO_HIGH.
11. **Auto-ingest trigger frequency: once per user, then rate-limited to 24h.** `users.last_gmail_ingest_at` tracks last successful attempt. Layout check: if scope granted AND (last_gmail_ingest_at IS NULL OR last_gmail_ingest_at < now - 24h), fire ingest (fire-and-forget). Don't block render.
12. **Thread fetch via Gmail API: read-only scope already granted (`gmail.modify`).** Use `users.threads.get` with `format='metadata'` to get just the sender + snippet (not full body — save tokens). Bound to 2 predecessors max.
13. **Home card order (final)**: `Pending` / `Today's schedule` / `Due soon` / `Past week`. 4 cards, grid adjusts from 3-col to 4-col responsively.
14. **Settings IA decision**: Agent Rules + Notifications are subsections of a single Settings page (not separate routes). Distinct `<Section>` blocks, each with an anchor link for direct-navigation.
15. **Digest link format**: `https://mysteadii.xyz/app/inbox/${draftId}?utm_source=digest`. The utm lets W4 dogfood metrics distinguish digest clicks from in-app opens.

## Schema additions

Edit `lib/db/schema.ts`, then `pnpm db:generate`. Commit as `0016_*.sql`. Hand-writing needed only if Drizzle Kit can't express an index.

### Tables

**`send_queue`** (new):

Columns:
- `id` uuid PK
- `user_id` uuid FK → users ON DELETE CASCADE
- `agent_draft_id` uuid NOT NULL FK → agent_drafts ON DELETE CASCADE
- `gmail_draft_id` text NOT NULL (from Gmail's `users.drafts.create` response)
- `send_at` timestamptz NOT NULL
- `status` text NOT NULL default `'pending'` — `'pending'|'sent'|'cancelled'|'failed'`
- `attempt_count` integer NOT NULL default 0 (for retry handling)
- `last_error` text nullable
- `sent_gmail_message_id` text nullable (filled on successful send)
- `created_at`, `updated_at`

Indexes:
- `(status, send_at)` for cron dispatcher
- `(user_id, status)` for per-user pending view
- `(agent_draft_id)` UNIQUE — one pending send per draft at a time

### Column additions

**`users`**:
- `undo_window_seconds` smallint NOT NULL default 20
- `digest_enabled` boolean NOT NULL default true (may already exist from W1 — check + don't duplicate)
- `digest_hour_local` smallint NOT NULL default 7 (likely already exists from W1 — check)
- `last_gmail_ingest_at` timestamptz nullable
- `last_digest_sent_at` timestamptz nullable (to prevent double-sends if cron fires twice in a 30-min window)
- `high_risk_notify_immediate` boolean NOT NULL default true (toggle for future push; no-op for now)

**`agent_drafts`**:
- `status` enum extended to include `'sent_pending'` (in-flight undo window). TS type change only — DB column is text.
- `approved_at` timestamptz nullable (already exists from W2 — verify)
- `sent_at` timestamptz nullable (already exists — verify)
- `gmail_sent_message_id` text nullable (already exists — verify)

Drizzle type export updates for `SendQueue`, `NewSendQueue`, `AgentDraftStatus` (add `'sent_pending'`).

## Implementation order

Each step ≈ half a day. Target: ~1.5 weeks total.

**Week 1 — backend plumbing**

1. **Schema migration (`0016_*.sql`)** — send_queue table + users column additions. Verify no duplicate columns with W1/W2 migrations before generating.
2. **Resend wiring** — install `resend`, add `RESEND_API_KEY` to `lib/env.ts`, create `lib/integrations/resend/client.ts` with a simple factory.
3. **Digest renderer** — `lib/digest/build.ts` exporting `buildDigestPayload(userId): Promise<{subject, html, text, recipientCount} | null>`. Null when pending=0. Pure function given inputs; unit-testable.
4. **Cron endpoint** — `app/api/cron/digest/route.ts` protected by `CRON_SECRET` header. Fetches eligible users for the current 30-min window, calls `buildDigestPayload`, sends via Resend, updates `last_digest_sent_at`. Fire-and-forget per user (failures logged to Sentry + audit_log, don't block other users).
5. **`vercel.json`** — add cron config: `{"crons": [{"path": "/api/cron/digest", "schedule": "*/30 * * * *"}]}`. Verify Vercel Hobby plan supports (it does — max 2 jobs).
6. **Gmail send tool** — `lib/agent/tools/gmail.ts` with `gmail_send` tool (drafts.create + drafts.send helpers). Return `{ gmail_draft_id, gmail_message_id }`. Sentry-wrap.
7. **Send queue worker** — `app/api/cron/send-queue/route.ts` (second cron) fires every minute, dispatches `send_queue` rows with `status='pending' AND send_at <= now()`. **Add to vercel.json — this is the second cron job.**
8. **Undo server actions** — `approveAgentDraftAction(draftId)` (creates gmail_draft + send_queue row, transitions status to sent_pending), `cancelPendingSendAction(draftId)` (deletes send_queue row, deletes gmail_draft, transitions status back to approved), `dismissAgentDraftAction(draftId)` (sets status=dismissed), `snoozeAgentDraftAction(draftId, until)` (sets status=snoozed with resolved_at).
9. **Thread fetch upgrade** — modify `lib/agent/email/thread.ts`: if inbox-local lookup returns <2, fall back to `users.threads.get`. Keep Gmail API pull lean (metadata format only). Memoize per pipeline run.
10. **Auto-ingest hook** — in `app/app/layout.tsx`, on every render check users.last_gmail_ingest_at + scope. Fire fire-and-forget if stale. Update users row when attempted.

**Week 2 — user-facing surfaces**

11. **Draft review page `/app/inbox/[id]/page.tsx`** — server component. Loads inbox_item + its agent_draft (via inbox_item_id). Renders per the layout above (header, thinking bar, reasoning, body, actions).
12. **"Thinking · complete" component** — `components/agent/thinking-bar.tsx`. Inputs: `retrieval_provenance` shape. Renders a row of chips: "{returned} of {total_candidates} emails" + per-source pill (first 3 shown + "{N} more" overflow). Sources clickable → opens a small popover with snippet.
13. **"Why this draft" component** — `components/agent/reasoning-panel.tsx`. Inputs: reasoning string. If reasoning contains bullet markers (`-` or `•` or numbered), render as list. Else render as paragraph. Max 400 chars visible, click-to-expand.
14. **Action buttons** — Send (solid, primary), Edit (outline), Snooze (outline with dropdown: 1h / tomorrow / next week), Dismiss (subtle).
15. **Undo toast** — client component `components/agent/undo-toast.tsx`. Shown after Send click. Countdown from 20s (or user's undo_window_seconds). Undo action calls `cancelPendingSendAction`. Auto-dismisses after window.
16. **Edit mode** — toggles draft body into an editable textarea. On Save: PATCH via server action to update `agent_drafts.draft_body`, reset status to 'pending'. No LLM re-run for manual edits.
17. **Inbox list link through** — update `/app/inbox/page.tsx` so clicking an item navigates to `/app/inbox/[id]` (currently hrefs to `/app/inbox` placeholder).
18. **Home 4th card** — edit `app/app/page.tsx`. Add PendingCard in position 0. Query: `count agent_drafts WHERE userId=$1 AND status='pending' AND action IN ('draft_reply','ask_clarifying')`.
19. **Header notification bell** — `components/layout/notification-bell.tsx` server component. Inserted in `app/app/layout.tsx` header. Query: top 5 high-risk pending drafts. Popover UI via `<details>` or a small Popover primitive. Each row: sender · subject · tier · link.
20. **First-time-sender role picker modal** — `components/agent/role-picker-dialog.tsx`. Shown via search-params trigger (`?askRole=1`) or client-state. Writes to `agent_rules`. Six options.
21. **Settings → Agent Rules subsection** — `components/settings/agent-rules.tsx`. Three sub-areas: A (read from `lib/agent/email/rules-global.ts`), B (query `agent_rules` where user_id=$1), C (coming-soon placeholder).
22. **Settings → Notifications subsection** — `components/settings/notifications.tsx`. Three controls: digest hour, digest enabled toggle, undo window slider. Each wired to a server action that writes to `users`.
23. **Provenance labels** — add 🌐 / 🧠 / 💬 / ⚙️ mini-icons next to each rule display per memory's "Provenance labels on every rule". Tooltip says what the icon means.
24. **Tests** (all listed in §In scope).
25. **Typecheck + test + build** green. Fix drift.
26. **Manual smoke** on Ryuto's dev account: send a test email to yourself → agent drafts a reply → Send → watch undo toast → wait → check Gmail inbox for actually-sent message. Also: Wait for next digest-cron-window tick and verify email arrives (or send a one-off via a dev route).

## Test expectations

- Vitest `environment: node`. Match existing mock patterns.
- Time-mocked tests for undo window (use `vi.useFakeTimers()`).
- Mocked Resend client via `vi.mock('@/lib/integrations/resend/client')`.
- Mocked Gmail API (`googleapis` via `vi.mock`).
- Coverage target: every new server action + every new cron endpoint.
- No tests that hit real Resend, real Gmail, real Neon, real OpenAI.

## Commit strategy

Keep commits per-feature. ~20 expected.

Suggested split (some in parallel Safe):

1. `feat(db): send_queue + users column additions`
2. `feat(integrations): Resend client factory`
3. `feat(digest): renderer (buildDigestPayload)`
4. `feat(api): /api/cron/digest endpoint + vercel.json`
5. `feat(agent): gmail_send tool`
6. `feat(api): /api/cron/send-queue worker`
7. `feat(agent): approve/cancel/dismiss/snooze server actions`
8. `feat(agent): thread fetch falls back to Gmail API when inbox-local empty`
9. `feat(app): auto-trigger ingestLast24h on first Gmail-scope detection`
10. `feat(ui): draft review page at /app/inbox/[id]`
11. `feat(ui): ThinkingBar component`
12. `feat(ui): ReasoningPanel component`
13. `feat(ui): action buttons + edit mode + undo toast`
14. `feat(ui): inbox list → detail navigation`
15. `feat(home): pending-count card (4th dashboard tile)`
16. `feat(ui): header notification bell`
17. `feat(ui): first-time-sender role picker modal`
18. `feat(settings): Agent Rules section (A + B)`
19. `feat(settings): Notifications section (digest + undo)`
20. `feat(ui): provenance icons on every rule`
21. `test(agent): send-queue + undo + digest + gmail-send coverage`
22. `chore(observability): Sentry spans for Gmail send + digest + cron`

Each commit passes `pnpm typecheck && pnpm test` independently. Do not squash.

## Success criteria / deliverable

W3 is done when:

- [ ] `pnpm typecheck && pnpm test && pnpm build` all green
- [ ] `pnpm db:migrate` applies 0016_* cleanly
- [ ] `vercel.json` contains the 2 cron entries
- [ ] `RESEND_API_KEY` added to env schema (Ryuto sets the actual secret in Vercel)
- [ ] Fresh smoke: click Send on a draft → toast appears → wait 20s → Gmail shows the sent email → `agent_drafts.status='sent'` → `send_queue.status='sent'` → audit_log has the send event
- [ ] Fresh smoke: click Send → Undo within 20s → no Gmail send → `agent_drafts.status='approved'` → `send_queue` row deleted
- [ ] Manually POST to `/api/cron/digest` with `CRON_SECRET` header → if pending drafts exist, Resend fires an email to Ryuto's address
- [ ] Home dashboard shows "Pending: N" card with accurate count
- [ ] Header bell popover shows top-5 high-risk items
- [ ] First click into an inbox item from an unknown sender triggers the role picker modal
- [ ] Settings → Agent Rules shows Global + Learned sections with correct provenance icons
- [ ] Settings → Notifications lets Ryuto change digest hour + undo window (values persist on reload)
- [ ] Branch `phase6-w3` off main (no rebase needed — sparring side handles rebase + merge)
- [ ] Report posted: sample agent_drafts processed counts, per-tier distribution, observations from Ryuto's dogfood sample
- [ ] Do NOT merge yourself — sparring side handles via `gh pr create` + `gh pr merge`

## If you get stuck

- **Resend's rate limit**: 2 emails/sec on free tier. Per-user cron dispatch should be fine at α. If hit, add a minimal in-process queue.
- **Vercel cron doesn't fire locally**: normal. Use a dev route `/api/cron/digest-local` gated by NODE_ENV=development for manual testing.
- **Gmail `users.drafts.create` returns Permission denied**: scope is `gmail.modify` (W1) which includes drafts.*. If mis-configured, re-verify OAuth consent screen in Cloud Console.
- **`users.threads.get` returns empty in metadata format**: fall back to `format='full'` for that specific call. Rare.
- **Undo worker doesn't fire on time**: verify vercel.json syntax + check Vercel cron logs. For dev, use `setTimeout` fallback.
- **Locked-decision conflict not listed here (C1-C12)**: stop-and-surface in a 3-line summary + 2 options. Do not silently decide.

## Post-W3 follow-ups (flag in the PR description, don't implement)

- Rules C (chat-based natural-language rule creation)
- Fine-grained notification preferences (per-rule mute)
- Digest subject A/B test for open-rate optimization
- Cron → Inngest migration for finer scheduling (per-user 7am instead of 30-min polling)
- Per-user digest analytics (open rate, CTR)
- Web push notifications for high-risk items (after mobile path ships)
