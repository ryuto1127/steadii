# DEPLOY.md — Steadii α pre-launch checklist

Run through this before inviting the first ten users. Every item gets
explicitly verified — no assumptions.

Product-level decisions (pricing, tiers, agent scope, visual language) are
not repeated here; read `project_decisions.md` and `project_agent_model.md`
in the Claude memory for those.

---

## Stripe catalog (run once before α launch)

The full Stripe Products + Prices + Coupons catalog (USD + JPY) is created
idempotently by `scripts/stripe-setup.ts`. Run before populating §1 env
vars and before the first checkout test.

1. [ ] `pnpm tsx scripts/stripe-setup.ts` — creates USD + JPY catalog
       in test mode. Idempotent; safe to re-run.
2. [ ] Paste the printed `STRIPE_PRICE_*` lines into `.env.local`
       (drop in alongside the existing infra keys).
3. [ ] Propagate the same lines to **Vercel Production AND Preview**
       (Settings → Environment Variables → import .env). Both envs need
       identical IDs because Stripe price IDs are global per account.
4. [ ] Verify the locale-based currency picker at `/checkout`: a JA
       locale (Accept-Language: ja) sees JPY prices; en sees USD. The
       choice is driven by `users.preferred_currency` once set; first-
       visit defaults to locale.
5. [ ] Spot-check the JPY top-up Checkout flow end-to-end with the
       Stripe test card `4242 4242 4242 4242` (any future expiry,
       any CVC). Verify the webhook fires and `topup_balances`
       increments.

---

## 1. Environment variables (Vercel Production + Preview)

Pull from `.env.example` as the canonical list.

**Infra**
- [ ] `DATABASE_URL` — Neon prod branch connection string
- [ ] `AUTH_SECRET` — `openssl rand -base64 32`
- [ ] `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- [ ] `AUTH_MS_ID`, `AUTH_MS_SECRET` — Phase 7 W-Integrations.
      Register an app at https://entra.microsoft.com → App registrations,
      multi-tenant (or single-tenant if you want to lock to one school
      domain). Add redirect URI `${APP_URL}/api/auth/callback/microsoft-entra-id`.
      Required Graph delegated scopes: `User.Read`, `Calendars.Read`,
      `Tasks.Read`, `offline_access`. Leave blank if MS integration is
      out of scope for the current rollout.
- [ ] `AUTH_MS_TENANT_ID` — `common` for multi-tenant (default), or a
      specific tenant GUID / domain for single-tenant lock-down.
- [ ] `ENCRYPTION_KEY` — `openssl rand -base64 32` (32-byte)
- [ ] `APP_URL` — `https://mysteadii.com`
- [ ] `BLOB_READ_WRITE_TOKEN` — Vercel Storage → Blob store token
- [ ] `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`

**Notion**
- [ ] `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`

**OpenAI**
- [ ] `OPENAI_API_KEY`
- [ ] `OPENAI_CHAT_MODEL` / `OPENAI_COMPLEX_MODEL` / `OPENAI_NANO_MODEL` —
      blank to use defaults, or override if the default IDs aren't live
      on the account yet

**Stripe — keys**
- [ ] `STRIPE_SECRET_KEY` (test mode during α — `sk_test_...`)
- [ ] `STRIPE_WEBHOOK_SECRET` — copy after creating the webhook endpoint

**Stripe — catalog** (populated by `pnpm tsx scripts/stripe-setup.ts`, then
paste output into Vercel env)
- [ ] `STRIPE_PRICE_PRO_MONTHLY`
- [ ] `STRIPE_PRICE_PRO_YEARLY`
- [ ] `STRIPE_PRICE_STUDENT_4MO`
- [ ] `STRIPE_PRICE_TOPUP_500`
- [ ] `STRIPE_PRICE_TOPUP_2000`
- [ ] `STRIPE_PRICE_DATA_RETENTION`
- [ ] `STRIPE_COUPON_ADMIN`
- [ ] `STRIPE_COUPON_FRIEND_3MO`
- [ ] `STRIPE_PRICE_ID_PRO` — legacy alias; set to the same value as
      `STRIPE_PRICE_PRO_MONTHLY` until the last caller migrates off

**Stripe — JPY catalog** (Phase 7 W1, JP α launch). Created by the same
`stripe-setup.ts` script; users see JPY prices when their `users.preferred_currency`
is `jpy`. Locale-based currency selection lands at /checkout — see §6.5.
- [ ] `STRIPE_PRICE_PRO_MONTHLY_JPY`
- [ ] `STRIPE_PRICE_PRO_YEARLY_JPY`
- [ ] `STRIPE_PRICE_STUDENT_4MO_JPY`
- [ ] `STRIPE_PRICE_TOPUP_500_JPY`
- [ ] `STRIPE_PRICE_TOPUP_2000_JPY`
- [ ] `STRIPE_PRICE_DATA_RETENTION_JPY`

---

## 2. Databases

- [ ] Neon prod branch provisioned
- [ ] `pnpm db:migrate` applied on prod DB (latest: 0021,
      `mistake_notes.source` for handwritten OCR — all migrations
      through Phase 7 W-Integrations including `ical_subscriptions`,
      `integration_suggestions`, `mistake_note_chunks`,
      `syllabus_chunks`, `inbox_items.class_id` etc.)
- [ ] Ryuto's own user row has `is_admin = true` (set via Neon SQL editor
      or Drizzle Studio — the previous redemption-based admin mechanism
      was removed)

---

## 3. Google OAuth

- [ ] Google Cloud project OAuth consent screen: Testing mode
- [ ] Scopes (matches `lib/auth/config.ts`):
  - `openid email profile`
  - `https://www.googleapis.com/auth/calendar`
  - `https://www.googleapis.com/auth/calendar.events`
  - `https://www.googleapis.com/auth/tasks`
  - `https://www.googleapis.com/auth/classroom.courses.readonly`
  - `https://www.googleapis.com/auth/classroom.coursework.me.readonly`
  - `https://www.googleapis.com/auth/classroom.announcements.readonly`
- [ ] All ten α users added as test users in Google Cloud Console
- [ ] OAuth redirect URIs include both:
  - `http://localhost:3000/api/auth/callback/google`
  - `https://mysteadii.com/api/auth/callback/google`

---

## 4. Notion (optional — one-way import only post-migration)

Notion is **no longer canonical** for any Steadii entity (per the
2026-04-25 Architecture revision in `project_decisions.md`). Postgres
is the source of truth for Classes / Mistake Notes / Assignments /
Syllabi. Notion remains as an **optional one-way import** for users
who already keep notes in Notion and want to bring them in once at
onboarding.

- [ ] Public integration created at notion.so/my-integrations
- [ ] OAuth redirect URIs:
  - `http://localhost:3000/api/integrations/notion/callback`
  - `https://mysteadii.com/api/integrations/notion/callback`
- [ ] Integration capabilities: **Read content** only is sufficient
      for the import path. (Update/Insert capabilities can stay
      enabled — the legacy two-way sync code is deprecated but not
      deleted, and the optional Notion *export* path planned for
      post-α will need write capabilities. Leaving them on now is
      the simplest forward path.)
- [ ] Notion is intentionally NOT in the onboarding required-step
      list. Users who skip the integration page (Step 4) and never
      touch Settings → Connections will run Steadii successfully
      without a Notion connection. The Notion-import suggestion
      trigger fires in-app when user behavior implies they have
      notes-elsewhere (per `integration_suggestions` policy).

---

## 5. Stripe

- [ ] Stripe in **Test mode** (α). Live cutover is a separate launch step.
- [ ] Run `pnpm tsx scripts/stripe-setup.ts` to create the full catalog
      idempotently — Products (Pro M/Y, Student 4mo, Top-up 500/2000,
      Data Retention Extension) and Coupons (`STEADII_ADMIN_FOREVER`,
      `STEADII_FRIEND_3MO`)
- [ ] Paste the printed env var lines into Vercel (see §1)
- [ ] Set `is_admin = true` on Ryuto's user row so his own account
      bypasses quota (he does not redeem the Admin coupon unless he
      wants to test the checkout path)
- [ ] Friend invite codes: create individual Promotion Codes under the
      `STEADII_FRIEND_3MO` coupon in Stripe Dashboard. Share URLs like
      `https://mysteadii.com/invite/<code>`.
- [ ] Webhook endpoint registered at `https://mysteadii.com/api/stripe/webhook`
      with events:
  - `checkout.session.completed` (covers subscription-mode + one-time top-ups)
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
- [ ] `STRIPE_WEBHOOK_SECRET` in Vercel matches the webhook's signing
      secret; after updating env, trigger a Vercel redeploy

---

## 6. Sentry

- [ ] Sentry project (Next.js platform)
- [ ] DSNs set (server + public)
- [ ] Deliberately trigger an error (e.g. navigate to a bad chat id),
      confirm Sentry captures it
- [ ] Source maps uploading via Vercel build integration

---

## 7. Vercel Blob

- [ ] Blob store created under Vercel Storage → Blob (public access for α)
- [ ] `BLOB_READ_WRITE_TOKEN` in env; upload a syllabus PDF via the
      app's Syllabus wizard, confirm the blob URL in `blob_assets.url`
      is publicly fetchable from any browser
- [ ] Repeat the test for the Mistakes-tab "📷 写真から追加" handwritten
      note flow: upload a photo, confirm `blob_assets` row created
      with `source='handwritten_note'` and a fresh URL

---

## 8. Smoke test the full journey (incognito + fresh Google account)

Run through this with a brand-new Google test account that has at
least 5 emails in the inbox (some from `@*.ac.jp` or `@*.edu`
domains for the suggestion triggers to fire).

### 8.1 Public surfaces

- [ ] `/` loads; locale auto-switches based on `Accept-Language`
- [ ] Switch language manually (footer or header) — landing copy
      flips between EN and JA without page reload visibility issues
- [ ] Privacy and Terms links work in **both locales** (EN + JA);
      JA Privacy includes the 5 APPI sections (利用目的 / 第三者提供 /
      国境を越えた移転 / 連絡先 / 開示・訂正・停止請求方法)
- [ ] Hero feature line shows the locked Option C copy in both
      locales (no "Notion" mention anywhere on the landing page)

### 8.2 Onboarding (Google + simplified flow)

- [ ] "Sign in with Google" → consent screen shows all expected
      scopes (Gmail, Calendar, Tasks, Classroom)
- [ ] After consent → onboarding flow starts. Steps in order:
  1. School auto-detect (from email domain) → confirm or pick
  2. Gmail scope check → green
  3. **Step 4 — Integration page** (single skip-once)
     - Three rows visible: Microsoft 365 / iCal feed / Notion import
     - Click "Skip for now →" — proceeds to `/app`
     - Verify `users.onboarding_integrations_skipped_at` populated
- [ ] `users.trial_started_at` populated (14-day Pro trial)
- [ ] First-run 24h Gmail ingest fires in background — within ~2
      minutes the Inbox shows triaged items with risk_tier badges

### 8.3 Re-onboarding suppression

- [ ] Sign out, sign back in. The integration page does NOT
      re-appear (skip flag is sticky)

### 8.4 Core agent paths

- [ ] `/app` Home loads with Today's schedule / Due soon /
      Past week retrospective (Past week shows "not enough history
      yet" for new accounts)
- [ ] `/app/inbox` shows triaged items; opening one shows risk tier,
      reasoning, and (if drafted) the agent reply
- [ ] Agent reasoning shows **typed pills** for fanout sources
      (mistake / syllabus / calendar / past email) — verify visually
      after the user has at least one mistake_note + syllabus
- [ ] Send a chat message asking about a deadline → if Steadii has
      no syllabus / no calendar match, the agent reasoning includes
      a "no match" note, AND the **iCal suggestion trigger** fires
      below the reasoning panel (inline pill: "I couldn't find this
      in your data…")

### 8.5 Tasks tab + Calendar unification

- [ ] Sidebar shows 6 items: `Inbox / Home / Chats / Classes /
      Calendar / Tasks` in that order
- [ ] `g t` keyboard shortcut → navigates to `/app/tasks`
- [ ] `/app/tasks` lists Steadii assignments (post-PR #40 rename)
- [ ] `/app/calendar` (week view) shows Google Calendar events +
      Google Tasks + Steadii assignments with `due_at` in range —
      all merged in one timeline

### 8.6 Mistake Notes — handwritten OCR (Phase 7 W-Notes)

- [ ] Navigate to `/app/classes/[id]?tab=mistakes` for any class
- [ ] Click "📷 写真から追加" / "📷 Add from photo"
- [ ] Upload a photo of handwritten work or a typed PDF
- [ ] Modal cycles through `extracting → preview` stages within ~10s
      for a single page
- [ ] Preview shows extracted markdown in editable textarea — math
      rendered as LaTeX, multiple pages separated by `## Page N`,
      illegible regions marked `[illegible]`
- [ ] Edit the title + body, click Save → row appears in the
      Mistakes list with `source='handwritten_ocr'` in the DB
- [ ] Verify chunks landed:
      `SELECT count(*) FROM mistake_note_chunks WHERE mistake_id=...`

### 8.7 Microsoft 365 connect (Phase 7 W-Integrations)

Skip this whole block if `AUTH_MS_ID` is not set in env.

- [ ] Settings → Connections → "Connect Microsoft 365" → consent
      screen → returned with new `accounts` row for
      `provider='microsoft-entra-id'`
- [ ] Send a chat message asking about upcoming events → agent
      response includes events from BOTH Google Calendar AND MS
      Outlook (flatten to single calendar block)
- [ ] Verify in DB: at least one event in agent reasoning provenance
      came from `bySource: 'microsoft_calendar'` or similar
      (depending on engineer's exact source-tag naming)

### 8.8 iCal subscription (Phase 7 W-Integrations)

- [ ] Settings → Connections → "iCal Feeds" → paste a valid iCal
      URL (test feed: many universities publish one publicly,
      otherwise use https://www.officeholidays.com/ics for testing)
      → click Add
- [ ] Within 6h (or trigger manually via QStash console → "Publish
      now" on `/api/cron/ical-sync`), `events` table populated with
      `source='ical'` rows
- [ ] Events appear on `/app/calendar` alongside other sources

### 8.9 Suggestion triggers (verify all 3 fire correctly)

- [ ] **Trigger A (Microsoft)**: open an Inbox item where the sender
      domain is a known MS-365 university tenant (e.g., `@*.ac.jp`
      schools that use MS 365 like `@waseda.jp`). Inline pill appears
      at top of the message: "Connect Outlook to see your campus
      events here too." Dismiss → pill disappears for this email.
      Reload → pill DOES NOT come back this session.
- [ ] **Trigger B (iCal)**: ask the agent "what's due Friday?" when
      no syllabus / calendar matches. Inline action below reasoning:
      "I couldn't find this. Most universities publish course schedules
      as iCal feeds…"
- [ ] **Trigger C (Notion-import)**: chat 3+ times mentioning notes
      / memos when `mistake_notes` count for this user is < 5. Card
      on Mistakes tab top: "Have notes in Notion? Connect once to
      import…"
- [ ] Frequency cap: dismiss Trigger A 3 times across 3 different
      sessions over a week → 4th time it does NOT show. Verify via
      `integration_suggestions` table: status='dismissed' rows count.
- [ ] Connect cap: connect Microsoft from Settings → Trigger A
      stops firing entirely.

### 8.10 "How your agent thinks" route

- [ ] Settings → "How your agent thinks" → renders the last 10
      drafts each with their full pill row (typed sources) +
      reasoning + sender / action / auto-sent badge

### 8.11 Chat history rendering (post-PR #46 fix)

- [ ] Open any chat with tool-using turns (e.g., one where the
      agent created a Calendar event). Navigate away to `/app/inbox`,
      navigate back. Tool call result JSON does NOT appear as raw
      text (it's hidden / rendered as a card just like during live
      streaming).

### 8.12 Billing flows

- [ ] `/app/settings/billing` shows **"Pro (14-day trial) · ends <date>"**
      plus credit / storage bars with reset date
- [ ] Currency display matches user locale: JA → JPY (¥), EN → USD ($)
- [ ] As Free user (admin flag off): click "Upgrade to Pro" → Stripe
      Checkout opens with the correct currency
      (`STRIPE_PRICE_PRO_MONTHLY_JPY` for JA users) → pay with
      `4242 4242 4242 4242` → redirected back → webhook mirrors
      subscription → `plan_tier='pro'` in DB
- [ ] First paid subscription triggers `founding_member=true` → badge
      shows in Billing UI ("Founding member. Your current price is
      locked in for life." / "Founding メンバー. 料金は永続的に固定
      されます。")
- [ ] "+500 credits · \$10 / +500 クレジット · ¥1,500" → one-time
      Checkout → `topup_balances` row inserted, expiry ~90 days out,
      Billing UI shows "+500 top-up credits"
- [ ] "Extend data retention · \$10 / ¥1,500" →
      `users.data_retention_expires_at` set ~1 year out
- [ ] Student plan from a non-academic email → 403 with
      `STUDENT_EMAIL_REQUIRED`. From `*.ac.jp` or `*.edu` or one of
      the Canadian/JP allowlist domains → checkout proceeds
- [ ] Friend invite flow: create Promotion Code `FRIEND_TEST` under
      `STEADII_FRIEND_3MO`; open `/invite/FRIEND_TEST` in another
      session; "Accept invite" → Checkout at \$0 / ¥0 for 3 months
- [ ] "Cancel subscription" link at the bottom of Billing → two-step
      flow → Confirm → `subscriptions.cancel_at_period_end = 1`;
      `audit_log` has `action='billing.canceled'` with the reason
- [ ] Mark a subscription past_due in Stripe (or force a failed
      payment) → app shell banner "Your last payment failed…"
      surfaces at top of every `/app/*` page

### 8.13 Lighthouse audit

- [ ] Run Lighthouse on `/` (landing page) — performance ≥85
- [ ] Run Lighthouse on `/app` (Home, signed in) — performance ≥85
- [ ] Accessibility ≥90 on both
- [ ] No console errors on either page

---

## 9. Monitoring

- [ ] `vercel logs --follow` during smoke tests
- [ ] OpenAI dashboard usage cap: \$100/month for α
- [ ] Sentry clean (no unresolved errors from smoke tests)

---

## 10. Launch (JP α — invite-only, 10 students)

### 10.1 Pre-invite final checks

- [ ] All sections 1-9 + 11 above ticked through
- [ ] Ryuto's admin flag confirmed on production DB
      (`SELECT is_admin FROM users WHERE email = '<ryuto>'` returns true)
- [ ] Test-mode banner verified in production: subscription flows
      complete but no real Stripe charges post
- [ ] Sentry shows zero unresolved errors from the full §8 smoke test pass

### 10.2 Friend invite codes (one per α user)

- [ ] In Stripe Dashboard → Coupons → `STEADII_FRIEND_3MO` → Promotion
      Codes → create 10 individual codes, one per invitee. Naming
      convention: `STEADII-α-<short-name>` (e.g., `STEADII-α-TANAKA`)
- [ ] Verify each code redeems for $0 / ¥0 for 3 months in a test session
- [ ] Spreadsheet maintained externally (Google Sheets) tracking:
      invitee name / code / sent date / accepted date / first-digest date

### 10.3 Founding member confirmation

- [ ] All 10 α users will auto-receive `founding_member=true` on first
      paid subscription (per locked decision in `project_decisions.md`).
      Verify the webhook handler grants the flag after the friend-code
      checkout

### 10.4 Invite send

- [ ] Send the JA invitation message (drafted separately by sparring
      side, see `docs/handoffs/jp-alpha-invite-content.md` if committed,
      otherwise in the chat thread) personally to each of the 10 invitees
- [ ] Each message includes: founding-member framing + `/invite/<code>`
      URL + 1-line expectations (week-1 sync cadence) + privacy note
      (data flows, OpenAI processing disclosure)

### 10.5 Post-invite observation cadence

- [ ] First 24h: monitor Sentry + dogfood metrics admin page closely
      for any unexpected error spikes
- [ ] First week: 1-on-1 30-min sync with each invitee; collect
      qualitative feedback on agent draft quality, classification
      accuracy, suggestion prompt relevance
- [ ] Per-user metrics target after week 2 (per
      `project_agent_model.md`):
      classification error <5%, draft edit rate <20%, post-send
      regret = 0
- [ ] Any single regret incident → agent send capability disabled,
      user notified transparently, diagnose → patch → restart (per
      locked rollback policy)


---

## 11. Cron schedules (Upstash QStash)

Vercel Hobby tier limits crons to daily, so scheduled work runs through
Upstash QStash instead. Free tier (500 req/day) covers α at ~300 req/day.

### One-time setup

1. Sign in to https://console.upstash.com/qstash with GitHub.
2. Copy `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` from
   the **Request** tab.
3. Add both to Vercel project env vars (Production scope).
4. Trigger a redeploy of `main` so the runtime picks up the keys.

### Schedules to create

In the QStash console → **Schedules** → **Create**:

| Endpoint | Schedule | Method | Notes |
|---|---|---|---|
| `https://mysteadii.com/api/cron/digest` | `0 * * * *` | POST | Hourly. NA timezones are all whole-hour offsets, so hourly is enough; switch to `*/30` only if onboarding India / Newfoundland users. |
| `https://mysteadii.com/api/cron/send-queue` | `*/5 * * * *` | POST | Every 5 minutes. The 20s undo window is enforced client-side; this cadence only affects time-from-send-click to Gmail API call. |
| `https://mysteadii.com/api/cron/ingest-sweep` | `*/15 * * * *` | POST | Every 15 minutes. Fans out `ingestLast24h` across all gmail-scoped users, bypassing the page-render auto-ingest 24h cooldown. Without this, new emails only surface when the user manually refreshes Settings. |
| `https://mysteadii.com/api/cron/ical-sync` | `0 */6 * * *` | POST | Every 6 hours per Phase 7 W-Integrations Q3. Walks active `ical_subscriptions`, conditional GETs each (If-None-Match: ETag), upserts events into the shared `events` mirror. After 3 consecutive failures the row auto-deactivates so we stop hammering a broken URL. |

Body: leave empty. The signing key in headers handles auth.

### Verifying

- After all three schedules are created, wait one tick and check Sentry for
  `cron.digest.tick` / `cron.send_queue.tick` / `cron.ingest_sweep.tick`
  spans with `op=cron`.
- Or hit the QStash console → Schedule → **Logs** for per-tick HTTP
  status (expect 200).
- Manual trigger: QStash console → Schedule → **Publish now**.

### Local dev

`pnpm dev` skips signature verification when both `QSTASH_*` keys are
empty, so you can `curl -X POST http://localhost:3000/api/cron/digest`
without QStash. Production has both keys set, so the bypass is closed.
