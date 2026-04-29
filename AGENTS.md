# AGENTS.md — Steadii technical conventions

Read this first when working on the repo. **All product / pricing / vision decisions live in memory files**, not here:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_decisions.md` — pricing, tiers, billing, monetization, model routing. Authoritative.
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — agent architecture, triage layers, risk-tiered confirmations, safety design.
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_pre_launch_redesign.md` — UI visual language, sidebar composition, palette, typography.
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md` — product overview and phase state.

If something in this file conflicts with memory, **memory wins** — update this file. Do not duplicate decisions between the two.

---

## 1. Project context

Steadii is an AI-driven proactive agent for university students. Core value proposition is Gmail L1/L2 triage + draft generation + confirm-UX. Notion and Google Calendar are secondary integrations (Notion is now optional). Bilingual (JA/EN), desktop-first, solo dev, production on `mysteadii.com`.

---

## 2. Tech stack

- **Framework**: Next.js 16 with App Router, TypeScript strict
- **Runtime**: Node.js 20+, Vercel serverless
- **Package manager**: `pnpm`
- **Database**: Neon Postgres, Drizzle ORM (migrations via Drizzle Kit)
- **Auth**: Auth.js (NextAuth v5), **JWT session strategy** (not DB sessions — we moved for latency), Google provider
  - Scopes: `openid email profile`, Calendar, Calendar events, Google Tasks, Classroom (courses + coursework + announcements, all read-only)
  - `events.createUser` sets `trial_started_at = now` (starts the 14-day Pro trial)
- **OpenAI SDK** (default model routing in `lib/agent/models.ts`)
- **Stripe SDK** + Checkout + Customer Portal + Coupons/Promotion Codes (custom redemption tables removed)
- **UI**: Tailwind CSS v4, shadcn/ui patterns (components copied in, not imported), `lucide-react` icons, `sonner` toasts
- **Fonts**: Geist (sans) + Geist Mono. No serif. (Older warm-palette / Instrument Serif stack is gone — see `project_pre_launch_redesign.md`.)
- **Testing**: Vitest (unit + integration). Target: all Stripe webhook branches, credit math, academic-email matcher, agent flows. No E2E yet.
- **Observability**: Sentry, Vercel logs. PostHog deferred.

---

## 3. Directory structure (current)

```
app/
  (marketing)/        # landing, privacy, terms
  (auth)/             # login, onboarding
  app/                # authenticated app shell (sidebar + main)
    chat/[id]/
    chats/
    classes/[id]/
    calendar/
    settings/
      billing/
        cancel/       # custom cancel flow (feedback, no retention offers)
    admin/            # is_admin-gated; currently stats + link to Stripe coupons
  invite/[code]/      # public Friend invite landing (Stripe promotion code)
  api/
    auth/[...nextauth]/
    chat/             # GET streams, POST creates, message/confirm sub-routes
    stripe/
      checkout/       # subscription Checkout (plan_tier + plan_interval + optional promo_code)
      topup/          # one-time: topup_500 / topup_2000 / data_retention
      cancel/         # custom cancel → cancel_at_period_end
      portal/         # Stripe Customer Portal redirect
      webhook/        # idempotent, processed_stripe_events ledger
    integrations/     # notion, google callbacks
    syllabus/extract/
components/
  layout/             # sidebar, sidebar-nav, nav-items, offline-strip, route-transition
  chat/
  billing/            # BillingActions (upgrade/top-up/portal), others
  settings/
lib/
  agent/              # orchestrator, tools, prompts, models, usage, confirmation, context
  auth/               # NextAuth config + encrypted adapter
  billing/            # stripe, credits (window math), effective-plan, plan, storage, academic-email
  db/                 # schema, client, migrations
  integrations/       # notion, google, openai
  i18n/               # en.ts, ja.ts
  utils/              # rate-limit, etc.
scripts/
  stripe-setup.ts     # idempotent Stripe catalog sync (Products/Prices/Coupons)
  encrypt-oauth-tokens.ts
  fix-stale-notion-setup.ts
tests/
docs/
  handoffs/           # W-by-W handoff prompts (phase5-w1.md, etc.)
```

Conventions:
- Server-only code: `import "server-only"` at top.
- Client components: `"use client"` at top.
- One component per file, named exports.
- Route groups `(auth)` / `(marketing)` for layout separation.

---

## 4. Database schema essentials

Drizzle schema is in `lib/db/schema.ts` — treat that as the source. Key tables and why they exist:

- `users` — core identity. Phase 5 columns: `plan` (free/student/pro), `plan_interval` (monthly/yearly/four_month), `is_admin`, `founding_member`, `grandfather_price_locked_until`, `trial_started_at`, `data_retention_expires_at`.
- `accounts`, `sessions`, `verification_tokens` — Auth.js standard (kept for adapter; sessions table only minimally used since JWT strategy).
- `notion_connections`, `registered_resources` — Notion integration + the four Steadii databases.
- `chats`, `messages`, `message_attachments` — chat history.
- `usage_events` — per-LLM-call token usage + credits_used. **Chat and meta task types record 0 credits** (rate-limited separately); only `mistake_explain` / `syllabus_extract` meter.
- `subscriptions` — Stripe subscription mirror.
- `invoices` — Stripe invoice mirror. `tax_amount` reserved at 0 (Stripe Tax deferred until post-α).
- `processed_stripe_events` — webhook idempotency ledger, `event_id` PK.
- `topup_balances` — one row per top-up pack purchase, with 90-day expiry.
- `audit_log` — agent actions + billing events (cancellations with feedback, founding-member grants, etc.).
- `events` — canonical event store (Google Calendar / Tasks / Classroom coursework, merged).
- `pending_tool_calls` — agent tool calls awaiting user confirmation.

Principles:
- UUIDv7-style primary keys via `uuid().defaultRandom()`.
- `created_at` / `updated_at` on every table.
- Soft-delete on user-facing tables (`users`, `chats`, `messages`, `blob_assets`).
- OAuth tokens encrypted at the application layer (AES-256-GCM, key in `ENCRYPTION_KEY`).
- All foreign keys explicit with `ON DELETE` behavior.

### 4.1 Notion 4-DB model

Under the user's Steadii parent page: `Classes` (hub) + `Mistake Notes` + `Assignments` + `Syllabi`. The latter three join back via a `Class` relation (`dual_property` two-way sync). Any tool that filters or groups across these tables **must join through the relation**, not ad-hoc class name matching.

---

## 5. Agent architecture

- **Orchestrator**: `lib/agent/orchestrator.ts` — main chat loop. Streams OpenAI response, dispatches tool calls, persists messages, records usage.
- **Tools**: one file per tool area under `lib/agent/tools/`. Each exposes a JSON Schema for OpenAI + an `execute()` that runs server-side + logs to `audit_log`. Destructive tools honor `agent_confirmation_mode` by emitting a `pending_tool_calls` row instead of running immediately.
- **Model routing** (`lib/agent/models.ts`):
  - `chat` / `tool_call` → `gpt-5.4-mini`
  - `mistake_explain` / `syllabus_extract` / agent L2 draft (Phase 6) → `gpt-5.4`
  - `chat_title` / `tag_suggest` → `gpt-5.4-nano`
  - No LLM-based routing. Overridable via env (`OPENAI_CHAT_MODEL`, etc.).
- **Prompt caching**: keep system prompts stable strings in `lib/agent/prompts/`. Variable user context is a second system message appended after the stable one — do not interpolate user data into the cached prefix.
- **Triage layers (Phase 6, see `project_agent_model.md`)**: L1 rules → L2 LLM classify/draft → L3 learning (post-α).

---

## 6. Billing & credits — pointer

Authoritative numbers live in `project_decisions.md`. This section covers only implementation surface:

- **Credit unit**: 1 credit = **$0.005** of token spend. `usdToCredits(usd) = floor(usd * 200)`. (Revised from $0.01.)
- **What meters credits**: `mistake_explain`, `syllabus_extract` (and future agent L2 draft). Chat / tool_call / meta tasks are 0 credits but still logged in `usage_events` for analytics.
- **Credit window**: anchored to `users.created_at` day-of-month, not calendar month. `creditWindowForAnchor(createdAt, now)` in `lib/billing/credits.ts` handles the math (including 31-day and leap-year edge cases).
- **Chat rate limits** (not credit-based): `CHAT_PLAN_LIMITS` in `lib/utils/rate-limit.ts`. `enforceChatLimits(userId, plan)` runs on both `/api/chat` GET stream and `/api/chat/message` POST.
- **Effective plan precedence** (`lib/billing/effective-plan.ts`): `is_admin` flag → active Stripe subscription (price_id → tier) → 14-day trial → free.
- **Admin**: flag-based, not redemption-based. Set via `db:studio` / Neon console: `UPDATE users SET is_admin=true WHERE email=...`.
- **Redeem codes**: removed from codebase. Friend invites = Stripe Promotion Codes backed by the `STEADII_FRIEND_3MO` coupon. Admin = Stripe `STEADII_ADMIN_FOREVER` coupon + `is_admin` flag. `scripts/stripe-setup.ts` creates the catalog idempotently.
- **Student tier gate**: `lib/billing/academic-email.ts`. `.edu`, `*.ac.<tld>`, and a Canadian university allow-list. Alternate-email + verification-link flow is post-α.
- **Webhook idempotency**: `processed_stripe_events.event_id` PK + `isUniqueViolation` short-circuit.
- **Founding member / grandfather clause**: first 100 paid users get `founding_member=true` (permanent lock), rest get `grandfather_price_locked_until = now + 12 months`. Automation fires once per user in `upsertSubscription` webhook branch when their first subscription activates.

---

## 7. Security

- Secrets in Vercel env only. `.env.example` has keys, never values.
- OAuth tokens: AES-256-GCM at the application layer (`ENCRYPTION_KEY`).
- Rate limits: chat burst (per-minute) + per-plan chat hourly/daily + endpoint-specific (syllabus extract, redeem removed). In-memory token bucket; move to Upstash when multi-region drift matters.
- Input validation with `zod` on every server action and API route.
- SSRF guard on user-supplied URLs (`lib/utils/ssrf-guard.ts`).

---

## 8. Environment variables

See `.env.example` for the canonical list. Key groupings:

- **Infra**: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID/SECRET`, `APP_URL`, `ENCRYPTION_KEY`, `BLOB_READ_WRITE_TOKEN`, `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN`.
- **OpenAI**: `OPENAI_API_KEY`, optional `OPENAI_CHAT_MODEL` / `OPENAI_COMPLEX_MODEL` / `OPENAI_NANO_MODEL` overrides.
- **Notion**: `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`.
- **Stripe**: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus the catalog (populated by `pnpm tsx scripts/stripe-setup.ts`): `STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_YEARLY`, `STRIPE_PRICE_STUDENT_4MO`, `STRIPE_PRICE_TOPUP_500`, `STRIPE_PRICE_TOPUP_2000`, `STRIPE_PRICE_DATA_RETENTION`, `STRIPE_COUPON_ADMIN`, `STRIPE_COUPON_FRIEND_3MO`. `STRIPE_PRICE_ID_PRO` kept as a legacy alias until all callers migrate.

---

## 9. Internationalization

- Translation keys in `lib/i18n/translations/{en,ja}.ts`, routed via `next-intl`.
- Locale resolution: `Accept-Language` header → user preference in `users.preferences.locale`.
- Agent responds in the user's current language (model handles it — no server-side branch).

---

## 10. Testing

- Vitest for all unit + integration tests in `tests/`.
- Do not mock Stripe signature verification. For webhook tests, feed pre-parsed `Stripe.Event` objects directly to the exported `routeEvent()` helper.
- Key suites: `stripe-webhook`, `effective-plan`, `credit-gate`, `academic-email`, `chat-plan-rate-limit`, `schema`, `models`, `plan-limits`.
- `pnpm test`, `pnpm typecheck`, `pnpm build` must stay green on every commit.

---

## 11. Conventions

- **Commits**: Conventional Commits (`feat(billing):`, `fix(chat):`, etc.). Scope = feature area.
- **Imports**: absolute via `@/*`. Order: external, `@/lib/*`, `@/components/*`, relative.
- **No `any`**. Use `unknown` + narrowing.
- **DB columns**: `snake_case`. Drizzle maps to `camelCase` properties on the TS side.
- **Error codes**: user-facing errors get stable codes (e.g. `BILLING_QUOTA_EXCEEDED`, `STUDENT_EMAIL_REQUIRED`, `RATE_LIMITED`).
- **No default exports** from utility modules; Next.js pages are the exception.
- **Commit granularity**: PR-sized, not monolithic. Handoff docs under `docs/handoffs/` outline the commit plan per week.

---

## 12. Handoff completion contract

When you complete a work unit handed off via a `docs/handoffs/<name>.md` brief, your final report (in the PR body and/or in chat) **must include a "Memory entries to update" section**.

For each memory entry the work has obsoleted, advanced, or contradicted, list:

- **File**: e.g. `project_steadii.md`, `project_decisions.md`
- **Section / line range**: enough that the sparring side can locate it without re-reading the whole file
- **Suggested change**: brief — "mark as shipped (commit `<sha>`)", "remove planned-future framing", "revise estimate from X to Y", "delete entry — superseded by Z"

If no memory entries are affected, write `**Memory entries to update**: none`.

Why: memory captures intent at decision time; engineer ships async; without this contract the loop never closes and the next sparring session opens stale memory and re-litigates settled decisions. The engineer side does not edit memory directly (role split — see `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_role_split.md`); it only flags the delta. The sparring side applies the changes after merge.

Memory locations are listed at the top of this file (`project_*.md`, `feedback_*.md`, etc.). When in doubt about which entry is affected, list the file and let sparring narrow it.
