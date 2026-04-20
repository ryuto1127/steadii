# DEPLOY.md — Steadii α pre-launch checklist

Run through this before inviting the first ten users. Each item should be
explicitly verified, not inferred.

---

## 1. Environment variables (Vercel Production + Preview)

All of these must be set in both environments. Pull from `.env.example` as
the canonical list.

- [ ] `DATABASE_URL` — Neon prod branch connection string
- [ ] `AUTH_SECRET` — `openssl rand -base64 32`
- [ ] `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- [ ] `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
- [ ] `OPENAI_API_KEY`
- [ ] `OPENAI_CHAT_MODEL`, `OPENAI_COMPLEX_MODEL`, `OPENAI_NANO_MODEL` —
      leave blank to use PRD §5 defaults, set explicitly if the defaults
      aren't enabled on the account yet
- [ ] `STRIPE_SECRET_KEY` (test mode during α)
- [ ] `STRIPE_PRICE_ID_PRO`
- [ ] `STRIPE_WEBHOOK_SECRET` — copy after creating the webhook endpoint
      in the Stripe dashboard
- [ ] `ENCRYPTION_KEY` — `openssl rand -base64 32`
- [ ] `BLOB_READ_WRITE_TOKEN` — Vercel Storage → Blob store token
- [ ] `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`
- [ ] `APP_URL` — prod domain, e.g. `https://steadii-alpha.xyz`

## 2. Databases

- [ ] Neon prod branch provisioned
- [ ] `pnpm db:migrate` applied on prod DB
- [ ] Run `pnpm tsx scripts/fix-stale-notion-setup.ts --dry-run` to confirm
      no stale rows remain from pre-prod testing

## 3. Google OAuth

- [ ] Google Cloud project OAuth consent screen: Testing mode
- [ ] Scopes: `openid`, `email`, `profile`, `calendar`, `calendar.events`
- [ ] All ten α users added as test users in Google Cloud Console
- [ ] OAuth redirect URIs include both
      `http://localhost:3000/api/auth/callback/google` and
      `https://<prod-domain>/api/auth/callback/google`

## 4. Notion

- [ ] Public integration created at notion.so/my-integrations
- [ ] OAuth redirect URIs:
      `http://localhost:3000/api/integrations/notion/callback` and
      `https://<prod-domain>/api/integrations/notion/callback`
- [ ] Integration capabilities include "Read content," "Update content,"
      "Insert content"

## 5. Stripe

- [ ] Stripe in **Test mode** — verified in dashboard header
- [ ] Product "Steadii Pro" with recurring $20 USD/month price
- [ ] `STRIPE_PRICE_ID_PRO` matches the actual price ID
- [ ] Webhook endpoint registered at `https://<prod-domain>/api/stripe/webhook`
      with events: `customer.subscription.*`, `invoice.paid`,
      `invoice.payment_failed`
- [ ] `STRIPE_WEBHOOK_SECRET` in Vercel matches the webhook's signing
      secret
- [ ] Manual test: trigger `customer.subscription.created` via Stripe CLI
      (`stripe trigger customer.subscription.created`), confirm the
      `subscriptions` row appears and audit_log carries
      `stripe.subscription.active`

## 6. Sentry

- [ ] Sentry project created (Next.js platform)
- [ ] DSNs set (server + public)
- [ ] Deliberately trigger an error from staging (e.g., navigate to
      `/app/chat/00000000-0000-0000-0000-000000000000`) and confirm
      Sentry captures it
- [ ] Source maps uploaded via Vercel build integration — check Sentry
      → Settings → Projects → Steadii → Source Maps has recent uploads

## 7. Vercel Blob

- [ ] Blob store created under Vercel Storage → Blob
- [ ] Access: `public` (α; β will split)
- [ ] `BLOB_READ_WRITE_TOKEN` wired. Upload a test PDF via the running
      app, confirm the saved Notion file block is publicly fetchable

## 8. Smoke test the full journey

Do this in an incognito window with a fresh Google account:

- [ ] `/` loads, Privacy and Terms links work
- [ ] Click "Sign in with Google" → consent screen shows calendar scopes
- [ ] Redirected to `/onboarding` with the instructional panel
- [ ] "Connect Notion" → select **All pages** → redirected back
- [ ] "Run setup" → Steadii parent + 4 DBs appear in Notion
- [ ] `/app/chat` loads; send "Hello" → agent replies with streaming text
- [ ] Upload a real syllabus PDF via `/app/syllabus/new` → preview
      populates → save → Notion has file block + `Full source content`
      toggle
- [ ] Paste a math problem screenshot in chat → "Add to mistake
      notebook" → save → Notion row appears with image + explanation
- [ ] `/app/calendar` shows this week's Google Calendar events
- [ ] `/app/settings/billing` shows correct plan and usage bars
- [ ] Redeem a friend code generated via
      `pnpm tsx scripts/generate-redeem-code.ts friend --days 30`
- [ ] Trigger `BILLING_QUOTA_EXCEEDED` by temporarily lowering the Free
      plan cap, confirm the banner + error bubble surface correctly

## 9. Monitoring

- [ ] Vercel production logs: open a second browser tab on the live site,
      follow along with `vercel logs --follow`
- [ ] Uptime check: Vercel deployment shows green, no build warnings
- [ ] OpenAI dashboard: monthly usage cap set to $100

## 10. Launch

- [ ] Invite emails drafted with the onboarding URL
- [ ] Known-issues note: Stripe is test-mode; billing UI doesn't charge
- [ ] Admin (you) has redeemed an admin code so `/app/admin` is visible
