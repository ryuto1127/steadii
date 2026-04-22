# Steadii Phase 5 W1 — Stripe Billing Foundation

## Context

You are implementing the first week of Phase 5: Billing for Steadii, an AI agent for North American university students. The product's core value is an autonomous proactive agent that triages email, drafts replies, and waits for user confirm. Phase 5 lays the billing foundation that Phase 6 (agent implementation) will depend on for credit enforcement.

**Read before starting** (all under `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/`):

- `MEMORY.md` — index
- `project_steadii.md` — product overview
- `project_decisions.md` — **authoritative pricing, monetization, model routing**. All numbers and tier specs come from here. Do not invent alternatives.
- `project_agent_model.md` — agent design context (for why Phase 5 exists)
- `project_pre_launch_redesign.md` — UI aesthetic + visual constraints (Raycast/Arc, Geist typography, dark+light parity, amber accent)
- `feedback_role_split.md` — you are the generator; Ryuto operates in the observation/strategy layer

Also investigate the current codebase state before making any changes:

- Run `git status`, `git log --oneline -20` to see where the repo is
- Check `components/layout/nav-items.ts` and `sidebar-nav.tsx` for sidebar structure (Inbox is not yet added; that's a Phase 6 concern)
- Verify which Stripe env vars already exist; package.json shows `stripe: ^22.0.2` is installed but usage may be minimal
- Check `lib/db/schema.ts` (or equivalent) for the existing user table shape

## Decision precedence — READ THIS CAREFULLY

**The memory files `project_decisions.md` and `project_agent_model.md` are authoritative. They reflect sparring sessions that locked in the product direction. Existing code in the repo may conflict with these decisions — the code reflects earlier plans.**

**When conflict occurs, fix the code, not the decisions.** Examples:

- If the current schema has an older subscription shape that doesn't match the tier spec in `project_decisions.md`, write a migration that reshapes it to the spec. Do not keep the old shape to avoid a migration.
- If a Stripe integration stub was written for an earlier pricing model, delete or rewrite it. Do not preserve its pattern.
- If older pricing constants live in a config file, remove them.

**Exception — escalate first** only when the conflict is large enough to require a change in implementation strategy (not just data):

- Rewriting a major feature area (e.g. the entire auth stack)
- Removing or renaming public API routes that might have external consumers
- Database changes that would require data migration with downtime considerations

For those, pause and surface a short summary to Ryuto with options, then wait. For everything else, refactor silently per the decisions.

## Environment: TEST MODE ONLY

**W1 operates entirely in Stripe test mode.** Live mode activation happens at α launch as a separate cutover task, not in W1. Use test API keys, test webhooks (via `stripe listen` or the Stripe Dashboard test endpoint), and test card `4242 4242 4242 4242` for verification.

## Scope of W1 (strictly)

**In scope:**

1. Stripe Products, Prices, and Coupons creation (script or docs-as-code — your call)
2. DB schema extensions on the user table, a new invoices table, and a `processed_stripe_events` table for webhook idempotency
3. Stripe Checkout session endpoint for new subscriptions (Pro monthly, Pro yearly, Student 4-month)
4. Webhook handler with event routing for: `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`
5. Customer Portal integration — one-click link from Settings
6. Settings > Subscription section:
   - Current tier display
   - **"Upgrade to Pro" / "Upgrade to Student" CTAs** for Free users (routes to Checkout)
   - "Manage billing" button that opens Stripe Customer Portal (paid users only)
7. `is_admin` DB column on user rows (just the column — no gate, no admin UI, no credit bypass logic yet; W2 will implement the bypass that reads this flag)

**Explicitly out of scope for W1 (do not implement, do not even stub in ways that leak into W1 files):**

- Credit tracking, credit counters, or credit reset logic — all of that is W2. **Critical**: the `invoice.paid` webhook handler must NOT contain any credit-related code. Student plan invoices fire every 4 months while credit reset is monthly; they are on different clocks anchored differently, and conflating them in W1 will cause a painful W2 refactor. `invoice.paid` in W1 does exactly one thing: INSERT a row into the invoices table.
- Top-up pack purchase endpoints — Products are created in Stripe in W1 so the catalog is complete, but the `/api/top-up` purchase endpoint and success-handling webhook branch are W3.
- Data Retention Extension purchase endpoint — same pattern: Product exists in Stripe after W1, purchase flow is W3.
- .edu verification for Student plan — W3. In W1 the Student tier is purchasable by anyone with a test card; the .edu gate is added later.
- 14-day trial state machine — W3.
- Redemption code / invite link / `/invite` route — W4 (Ryuto generates Friend codes manually in the Stripe Dashboard during α if needed).
- Admin page `/app/admin` — W4.
- Cancel flow UI (the feedback reason picker) — W3 or W4. In W1, cancellation goes through the Stripe Customer Portal.
- Agent features — Phase 6.
- `founding_member` automation — W1 adds the column, but the logic for *when* to set it true (first 100 paid users + α invitees) is explicitly deferred to W4 alongside the invite flow.

## Concrete decisions handed over

**Stripe Products & Prices to create (test mode):**

- `Pro Monthly` — $20 USD / month recurring
- `Pro Yearly` — $192 USD / year recurring
- `Student 4-month` — $40 USD every 4 months recurring (interval=month, interval_count=4)
- `Top-up 500` — $10 USD one-time
- `Top-up 2000` — $30 USD one-time
- `Data Retention Extension` — $10 USD one-time

**Stripe Coupons to create:**

- `ADMIN_FOREVER` — 100% off, duration=forever, max_redemptions=10
- `FRIEND_3MO` — 100% off, duration=repeating, duration_in_months=3; individual Promotion Codes (max_redemptions=1 each) are created later from this coupon, not in W1

**Stripe Price IDs must be stored as env vars**, not in a DB config table:

- `STRIPE_PRICE_PRO_MONTHLY=price_xxx`
- `STRIPE_PRICE_PRO_YEARLY=price_xxx`
- `STRIPE_PRICE_STUDENT_4MO=price_xxx`
- `STRIPE_PRICE_TOPUP_500=price_xxx`
- `STRIPE_PRICE_TOPUP_2000=price_xxx`
- `STRIPE_PRICE_DATA_RETENTION=price_xxx`
- `STRIPE_COUPON_ADMIN=coupon_xxx`
- `STRIPE_COUPON_FRIEND_3MO=coupon_xxx`

Document these in `.env.example` and the README. Do not invent a database `stripe_config` table. If such a table already exists from an earlier implementation, delete it per the decision-precedence rule above.

**User table columns to add** (names are suggestions — match existing style):

- `stripe_customer_id` (string, nullable)
- `subscription_status` (enum: free, trialing, active, past_due, canceled, paused)
- `plan_tier` (enum: free, student, pro)
- `plan_interval` (enum: monthly, yearly, **four_month** / null for free) — note: **four_month** is the correct identifier per locked decision in `project_decisions.md`. Do NOT use `semester` — Student plans are rolling 4-month windows, NOT calendar-semester-aligned.
- `subscription_current_period_end` (timestamp, nullable)
- `trial_started_at` (timestamp, nullable — populated in W3, column now)
- `data_retention_expires_at` (timestamp, nullable — populated in W3, column now)
- `is_admin` (boolean, default false) — W1: column only. W2 credit-enforcement middleware will read this and bypass quota checks for admin users. W1 itself does no gating based on this flag.
- `founding_member` (boolean, default false) — column only in W1. Automation for setting this true is in W4.
- `grandfather_price_locked_until` (timestamp, nullable) — column only, set by later automation.

If the existing user table has legacy columns from an older billing model that conflict with the above (e.g. a `plan_type` enum with different values, or vestigial Stripe fields), migrate them to match the spec. Do not leave both shapes coexisting.

**Invoices table (new):**

- `user_id`, `stripe_invoice_id` (unique), `amount_total`, `amount_subtotal`, `tax_amount` (reserved, always 0 in W1, will populate when Stripe Tax is enabled post-α), `currency` (always 'usd' for now), `paid_at`, `invoice_pdf_url`, `created_at`
- Rows are INSERTed from the `invoice.paid` webhook handler and nowhere else.

**Webhook idempotency (new table):**

- `processed_stripe_events` with `event_id` as primary key, `type`, `processed_at`
- Webhook handler flow: check if event_id already processed → if yes, return 200 immediately → if no, process in a transaction that includes INSERT of the event_id. UPSERT pattern is also acceptable. Either way, **Stripe retries must not cause double-processing** (e.g. double-INSERT of invoice rows, double subscription-state transitions).

## Sequencing

1. **Investigation pass first** — produce a short report on:
   - What Stripe code already exists in the repo
   - Current user schema shape, and any conflicts with the spec above
   - Recommendation for where new subscription routes / webhook handler should live
   - **Any existing billing-related code that needs to be deleted or refactored per the decision-precedence rule.** List them explicitly so Ryuto can sanity-check before the refactor happens.

   Post this report before writing code. Wait for Ryuto to approve the approach.

2. After approval, implement in this order:
   1. DB schema + migration (user column additions + invoices table + processed_stripe_events table + removal/rename of any conflicting legacy fields)
   2. Stripe setup — a runnable Node script under `scripts/` that creates Products, Prices, and Coupons in test mode; document the resulting Price IDs in `.env.example`
   3. Checkout session endpoint (accepts a `plan_tier` + `plan_interval`, returns a Stripe Checkout URL)
   4. Webhook handler with idempotency check, event routing table, and per-event handlers for the 5 event types listed in scope
   5. Customer Portal integration + Settings UI (Free-user Upgrade CTAs + paid-user Manage-billing button)
   6. Local manual testing against Stripe test mode (use `stripe listen --forward-to`)

3. Write unit tests for the webhook handler. **Do not mock signature verification** — the test harness should feed pre-parsed `Stripe.Event` objects directly into the event router, verifying each event type produces the correct DB state change. Target: all 5 listed events covered, plus idempotency (same event_id fed twice produces one state change, not two).

## Definition of done for W1

- Ryuto can sign in, click "Upgrade to Pro" in Settings > Subscription, be redirected to Stripe Checkout, complete with test card `4242 4242 4242 4242`, return to Steadii with Pro access reflected in `subscription_status='active'` and `plan_tier='pro'`
- Same flow works for Pro Yearly and Student 4-month
- Webhook correctly handles `subscription.updated` (e.g. change plan in Portal) and `subscription.deleted` (cancel → downgrade to free)
- "Manage billing" button opens Stripe Customer Portal; user can change payment method, view invoices, cancel subscription
- `invoice.paid` webhook INSERTs a row into the invoices table; duplicate events do not produce duplicate rows
- `is_admin` column exists and defaults to false; setting it to true via `db:studio` has no W1-visible effect (W2 will wire the bypass)
- Any legacy billing code that conflicted with the spec has been removed or refactored per the decision-precedence rule
- `pnpm test` passes all tests
- `pnpm typecheck` clean
- `pnpm lint` clean

## Escalate to Ryuto (do not decide yourself)

- Any deviation from the pricing or tier spec in `project_decisions.md`
- Any scope that starts feeling like W2+ work bleeding into W1 (credit tracking is the most likely leak)
- Stripe test environment configuration issues requiring his account access
- **Large-scale conflicts** where refactoring per the decision-precedence rule would mean rewriting a major feature area (not just schema). Surface the conflict with options; don't silently overhaul.

## Style

- TypeScript, match existing patterns in the repo
- No new top-level dependencies without asking (Stripe SDK already present)
- Commit messages follow existing conventions (check `git log`)
- Keep PR-sized commits, not one monolithic commit
