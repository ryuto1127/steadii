# TASKS.md — Steadii Implementation Roadmap

This file defines the phases Claude Code must follow when building Steadii. Each phase has a goal, a scope, and acceptance criteria. **Do not start a new phase until the current phase's acceptance criteria are demonstrably met.**

Detailed task decomposition inside each phase is left to Claude Code. Use `Explore` and `Plan` subagents freely. Surface ambiguities back to the human before writing significant code.

Read `PRD.md` for product intent and `AGENTS.md` for technical conventions before starting any phase.

---

## Phase 0 — Foundation

**Goal**: Get a Next.js app deployed to Vercel with Google login working and an empty authenticated shell.

**In scope**:
- Next.js 15+ App Router scaffold with TypeScript strict mode
- Tailwind v4 + shadcn/ui setup
- Neon Postgres connection, Drizzle ORM setup, initial migrations
- Auth.js v5 with Google provider, DB sessions
- Base database schema: `users`, `accounts`, `sessions`, `verification_tokens` (Auth.js standard)
- Route groups: `(marketing)`, `(auth)`, `app/app/*` for authenticated area
- App shell with sidebar navigation (placeholder links to each section)
- Landing page at `/` with placeholder copy and a "Sign in with Google" CTA
- `/privacy` and `/terms` pages with placeholder content
- i18n scaffolding with `next-intl`, EN + JA translation files, locale detection from `Accept-Language`
- Environment variable validation at startup (fail fast on missing vars)
- `.env.example` committed with all required keys

**Acceptance criteria**:
- Deployed to Vercel at the throwaway domain
- User clicks "Sign in with Google" → lands in authenticated shell
- UI language switches based on browser locale
- Unauthenticated users hitting `/app/*` are redirected to `/login`
- Running `pnpm dev` locally works end-to-end
- All Drizzle migrations apply cleanly against a fresh database

**Out of scope**: Notion, Calendar, chat, billing, any AI features.

---

## Phase 1 — Integrations & Onboarding

**Goal**: Users can connect Notion and Google Calendar, and a "Steadii" workspace structure is created in their Notion.

**In scope**:
- Notion OAuth 2.0 flow with `/api/integrations/notion/callback`
- Extend Google scopes in Auth.js to include Calendar (`calendar` + `calendar.events`)
- Encrypted storage of Notion access tokens and Google refresh tokens (AES-256-GCM at app layer)
- Database tables: `notion_connections`, `registered_resources`, `audit_log`
- Notion setup routine: create "Steadii" parent page, create three databases (`Mistake Notes`, `Assignments`, `Syllabi`) with the schemas defined in PRD §3.7.3, §3.8.1, §3.6.2
- Onboarding flow at `/onboarding`: step 1 Notion, step 2 Calendar, step 3 auto-setup confirmation, step 4 optional resource registration
- Post-login redirect to `/onboarding` if setup incomplete, to `/app/chat` if complete
- Settings → Connections page: show connection status, re-connect, disconnect actions
- Settings → Resources page: list registered resources, add manually by Notion URL, remove

**Acceptance criteria**:
- New user completes onboarding in under 2 minutes
- After onboarding, user's Notion workspace contains the "Steadii" parent and three properly-schema'd databases
- Disconnecting Notion then re-connecting restores access without data loss
- Registered resources list reflects reality (manual adds persist, removals work)
- Token encryption verified by inspecting raw DB rows (tokens are not readable plaintext)

**Out of scope**: Chat, agent, any AI calls.

---

## Phase 2 — Core Chat Infrastructure

**Goal**: Users can have streaming conversations with an agent that has no tools yet but understands their context.

**In scope**:
- Database tables: `chats`, `messages`, `message_attachments`, `usage_events`
- Chat list view at `/app/chat` with chat creation, rename, delete
- Single chat view at `/app/chat/[id]` with message history
- Chat send endpoint at `/api/chat` using Server-Sent Events or Vercel streaming
- OpenAI client wrapper in `lib/integrations/openai/client.ts` with retry + timeout
- Agent orchestrator loop in `lib/agent/orchestrator.ts`: stub tool layer that returns "not implemented yet" for any tool call, but the loop itself must be correct
- Model routing in `lib/agent/models.ts` with the switch from AGENTS.md §5.3
- System prompt structure: stable base prompt in `lib/agent/prompts/main.ts`, user context injected as a second system message (for cache efficiency)
- Usage logging: every OpenAI call writes to `usage_events` with model, input tokens, output tokens, cached tokens
- Chat title auto-generation after the first assistant response (Nano model)
- Message input supports text, image paste/upload, PDF upload
- File attachments stored in Vercel Blob or similar, referenced from `message_attachments`

**Acceptance criteria**:
- First token appears in under 1 second on a warm connection
- User can send 10 messages across 3 chats, history persists across reloads
- Language switching mid-conversation works naturally (agent follows user's language)
- `usage_events` accumulates accurate token counts for every message
- Image and PDF attachments round-trip correctly (upload → display → referenced in next message)

**Out of scope**: Any actual tool execution, Notion/Calendar agent actions, billing enforcement.

---

## Phase 3 — Agent Tools (Notion & Calendar)

**Goal**: The agent can read and write Notion pages and Google Calendar events through natural language.

**In scope**:
- Tool definitions in `lib/agent/tools/` with OpenAI-compatible JSON Schema
- Notion tools: search pages, get page content, create page, update page, delete page, CRUD database rows
- Calendar tools: list events, create event, update event, delete event
- Agent confirmation logic: before destructive operations (delete, overwrite large content, remove sharing), emit a pending action that the UI renders as a confirm dialog; only execute on user confirmation
- Agent confirmation mode setting in `users` table: `destructive_only` (default), `all`, `none`
- Tool execution logging to `audit_log` for user-visible Notion and Calendar actions
- Chat UI enhancements: inline tool-call status ("Creating page in Notion..."), tool result cards, confirm-action dialogs
- Context injection: when a chat starts, the agent receives a summary of registered resources and the current week's calendar events as part of the user-context system message

**Acceptance criteria**:
- "Create a Notion page titled 'Physics Week 5' under my Physics notes" → page created in the correct location
- "What's on my calendar tomorrow?" → agent lists events without the user needing to re-specify connections
- "Delete the Notion page I just made" → confirm dialog appears; executing destructive without confirm fails even if the model tries
- Audit log shows every write operation with timestamp, user, resource, tool name, result
- Setting confirmation mode to `all` causes every write to require confirmation; setting to `none` skips even destructive confirms

**Out of scope**: Syllabus extraction, mistake note flow, feature-specific UIs.

---

## Phase 4 — Feature Flows (Syllabus, Mistakes, Views)

**Goal**: The two headline features (syllabus ingestion and mistake notes) are fully functional end-to-end, and list views mirror Notion for read-heavy browsing.

**In scope**:
- **Syllabus extraction**:
  - Accept PDF, image, URL as inputs (via chat attachment or `/app/syllabus` upload page)
  - Auto-routing: image and small PDF (≤5 pages) → Vision; large PDF → text extraction with per-page Vision fallback on tables; URL → fetch + parse
  - Structured extraction with a typed schema (course name, instructor, grading, attendance policy, assignment schedule, textbooks, office hours)
  - Preview UI where the user reviews extracted fields before save
  - On confirm: write to Notion "Syllabi" database with full structured data
  - Auto-register the saved syllabus page as a resource so the agent can reference it later
- **Mistake notes**:
  - User pastes/uploads a problem image in chat and asks for explanation
  - Agent generates: step-by-step solution, meta-commentary on "why this approach", "what to remember next time"
  - "Add to mistake notebook" button appears below assistant response
  - On click, prompt for: subject, unit, difficulty, optional tags
  - Save to Notion "Mistake Notes" database with the full explanation + image + metadata
- **Views** (read-focused mirrors of Notion data):
  - `/app/mistakes`: list with filters by subject/difficulty, search, click through to Notion
  - `/app/syllabus`: list of uploaded syllabi, click through to Notion or start a new chat with that syllabus as context
  - `/app/assignments`: list with due date sorting, status filter, click through to Notion
  - `/app/calendar`: week and month views using the chosen calendar library, event click for details, "Add event" button

**Acceptance criteria**:
- Upload a real university syllabus PDF → extraction is accurate on at least 7 of 10 fields → saved to Notion with correct structure
- Paste a math problem screenshot → step-by-step explanation includes the meta-level "what to notice" reflection → saved with all metadata
- List views load in under 1 second for up to 100 items
- Filters and search work on each list view
- Asking the agent "What's the attendance policy for my Physics class?" correctly pulls from the saved syllabus

**Out of scope**: Billing enforcement, Stripe, Redeem codes, polish.

---

## Phase 5 — Billing, Quotas, and Redemption

**Goal**: Usage is tracked, quotas are enforced, paid plan works via Stripe, and Redeem codes function for both admin and friend use.

**In scope**:
- `credit_balances` table: current-month usage snapshot per user
- Credit calculation in `lib/billing/credits.ts` from `usage_events` rows (rolling monthly window aligned to plan start date)
- Balance check at the top of every agent request: reject with `BILLING_QUOTA_EXCEEDED` error code if over
- Warning banner in UI at 80% usage
- Block screen at 100% usage: "Upgrade" or "Wait until next cycle" options
- Stripe Checkout integration for Pro subscription
- Stripe webhook handler: signature verification, idempotent handling of `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`
- `subscriptions` table tracking Stripe customer ID, subscription ID, status, current period end
- Settings → Billing page: current plan, usage bar (Credits %, no dollar values), "Manage subscription" link to Stripe Customer Portal
- Redeem code system:
  - `redeem_codes` table: `code`, `type` (admin/friend), `duration_days`, `max_uses`, `uses_count`, `expires_at`
  - `redemptions` table: `user_id`, `code_id`, `redeemed_at`, `effective_until`
  - Admin script (committed under `scripts/`) to generate codes
  - Redemption endpoint: validates code, checks max uses, creates redemption, applies effect
  - Settings → Billing: "Redeem a code" input, redemption history display
- Effective plan resolution order: active admin redemption → active Pro subscription → active friend redemption → Free

**Acceptance criteria**:
- User on Free plan hits quota → blocked → redeems a Friend code → can chat again
- Admin redeems an admin code → has no quota → `usage_events` still accumulate but no blocking
- Stripe test-mode subscription starts → webhook fires → user's plan flips to Pro → quota raises to 2000
- Cancelling subscription via Customer Portal → user drops to Free at period end
- Usage bar in UI never shows a dollar value or token number

**Out of scope**: Landing page polish, error tracking, production-mode OAuth application.

---

## Phase 6 — Polish & α Launch Prep

**Goal**: The app is ready to hand to ten invited users.

**In scope**:
- Landing page at `/` with: product description, screenshots or short demo, "Request invite" CTA or waitlist, feature highlights
- Privacy policy at `/privacy` and Terms at `/terms` (template-based, explicitly marked "α version, subject to change")
- Sentry integration for error tracking
- Consistent error states across all list views, chat, and onboarding (empty states, error boundaries, retry actions)
- Onboarding polish: tooltips, progress indicators, "skip optional step" clarity
- Session timeout handling
- Basic admin dashboard under `/app/admin` (protected by admin redemption check): user count, aggregate usage, active Redeem codes, ability to generate new codes
- Pre-launch checklist in `DEPLOY.md`:
  - All env vars set in Vercel production
  - Stripe test mode confirmed working
  - Google OAuth in Testing mode with up to 10 test users allowlisted
  - Notion integration configured with correct redirect URI for production domain
  - Sentry DSN configured
  - Neon production branch provisioned
  - Manual smoke test: full user journey from signup to mistake note save

**Acceptance criteria**:
- Ten invited users can complete the full journey (signup → onboarding → chat → feature use → settings) without hitting unexplained errors
- Sentry captures at least one deliberately triggered error from staging
- Landing page passes Lighthouse performance score ≥ 85
- Admin dashboard correctly shows user count and usage
- All pages render correctly on 1280×800 and 1920×1080

**Out of scope**: Production-mode OAuth application (deferred to β), real payment processing (deferred to β), marketing beyond the landing page (deferred to β), SRS for mistake notes (deferred to v1.0+), mobile responsiveness beyond "doesn't break" (deferred to v1.0+).

---

## How to Progress

### Automation model

This project uses a **semi-automated execution model**. Claude Code runs phases autonomously, with two human checkpoints where UX and external-service integration reality must be verified by a human.

**Phase checkpoints** (human verification required before proceeding):
- After Phase 1 — confirm Google and Notion OAuth actually work end-to-end with a real account
- After Phase 4 — confirm the two headline features (syllabus extraction, mistake notes) produce genuinely useful output by testing with one real syllabus and one real problem

**Automated phase transitions**:
- Phase 0 → 1 → (human check) → 2 → 3 → 4 → (human check) → 5 → 6

Between any two consecutive phases inside an automated run, Claude Code must:
1. Write tests that cover the phase's acceptance criteria
2. Run the full test suite and confirm passing
3. Commit with message `feat: complete Phase N`
4. Output a phase summary to stdout including: what was built, test results, any deviations from this document, and any new env vars or setup steps introduced
5. Begin the next phase only if tests pass and no deviations require human input

### Stop conditions

Claude Code must stop automated execution and report to the human if any of the following occur:
- A required environment variable is missing
- An external API authentication fails (Notion, Google, OpenAI, Stripe)
- Tests fail 3 times after repair attempts
- A decision is required that is not covered by `AGENTS.md` or `PRD.md`
- A phase's scope turns out to be materially larger than specified (split it, update this doc, stop and flag)
- `AGENTS.md` or `TASKS.md` needs to be modified for reasons beyond routine updates

### When to update this document

If a phase must be split, merged, or reordered based on implementation reality, update this document in the same commit as the code change and flag it in the phase summary. Do not leave the doc out of sync with reality.

---

## Setup Day — Human Prerequisites

**Complete all items below before beginning Phase 0.** These steps require logging into external services and cannot be automated.

Expected total time: 2–3 hours.

### S.1 Domain and hosting

- [ ] Purchase a throwaway domain (Namecheap, Porkbun, or Cloudflare Registrar — `.xyz` or similar, $2–5)
- [ ] Create a Vercel account
- [ ] Create a new Vercel project (do not link a repo yet)
- [ ] Add the custom domain to the Vercel project (DNS records will be set up later)

### S.2 Database

- [ ] Create a Neon account
- [ ] Create a new Neon project named `steadii`
- [ ] Create two branches: `main` (production) and `dev` (local development)
- [ ] Copy both connection strings

### S.3 Google Cloud (OAuth + Calendar)

- [ ] Create or select a Google Cloud project
- [ ] Enable the Google Calendar API
- [ ] Configure OAuth consent screen in **Testing mode**
- [ ] Add scopes: `openid`, `email`, `profile`, `calendar`, `calendar.events`
- [ ] Add your own email as a test user (add more later as you invite α users)
- [ ] Create OAuth 2.0 Client ID (Web application)
- [ ] Add authorized redirect URIs:
  - `http://localhost:3000/api/auth/callback/google`
  - `https://<your-domain>/api/auth/callback/google`
- [ ] Copy Client ID and Client Secret

### S.4 Notion

- [ ] Go to https://www.notion.so/my-integrations
- [ ] Create a new **public integration** (required for OAuth, not internal)
- [ ] Configure OAuth redirect URIs:
  - `http://localhost:3000/api/integrations/notion/callback`
  - `https://<your-domain>/api/integrations/notion/callback`
- [ ] Copy Client ID and Client Secret
- [ ] Copy the OAuth authorization URL template for reference

### S.5 OpenAI

- [ ] Create or sign in to your OpenAI account
- [ ] Generate an API key for this project (name it `steadii-dev`)
- [ ] Set a monthly usage limit on the account dashboard (recommended: $100 for α to cap blast radius)
- [ ] Copy the API key

### S.6 Stripe

- [ ] Create a Stripe account (individual, Canada-based since that's your location)
- [ ] Stay in **Test mode** for the entire α phase
- [ ] Create a Product named `Steadii Pro`
- [ ] Create a recurring Price: $20 USD/month
- [ ] Copy the Price ID (starts with `price_`)
- [ ] Copy the Stripe Secret Key (test mode)
- [ ] Install Stripe CLI locally for webhook forwarding during development
- [ ] Defer: the production webhook endpoint will be configured after Phase 5

### S.7 Sentry

- [ ] Create a Sentry account (free tier is enough)
- [ ] Create a new project: Platform = Next.js, name = `steadii`
- [ ] Copy the DSN

### S.8 Repository and environment

- [ ] Create a new GitHub repository named `steadii` (private)
- [ ] Clone locally, add the three docs (`AGENTS.md`, `PRD.md`, `TASKS.md`) to the root, commit
- [ ] Connect the GitHub repo to Vercel
- [ ] Create `.env.example` locally listing every required variable (no values)
- [ ] Create `.env.local` with actual values for local dev
- [ ] Add every variable to Vercel Project Settings → Environment Variables for both Production and Preview
- [ ] Generate `AUTH_SECRET` (run `openssl rand -base64 32`)
- [ ] Generate `ENCRYPTION_KEY` (run `openssl rand -base64 32`)

### S.9 Verification

- [ ] `DATABASE_URL` connection works from your local machine (test with `psql` or a quick Node script)
- [ ] All env vars are present both locally and in Vercel
- [ ] The domain's DNS is propagated (check with `dig <your-domain>`)

Once all S.1 through S.9 items are complete, Phase 0 can begin.

---

## First Claude Code Prompt

After Setup Day, the first prompt to Claude Code should be:

```
Read AGENTS.md, PRD.md, and TASKS.md in full before starting anything.

Execute phases sequentially starting from Phase 0.

Stop automatically after Phase 1 and Phase 4 for human verification.
Stop immediately on any condition listed under "Stop conditions" in TASKS.md.

Between phases:
1. Write tests that cover the acceptance criteria
2. Run the full test suite
3. Only proceed if tests pass
4. Commit each completed phase with "feat: complete Phase N"
5. Post a phase summary to stdout before beginning the next phase

Do not modify AGENTS.md or TASKS.md unless a phase's scope changes materially,
and flag any such change in the phase summary.
```
