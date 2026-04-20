# AGENTS.md — Steadii Technical Conventions

This document defines the technical stack, conventions, and constraints for Claude Code when working on Steadii. Read this before starting any task. Update it when decisions are made or change.

---

## 1. Project Context

Steadii is a web app that helps university students manage their academic life through a conversational AI agent. It integrates with Notion (required) and Google Calendar (required), stores chat history in its own database, and uses OpenAI for all AI capabilities.

Refer to `PRD.md` for product-level decisions. This document focuses on implementation.

---

## 2. Tech Stack

### 2.1 Core

- **Framework**: Next.js 15+ with App Router, TypeScript strict mode
- **Runtime**: Node.js 20+ (Vercel serverless functions)
- **Hosting**: Vercel (free tier for α version)
- **Package manager**: `pnpm` (faster installs, better monorepo support if needed later)

### 2.2 Database

- **Primary DB**: Neon Postgres (serverless, pairs well with Vercel)
- **ORM**: Drizzle ORM (lighter than Prisma, better edge compatibility, type-safe)
- **Migrations**: Drizzle Kit

Rationale: Drizzle over Prisma because (1) smaller runtime footprint on serverless, (2) closer to raw SQL which makes debugging easier, (3) no generation step needed for every schema change.

### 2.3 Authentication

- **Library**: Auth.js (NextAuth v5+) with Google provider only
- **Session**: Database sessions stored in Postgres (not JWT), for fine-grained revocation
- **OAuth scopes for Google**:
  - `openid`, `email`, `profile`
  - `https://www.googleapis.com/auth/calendar`
  - `https://www.googleapis.com/auth/calendar.events`

### 2.4 External Integrations

- **Notion**: Official `@notionhq/client` SDK, OAuth 2.0 flow
- **Google Calendar**: `googleapis` npm package
- **OpenAI**: Official `openai` SDK, use Responses API with streaming
- **Stripe**: Official `stripe` SDK + Stripe Checkout + Customer Portal

### 2.5 UI

- **Styling**: Tailwind CSS v4
- **Component library**: shadcn/ui (copied-in components, not a dependency)
- **Icons**: `lucide-react`
- **Calendar view**: `@fullcalendar/react` or `react-big-calendar` — evaluate based on API weight, prefer the lighter option
- **Markdown rendering**: `react-markdown` with `remark-gfm` for chat messages
- **Toast/notifications**: `sonner`

### 2.6 State & Data Fetching

- **Server components by default**. Use client components only when interactivity requires it.
- **Data fetching**: React Server Components + server actions for mutations.
- **Client-side state**: Keep minimal. Use `zustand` only if prop drilling becomes painful.
- **Form handling**: `react-hook-form` + `zod` for validation.

### 2.7 Testing

- **Unit / integration**: Vitest
- **E2E**: Playwright (for critical paths only — auth, chat send, Notion write)
- **Coverage**: Not chasing a percentage. Test what's risky: auth flow, Stripe webhooks, agent tool calls, quota enforcement.

### 2.8 Observability

- **Logs**: Vercel logs for α, structured logging via `pino`
- **Error tracking**: Sentry (free tier)
- **Usage tracking**: Custom table in Postgres for token/credit accounting
- **Analytics**: PostHog (free tier) — only after α feedback loop proves the product

---

## 3. Directory Structure

```
/
├── app/                          # Next.js App Router
│   ├── (marketing)/              # Public landing pages
│   │   ├── page.tsx              # Landing page
│   │   ├── privacy/page.tsx      # Privacy policy
│   │   └── terms/page.tsx        # Terms of service
│   ├── (auth)/                   # Auth-related routes
│   │   ├── login/page.tsx
│   │   └── onboarding/page.tsx   # First-time setup flow
│   ├── app/                      # Authenticated app routes
│   │   ├── layout.tsx            # App shell with sidebar
│   │   ├── chat/
│   │   │   ├── page.tsx          # Chat list
│   │   │   └── [id]/page.tsx     # Single chat view
│   │   ├── calendar/page.tsx
│   │   ├── mistakes/page.tsx
│   │   ├── syllabus/page.tsx
│   │   ├── assignments/page.tsx
│   │   ├── resources/page.tsx
│   │   └── settings/
│   │       ├── page.tsx
│   │       ├── billing/page.tsx
│   │       └── connections/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── chat/route.ts         # Main chat streaming endpoint
│       ├── stripe/
│       │   ├── checkout/route.ts
│       │   └── webhook/route.ts
│       └── integrations/
│           ├── notion/callback/route.ts
│           └── google/callback/route.ts
│
├── lib/
│   ├── db/
│   │   ├── schema.ts             # Drizzle schema
│   │   ├── client.ts             # DB client setup
│   │   └── migrations/
│   ├── auth/
│   │   └── config.ts             # Auth.js config
│   ├── agent/
│   │   ├── orchestrator.ts       # Main agent loop
│   │   ├── tools/                # Tool definitions
│   │   │   ├── notion.ts
│   │   │   ├── calendar.ts
│   │   │   ├── syllabus.ts
│   │   │   └── mistakes.ts
│   │   ├── prompts/              # System prompts
│   │   │   ├── main.ts
│   │   │   ├── syllabus-extract.ts
│   │   │   └── mistake-explain.ts
│   │   └── models.ts             # Model routing rules
│   ├── integrations/
│   │   ├── notion/
│   │   │   ├── client.ts
│   │   │   ├── setup.ts          # Creates parent page + 3 DBs
│   │   │   └── types.ts
│   │   ├── google/
│   │   │   └── calendar.ts
│   │   └── openai/
│   │       └── client.ts
│   ├── billing/
│   │   ├── stripe.ts
│   │   ├── credits.ts            # Credit accounting
│   │   └── redeem.ts             # Redeem code logic
│   ├── i18n/
│   │   ├── config.ts
│   │   └── translations/
│   │       ├── en.ts
│   │       └── ja.ts
│   └── utils/
│
├── components/
│   ├── ui/                       # shadcn components
│   ├── chat/
│   ├── calendar/
│   ├── layout/
│   └── onboarding/
│
├── public/
├── drizzle.config.ts
├── next.config.ts
├── AGENTS.md                     # This file
├── PRD.md
├── TASKS.md
└── package.json
```

### 3.1 Conventions

- **One component per file**, named exports preferred.
- **Server-only code** lives in `lib/` with `import 'server-only'` at the top.
- **Client components** must start with `'use client'`.
- **Route groups** `(marketing)`, `(auth)` for layout separation.

---

## 4. Database Schema Principles

The schema will be generated by Claude Code during Phase 0 and evolve through subsequent phases. High-level principles apply across all tables:

- **UUIDs as primary keys** (not serial ints) — easier for future migrations, safer in URLs.
- **`created_at`, `updated_at` on every table**, defaulted to `now()`.
- **Soft deletes** for `users`, `chats`, `messages` (via `deleted_at`). Hard deletes for ephemeral data like usage logs.
- **Foreign keys always declared** with `ON DELETE CASCADE` or `SET NULL` explicitly.
- **Encrypted columns** for OAuth tokens: encrypted at the application layer using a key from env, not database-level encryption.

Key tables:
- `users`
- `accounts` (Auth.js standard, includes OAuth provider tokens)
- `notion_connections` (Notion workspace + access token)
- `registered_resources` (Notion pages/DBs the agent can access)
- `chats`, `messages`, `message_attachments`
- `usage_events` (per-request token usage for credit accounting)
- `credit_balances` (monthly window per user)
- `subscriptions` (Stripe subscription state)
- `redeem_codes`, `redemptions`
- `audit_log` (agent actions on external resources — Notion writes, calendar edits)

---

## 5. Agent Architecture

### 5.1 Orchestrator

The main agent loop lives in `lib/agent/orchestrator.ts`. It:

1. Receives a user message + conversation history + user context (registered resources, recent calendar events summary, user preferences)
2. Selects a model based on rules in `lib/agent/models.ts`
3. Calls OpenAI with tool definitions from `lib/agent/tools/`
4. Streams the response back to the client
5. Logs usage to `usage_events`
6. If the agent calls a tool, executes it, streams status updates, appends results to the conversation, and continues the loop
7. Writes the final assistant message to `messages`

### 5.2 Tool Design

Each tool:
- Has a clear JSON Schema definition for OpenAI
- Has an `execute()` function that runs in the server context
- Returns structured results (not raw strings) when possible
- Logs its execution to `audit_log` for user-visible actions
- Checks user's `agent_confirmation_mode` setting before destructive operations — if confirmation is required, it emits a pending action instead of executing immediately

### 5.3 Model Routing Rules

Defined in `lib/agent/models.ts` as a simple switch:

```typescript
export function selectModel(taskType: TaskType): OpenAIModel {
  switch (taskType) {
    case 'chat':
    case 'tool_call':
      return 'gpt-5.4-mini'
    case 'mistake_explain':
    case 'syllabus_extract':
      return 'gpt-5.4'
    case 'chat_title':
    case 'tag_suggest':
      return 'gpt-5.4-nano'
  }
}
```

No LLM-based routing. If performance data later justifies it, revisit.

### 5.4 System Prompt Stability

System prompts are long. To maximize OpenAI prompt caching:
- Keep system prompts as static strings in `lib/agent/prompts/`
- Variable user context goes in a second system message appended after the stable one
- Do not interpolate user-specific data into the main system prompt

---

## 6. Security

### 6.1 Secrets Management

All secrets live in Vercel environment variables. `.env.example` is committed with keys but no values. Never commit actual secrets.

Required env vars:
- `DATABASE_URL`
- `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
- `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`
- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_PRO`
- `ENCRYPTION_KEY` (32-byte random key for token encryption)
- `APP_URL` (base URL for OAuth callbacks)

### 6.2 Token Encryption

OAuth tokens (Notion, Google Calendar) are encrypted using AES-256-GCM with `ENCRYPTION_KEY` before DB storage. Decryption happens only inside server-side code paths.

### 6.3 Rate Limiting

- Chat send: 30 messages/minute/user (via Upstash Redis or simple DB-based counter)
- Redeem code redemption: 5 attempts/hour/user
- Login: rely on Auth.js built-in protections

### 6.4 Input Validation

All server actions and API routes validate inputs with `zod`. No raw type assertions on external data.

---

## 7. Billing & Credits

### 7.1 Credit Calculation

`lib/billing/credits.ts` converts OpenAI usage into credits:

- For each OpenAI call, record `input_tokens`, `output_tokens`, `cached_tokens`, `model`
- Compute cost in USD using the current pricing table
- Convert to credits: `credits_used = floor(cost_usd * 100)` (1 credit = $0.01)
- Store in `usage_events`

### 7.2 Balance Check

Before any OpenAI call:
1. Compute user's current month credit usage (sum of `usage_events` this month)
2. Compare to quota (500 for Free, 2000 for Pro, unlimited for Admin redemption)
3. If over, reject the request with a specific error code that the UI handles

### 7.3 Redeem Codes

- Codes are generated via an admin-only script or direct DB insert for α
- A code has: `type` (admin | friend), `duration_days`, `max_uses`, `expires_at`
- Redemption creates a `redemption` row and updates the user's effective plan until `duration_days` elapses
- Admin redemption overrides plan checks entirely

### 7.4 Stripe Integration

- Use Stripe Checkout for subscription start (not custom forms — avoids PCI scope)
- Webhook handler in `app/api/stripe/webhook/route.ts` verifies signature, handles `customer.subscription.*` events, updates `subscriptions` table
- Stripe Customer Portal link for plan management
- α version: Stripe in test mode, no real charges

---

## 8. Internationalization

### 8.1 UI Translation

- Translation keys in `lib/i18n/translations/{en,ja}.ts`
- Use `next-intl` library for routing and hooks
- Default locale: detected from `Accept-Language` header, then user preference

### 8.2 Agent Language

- Agent receives a system instruction: "Respond in the language the user is using. If the user switches languages mid-conversation, switch with them."
- No server-side language detection needed — the model handles it.

---

## 9. Code Style & Conventions

### 9.1 TypeScript

- Strict mode on
- No `any` — use `unknown` and narrow explicitly
- Prefer `type` over `interface` for object shapes, `interface` only for extensible public APIs

### 9.2 Naming

- Files: `kebab-case.ts` for utilities, `PascalCase.tsx` for React components
- Functions: `camelCase`
- Types: `PascalCase`
- Constants: `SCREAMING_SNAKE_CASE` only for true constants (env keys, magic numbers)
- Database columns: `snake_case`
- Internal TypeScript types that mirror DB rows: keep `snake_case` in Drizzle schema, map to `camelCase` at the boundary if desired, but don't double-map inside a single module

### 9.3 Imports

- Absolute imports via `@/*` alias (configured in `tsconfig.json`)
- Order: (1) external packages, (2) `@/lib/*`, (3) `@/components/*`, (4) relative imports
- No default exports from utility modules (except Next.js pages which require them)

### 9.4 Comments

- Code should be self-explanatory. Comments only for non-obvious *why*.
- JSDoc on exported functions in `lib/` if the signature isn't clear from types alone.
- No TODO comments in committed code — use issues or `TASKS.md`.

### 9.5 Error Handling

- Never swallow errors silently
- User-facing errors get a stable error code (`BILLING_QUOTA_EXCEEDED`, `NOTION_AUTH_EXPIRED`, etc.) plus a human message
- Internal errors go to Sentry with full context

---

## 10. Design System

### 10.1 Visual direction

Steadii follows a **Warm / Soft** visual language. Reference points: Notion, Arc, Craft, Things. The product should feel like a well-lit reading nook, not a corporate dashboard. Use cream and warm-neutral backgrounds, generous whitespace, subtle shadows over harsh borders, and soft-but-not-bubbly corners. Both light and dark modes are first-class citizens. Dark mode is **warm-dark** — never pure black, never cold slate.

### 10.2 Color tokens

Use CSS custom properties with HSL triplets (no `hsl()` wrapper), following shadcn/ui convention. Define in `app/globals.css` under `:root` and `.dark`.

**Light mode**:
```
--background: 45 35% 97%;        /* warm cream */
--surface: 0 0% 100%;             /* pure white for cards */
--surface-raised: 45 25% 94%;     /* slightly darker cream */
--border: 40 20% 87%;             /* warm neutral */
--foreground: 28 15% 15%;         /* warm near-black */
--muted-foreground: 28 8% 42%;    /* warm medium */
--primary: 140 22% 35%;           /* sage green — academic, focus */
--primary-foreground: 45 35% 97%;
--accent: 25 55% 58%;             /* warm terracotta */
--accent-foreground: 45 35% 97%;
--destructive: 0 65% 50%;
--ring: 140 22% 35%;
```

**Dark mode**:
```
--background: 30 8% 10%;          /* warm near-black */
--surface: 30 6% 13%;
--surface-raised: 30 6% 16%;
--border: 30 8% 22%;
--foreground: 45 20% 92%;         /* warm off-white */
--muted-foreground: 30 8% 60%;
--primary: 140 28% 58%;           /* brighter sage for dark */
--primary-foreground: 30 8% 10%;
--accent: 25 55% 65%;
--accent-foreground: 30 8% 10%;
--destructive: 0 55% 55%;
--ring: 140 28% 58%;
```

The sage-green primary signals academic focus without being clinical. The terracotta accent is used sparingly for highlights (e.g., "new mistake note" indicator, selected calendar event).

### 10.3 Typography

**Fonts** (all via `next/font/google`):
- **Instrument Serif** — display and editorial accents (h1 on marketing pages, empty-state headlines, landing hero). Brings an academic, literary feel.
- **Instrument Sans** — primary UI font for all body text, buttons, labels, navigation.
- **JetBrains Mono** — code, credit displays (admin-only views), any numeric tabular content.

**Type scale**:
- Display (Instrument Serif): 2.25rem / line-height 1.2 / tracking -0.02em
- H1: 1.875rem / 1.25 / -0.015em
- H2: 1.5rem / 1.3 / -0.01em
- H3: 1.25rem / 1.4
- Body: 0.9375rem (15px) / 1.6 — slightly larger than default for comfortable reading
- Small: 0.8125rem / 1.5
- Tiny: 0.75rem / 1.4

**Weight usage**: Regular (400) for body, Medium (500) for buttons and labels, Semibold (600) sparingly for emphasis. Avoid Bold (700) in body content.

### 10.4 Spacing, radius, shadow

- **Radius**: `rounded-md` (6px) for inputs, `rounded-lg` (8px) for buttons and small elements, `rounded-xl` (12px) for cards, `rounded-2xl` (16px) for modals and major surfaces. `rounded-full` only for avatars and icon buttons.
- **Spacing**: generous. Default card padding is `p-6`, not `p-4`. Section gaps are `gap-8` or `gap-10`. Container max-width is 1200px with `px-6` minimum.
- **Shadow**: prefer subtle shadow over border in light mode. Cards use `shadow-sm`, popovers `shadow-md`, modals `shadow-lg`. In dark mode, use surface-raised levels instead of shadows (shadows disappear on dark backgrounds anyway).
- **Border**: use sparingly. Form inputs, table rows, dividers between major sections — yes. Every card — no.

### 10.5 Component conventions

- **Buttons**: soft shadow, 8px radius, medium-weight text, 150ms hover transition. Primary = filled sage. Secondary = ghost (no background until hover). Destructive = filled red only after confirm.
- **Inputs**: 6px radius, 1px border, focus ring using `--ring` at full opacity, smooth 150ms transition on focus.
- **Cards**: 12px radius, no border in light (shadow-sm), subtle border in dark (no shadow), `p-6` padding minimum.
- **Chat messages**: no bubbles. Use vertical rhythm and subtle surface shifts to separate turns. User messages right-aligned with a faint `--surface-raised` background; assistant messages left-aligned with no background — just prose with comfortable line-height.
- **Sidebar**: `--surface-raised` background, no harsh border on the right edge (use a subtle gradient or nothing), active items with 8px radius and `--surface` background.
- **Empty states**: Instrument Serif headline, simple Lucide icon (not illustration), one clear CTA. Example: "No mistake notes yet" with "Add your first one" button.
- **Loading**: skeleton screens for content areas, small inline spinners only for button submit states. Never use full-page spinners.

### 10.6 Motion

- Default hover/focus transition: 150ms ease-out
- Layout/presence transitions: 200ms ease-in-out
- Page transitions: fade only — no slide, no flip
- Avoid scroll-triggered animations, parallax, and cursor effects
- Streaming chat responses are the main animation — keep everything else quiet

### 10.7 Dark mode

- Toggle in Settings with three options: Light, Dark, System (default)
- Store in `users.preferences` as `{ theme: 'light' | 'dark' | 'system' }`
- Use `next-themes` for switching and system detection
- All images and illustrations need dark-mode variants or use `currentColor`
- Screenshots and syllabi previews retain their original colors (do not theme them)

### 10.8 Iconography

- **Library**: `lucide-react` exclusively. Do not mix icon sets.
- **Size**: 16px inline with text, 20px standalone actions, 24px for hero/empty-state placements
- **Stroke width**: 1.75 (slightly thinner than default 2) for a more refined feel
- Use `currentColor` so icons inherit text color automatically in both themes

### 10.9 Landing page specifics

- Hero headline in Instrument Serif at `text-5xl` or larger
- Avoid stock photography and generic SaaS illustrations
- Use real product screenshots (with light + dark versions)
- Single focused CTA above the fold ("Request invite" for α)
- Quiet, confident tone in copy — do not oversell

### 10.10 What to avoid

- Gradient backgrounds across large surfaces
- Glassmorphism, heavy blurs, translucent stacks
- Bright saturated colors outside the defined palette
- Cartoon mascots, playful illustrations, emoji in UI chrome
- Compact information density — choose whitespace over cramming
- Bottom tab bars (this is desktop-first)
- Animated page entrances, scroll-driven reveals, hover 3D tilts
- More than one accent color at a time on a single screen

---

## 11. Working with Claude Code

### 11.1 Phase Discipline

Do not start a new phase until the current phase's acceptance criteria in `TASKS.md` are met. If you're tempted to pull work forward, stop and ask first.

### 11.2 Before Writing Code

For any non-trivial task:
1. Read this file
2. Read the relevant section of `PRD.md`
3. Read the relevant section of `TASKS.md`
4. Use `Explore` subagent to find existing patterns before creating new ones

### 11.3 When Uncertain

Do not invent stack decisions (new libraries, alternative frameworks, different DB choices). If this document doesn't cover a decision, stop and surface the question. A short clarifying comment is cheaper than a wrong rewrite.

### 11.4 When Updating This File

If a decision in this document needs to change based on implementation reality, update this document in the same commit as the code change. Do not leave the doc out of date.

### 11.5 Commit Messages

Conventional Commits format:
```
feat(chat): stream agent responses
fix(billing): prevent negative credit balance
chore(deps): upgrade drizzle to 0.40
```

Scope is the top-level feature area (`chat`, `billing`, `notion`, `auth`, etc.).
