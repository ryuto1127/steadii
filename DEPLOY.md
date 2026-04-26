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
- [ ] `APP_URL` — `https://mysteadii.xyz`
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
- [ ] `pnpm db:migrate` applied on prod DB (latest: 0012, adds
      `topup_balances`)
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
  - `https://mysteadii.xyz/api/auth/callback/google`

---

## 4. Notion

- [ ] Public integration created at notion.so/my-integrations
- [ ] OAuth redirect URIs:
  - `http://localhost:3000/api/integrations/notion/callback`
  - `https://mysteadii.xyz/api/integrations/notion/callback`
- [ ] Integration capabilities: Read content, Update content, Insert content

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
      `https://mysteadii.xyz/invite/<code>`.
- [ ] Webhook endpoint registered at `https://mysteadii.xyz/api/stripe/webhook`
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
- [ ] `BLOB_READ_WRITE_TOKEN` in env; upload a test PDF via the app and
      confirm the resulting Notion file block is publicly fetchable

---

## 8. Smoke test the full journey (incognito + fresh Google account)

- [ ] `/` loads; Privacy and Terms links work
- [ ] "Sign in with Google" → consent screen shows all expected scopes
- [ ] Redirected to `/onboarding` with instructional panel
- [ ] `users.trial_started_at` is populated (14-day Pro trial started)
- [ ] "Connect Notion" → select All pages → redirected back
- [ ] "Run setup" → Steadii parent + 4 DBs appear in Notion
- [ ] `/app` loads Home (Dashboard + chat input); send a message, agent
      streams a response
- [ ] `/app/settings/billing` shows **"Pro (14-day trial) · ends <date>"**
      plus credit / storage bars with reset date
- [ ] As Free user (admin flag off): click "Upgrade to Pro" → Stripe
      Checkout with `4242 4242 4242 4242` → redirected back → webhook
      mirrors subscription → `plan_tier='pro'` in DB
- [ ] First paid subscription triggers `founding_member=true` → badge
      shows in Billing UI ("Founding member. Your current price is
      locked in for life.")
- [ ] "+500 credits · \$10" → one-time Checkout → `topup_balances` row
      inserted, expiry ~90 days out, Billing UI shows "+500 top-up credits"
- [ ] "Extend data retention · \$10" → `users.data_retention_expires_at`
      set ~1 year out
- [ ] Student plan from a non-`.edu` account → 403 with
      `STUDENT_EMAIL_REQUIRED`
- [ ] Friend invite flow: create Promotion Code `FRIEND_TEST` under
      `STEADII_FRIEND_3MO`; open `/invite/FRIEND_TEST` in another
      session; "Accept invite" → Checkout at \$0 for 3 months
- [ ] "Cancel subscription" link at the bottom of Billing → two-step
      flow → Confirm → `subscriptions.cancel_at_period_end = 1`;
      `audit_log` has `action='billing.canceled'` with the reason
- [ ] Mark a subscription past_due in Stripe (or force a failed payment)
      → app shell banner "Your last payment failed…" surfaces at top of
      every `/app/*` page

---

## 9. Monitoring

- [ ] `vercel logs --follow` during smoke tests
- [ ] OpenAI dashboard usage cap: \$100/month for α
- [ ] Sentry clean (no unresolved errors from smoke tests)

---

## 10. Launch

- [ ] Invite emails drafted with onboarding URL (use `/invite/<code>`
      links to pre-fund the 3-month Pro via `FRIEND_3MO`)
- [ ] Known-issue note: Stripe is test-mode; UI shows real flow but no
      charges post
- [ ] Ryuto's admin flag confirmed on in production DB


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
| `https://mysteadii.xyz/api/cron/digest` | `0 * * * *` | POST | Hourly. NA timezones are all whole-hour offsets, so hourly is enough; switch to `*/30` only if onboarding India / Newfoundland users. |
| `https://mysteadii.xyz/api/cron/send-queue` | `*/5 * * * *` | POST | Every 5 minutes. The 20s undo window is enforced client-side; this cadence only affects time-from-send-click to Gmail API call. |
| `https://mysteadii.xyz/api/cron/ingest-sweep` | `*/15 * * * *` | POST | Every 15 minutes. Fans out `ingestLast24h` across all gmail-scoped users, bypassing the page-render auto-ingest 24h cooldown. Without this, new emails only surface when the user manually refreshes Settings. |
| `https://mysteadii.xyz/api/cron/ical-sync` | `0 */6 * * *` | POST | Every 6 hours per Phase 7 W-Integrations Q3. Walks active `ical_subscriptions`, conditional GETs each (If-None-Match: ETag), upserts events into the shared `events` mirror. After 3 consecutive failures the row auto-deactivates so we stop hammering a broken URL. |

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
