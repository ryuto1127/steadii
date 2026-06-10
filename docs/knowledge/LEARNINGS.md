# LEARNINGS — verified engineering facts

Verified facts only. Every entry: distilled rule + evidence + date. Unverified
beliefs go to [HYPOTHESES.md](./HYPOTHESES.md) — no exceptions. Protocol:
[README.md](./README.md).

## External services (observed behavior ≠ their docs)

### neon-http-migrator-breakpoints — the migration splitter is a dumb string-find
- **Rule**: Drizzle's neon-http migrator needs `--> statement-breakpoint` between every statement (else "cannot insert multiple commands into a prepared statement"), and the splitter ignores SQL comment context — writing the literal marker inside a comment splits the file mid-comment into a syntax error.
- **Evidence**: PR #313, PR #316 (migrations 0046–0049 recovery).
- **Verified**: 2026-05-24.
- **Re-check if**: drizzle-orm major upgrade or move off neon-http driver.

### drizzle-journal-is-truth — SQL files are invisible without a journal entry, and ordering is by `when`
- **Rule**: A migration `.sql` file does nothing until `meta/_journal.json` has its entry; `migrate()` orders AND skips by the journal's `when` timestamp, not `idx` — a backfilled entry with `when` below an already-applied migration is silently skipped. When backfilling, set `when` greater than the highest applied value while preserving idx order.
- **Evidence**: PR #312/#313 (no-op migrate), PR #316 (when-ordering bug 2).
- **Verified**: 2026-05-24.
- **Re-check if**: drizzle-kit changes its journal format.

### neon-transient-fetch-failed — retry-once-then-degrade for post-success auxiliary writes
- **Rule**: Neon HTTP serverless throws transient `NeonDbError: fetch failed` on cold start / brief disconnect. Auxiliary writes that happen after the real work succeeded (usage metering, token write-back) must retry once (~200ms) then degrade to a Sentry warning — never propagate, or completed work is dropped as an unhandled rejection.
- **Evidence**: `lib/agent/usage.ts`, `lib/auth/oauth-refresh-persist.ts` (Sentry incidents 2026-04-30, 2026-05-04).
- **Verified**: 2026-05-04.
- **Re-check if**: moving off the neon-http driver or adding a connection pool.

### qstash-region-url — the default endpoint 404s outside eu-central-1
- **Rule**: QStash's default `qstash.upstash.io` routes to eu-central-1; accounts in other regions get 404 on every publish. Production must set the region-specific `QSTASH_URL` (e.g. `https://qstash-us-east-1.upstash.io`). Empty is fine only for local dev.
- **Evidence**: `lib/env.ts` guard; 2026-05-07 incident ("every Send broke").
- **Verified**: 2026-05-07.
- **Re-check if**: Upstash announces region-agnostic routing.

### qstash-schedules-outlive-code — orphans burn the 1000/day quota
- **Rule**: QStash schedules live in Upstash, surviving route deletions and domain migrations. A 5-min-cadence orphan costs 288 msgs/day against the 1000/day free quota; exhaustion breaks user-facing Send mid-day with no in-app recovery until UTC reset. After any cron route change, run `pnpm cron:audit` (diffs live schedules vs `lib/cron/manifest.ts`).
- **Evidence**: 2026-05-07 domain-migration orphan incident; PR #344 (manifest + audit script).
- **Verified**: 2026-06-09.
- **Re-check if**: paid QStash tier (quota changes) or scheduler migration.

### gmail-watch-7day-ttl — push watches silently expire
- **Rule**: `gmail.users.watch` has a hard 7-day TTL. Without the daily refresh cron the read-state (Type C) filter degrades silently — no error is raised anywhere.
- **Evidence**: migration 0036 header; `/api/cron/gmail-watch-refresh` (PR #198).
- **Verified**: 2026-05-12.
- **Re-check if**: Google changes watch TTL semantics.

### google-tasks-date-only-due — never do Date math on `due`
- **Rule**: Google Tasks `due` is date-only (midnight UTC RFC3339). Date-subtraction renders the wrong day in negative-offset timezones (a task due today showed "1 day overdue" in Vancouver). Compare calendar days by formatting both sides as YYYY-MM-DD via `Intl.DateTimeFormat` in the user's tz.
- **Evidence**: `app/app/tasks/page.tsx` dueDayLabel + `tests/tasks-due-date-timezone.test.ts` (2026-05-05 incident).
- **Verified**: 2026-05-05.
- **Re-check if**: Google adds time-of-day to Tasks due dates.

### stripe-promo-code-error-shape — collisions are detected by message text, not `param`
- **Rule**: Stripe reports promotion-code name collisions as `StripeInvalidRequestError` with `param: 'code'` — but character-validation errors carry the same param, so param-based detection misclassifies them and loops the suffix-retry to exhaustion. Match the message text (`/already exist|already in use|duplicate/i`).
- **Evidence**: `lib/waitlist/promotion-code.ts` (prod incidents 2026-04-29/30).
- **Verified**: 2026-04-30.
- **Re-check if**: Stripe API version bump changes error shapes.

### stripe-test-live-promo-codes — test-mode codes don't exist in live mode
- **Rule**: A Stripe test→live cutover requires reissuing every distributed promotion code (and re-sending approval emails). `scripts/reissue-promo-codes.ts` does exactly this and requires an `sk_live_` key.
- **Evidence**: script header; written for the α cutover.
- **Verified**: 2026-05 (script authored against real Stripe behavior).
- **Re-check if**: never — this is fundamental Stripe test/live isolation.

### webhook-idempotency-records-completion — never mark before the handler runs
- **Rule**: Recording a webhook event id BEFORE running its handler means a handler throw leaves the marker behind; the provider's retry is acked as duplicate and the side effect (e.g. a paid top-up) is lost forever. Gate on a status column: INSERT `(id,'processing')` ON CONFLICT DO NOTHING; conflict+`done` → ack, conflict+`processing` → re-run; success → `done`; failure → 500 so the provider retries. Concurrent-delivery races need downstream unique indexes as the real guarantee.
- **Evidence**: PR #344 (state machine + 3 behavioral tests incl. fail-then-retry fulfills exactly once); race analysis verified by evaluator 2026-06-09.
- **Verified**: 2026-06-09.
- **Re-check if**: adding new webhook handlers — each needs its own downstream idempotency check.

### nextjs-inline-server-actions — closures need "use server" and serializable captures
- **Rule**: Inline async closures passed from a Server Component to a Client Component each need their own inline `"use server"` directive, and every closure-captured value must be serializable — capturing a function (e.g. a next-intl `t`) crashes prod render with "Functions cannot be passed directly to Client Components". Pre-resolve captured values to plain strings. Separately: next-intl validates ICU placeholders at the `t()` call — `t("key").replace("{x}", v)` throws FORMATTING_ERROR before `.replace` runs; pass values as `t("key", { x: v })`.
- **Evidence**: PR #320 (crashed /app for nearly all users); Sentry JAVASCRIPT-NEXTJS-8 (2026-05-05).
- **Verified**: 2026-05-25.
- **Re-check if**: Next.js majors change server-action compilation.

### openai-prompt-cache-prefix — zero the seconds in any system-block timestamp
- **Rule**: OpenAI prompt caching keys on the literal prompt prefix. A per-second timestamp in the system block invalidates the cache every send; minute precision gives a 60s-stable prefix. Measured 78% cache-hit after the fix.
- **Evidence**: `lib/agent/serialize-context.ts` (engineer-59 cost audit, 2026-05-13).
- **Verified**: 2026-05-13.
- **Re-check if**: OpenAI changes cache keying (check their caching docs on SDK majors).

### ms-graph-edu-admin-consent — EduAssignments scopes are never user-consentable
- **Rule**: ALL `EduAssignments.*` MS Graph scopes — including `.ReadBasic`, despite the naming convention elsewhere in Graph — require school-IT admin consent. A self-serve student flow cannot use them; the viable path is Outlook Calendar's auto-created "Assignment due" events.
- **Evidence**: scope-by-scope consent investigation, 2026-05 (memory `feedback_ms_education_admin_consent`).
- **Verified**: 2026-05.
- **Re-check if**: Microsoft revises Education API consent tiers.

## Codebase traps

### vercel-deploy-precedes-migration — hot-path readers of new tables must fail soft
- **Rule**: Vercel auto-deploys merged code BEFORE the manual prod migration runs, so any hot-path read of a just-added table throws "relation does not exist" for the whole window — PR #338's per-triage read killed email ingest. Wrap reads of newly added tables in try/catch returning a safe empty default (pattern: `fetchPendingAutoCalRows` in `lib/agent/queue/build.ts`). Taxonomy: SCHEMA_DRIFT_READ_ON_DEPLOY.
- **Evidence**: PR #338 incident → PR #340 fix.
- **Verified**: 2026-06-07.
- **Re-check if**: prod migrations become part of the deploy pipeline.

### prod-migrate-verify-schema-not-journal — "Migrations applied." is not proof
- **Rule**: Before using `migrate-prod.ts --journal-only NN`, verify the tables/columns/enums actually exist in prod via `information_schema` queries — registering a hash without the SQL having run creates a phantom migration that drizzle will never re-attempt (the auto-cal subsystem silently failed in prod for weeks this way). After ANY prod migration activity, smoke-check the actual schema, not the bookkeeping table.
- **Evidence**: PR #316 recovery (phantom migrations, weeks of silent failure).
- **Verified**: 2026-05-24.
- **Re-check if**: migrate-prod.ts gains schema-verification built in.

### turbopack-eager-import-trace — heavy optional deps must be lazily imported
- **Rule**: Eagerly importing a heavy package (node-ical → temporal-polyfill) anywhere in the agent tool-registry/orchestrator import graph can crash `/api/chat` on Vercel at runtime ("Cannot find module <nested .pnpm path>") — Turbopack's externalRequire hardcodes the build-time path and Vercel's tracer can't follow pnpm symlinks into the lambda. Packaging tweaks do NOT fix it: `serverExternalPackages` (#237) and hoisting to top-level deps (#239) both failed; `outputFileTracingIncludes` (#241) broke the build. The structural fix is a lazy `await import()` inside the function that needs it (#242).
- **Evidence**: PR chain #235→#237→#239→#241→#242; `lib/integrations/ical/parser.ts`.
- **Verified**: 2026-05-13 (chain), re-confirmed by sweep 2026-06-10. NOTE: supersedes the private-memory claim that #239 was the full fix.
- **Re-check if**: Turbopack/Vercel tracing changes (Next majors) — re-test /api/chat after touching that import graph regardless.

### mirror-lists-always-drift — derive from the source, add a drift-killer test
- **Rule**: Any hand-maintained list mirroring another source of truth (wipe list vs schema, heartbeat map vs live schedules, DEPLOY cron table vs console) WILL drift silently. Invert: explicit allowlist + derive the action set from the live source (schema introspection / manifest), plus a CI test asserting every item is classified — so a new item in neither list fails the build. Tables defined outside the main schema module must be explicitly registered (monthly_digests was missed by naive iteration).
- **Evidence**: PR #342 (wipe: 23 hand-listed vs 55 actual tables, third-party PII retained); PR #341/#344 (three disagreeing cron sources).
- **Verified**: 2026-06-09.
- **Re-check if**: n/a — this is a standing design rule.

### health-map-must-match-live-schedules — consolidated crons pin health to degraded
- **Rule**: `/api/health`'s expected-cron set must contain exactly the crons with a LIVE QStash schedule. A consolidated/removed cron's frozen heartbeat pins health to "degraded" forever (false-positive saturation masks real outages); master-sweep's heartbeat is the liveness signal for all its sub-sweeps. Also: external uptime monitors must alert on body `status:"degraded"`, not just non-200 — stale crons still return HTTP 200. Never gate sub-jobs on `minute===0` inside a sweep tick; ticks land off-minute and skip whole cohorts.
- **Evidence**: PR #305 (consolidation), #341, #344; `lib/cron/manifest.ts` now generates the map.
- **Verified**: 2026-06-10 (prod /api/health all-green with manifest-derived map).
- **Re-check if**: any cron is added/consolidated — update the manifest, never the derived surfaces.

### undo-windows-live-server-side — client timers fail-drop on unmount
- **Rule**: A client-side timer implementing an undo window for a consented action is fail-drop: unmount cleanup (any navigation, tab close) cancels the action while the toast reads success (ACTION_COMMITMENT_VIOLATION). Enqueue server-side at click time (QStash message with `sendAt`); the client countdown renders the server-returned `sendAt`; Undo calls a server cancel action.
- **Evidence**: PR #343 (deleted the client inline-send-timer from #311).
- **Verified**: 2026-06-09.
- **Re-check if**: n/a — standing design rule for consented actions.

### fail-open-helpers-need-failmode — audit error-swallowing before unattended reuse
- **Rule**: A helper that swallows its own internal errors into a success result (correct for attended paths — a human reviews anyway) silently becomes fail-OPEN when reused on an unattended path; the caller's fail-closed try/catch never fires because the helper never throws. Make the failure policy an explicit `failMode` parameter; unattended callers request `closed`. Test by failing the helper's DEPENDENCY (mock the API client to reject), not by mocking the helper to throw — the latter gives false confidence.
- **Evidence**: PR #343 second commit (`checkDraftBeforeSend` failMode; evaluator catch). Taxonomy: FAIL_OPEN_REUSED_UNATTENDED.
- **Verified**: 2026-06-09.
- **Re-check if**: n/a — standing design rule.

### exclusion-needs-every-read-path — and "archived" is not "deleted"
- **Rule**: Excluding a data class at ingest is never sufficient — legacy rows resurface through every other reader (queue build, display-name variants, vector retrieval citing excluded rows on unrelated cards). Sweep ALL readers of the table, and make cleanup scripts match the exact predicate each query filters on: retrieval filters `deleted_at IS NULL` and ignores `status`, so a cleanup that only sets `status='archived'` leaves rows fully retrievable. Put shared predicates in a leaf module to avoid import cycles.
- **Evidence**: PR chain #308→#321→#327→#328 (self-sender exclusion took four passes); `lib/agent/email/self-sender.ts`. Taxonomy: SELF_REFERENCE_RETRIEVAL_LOOP.
- **Verified**: 2026-06-01.
- **Re-check if**: adding any new reader of `inbox_items`/`email_embeddings` — apply the exclusion there too.

### agent-loop-artifacts-accumulate — never persist per-iteration by overwrite
- **Rule**: In a multi-iteration agent loop, persisting per-iteration artifacts by overwrite keeps only the FINAL iteration's data; history/rehydrate UIs then under-report the run (a chip showed 4 tool calls for an 8+-call sequence). Accumulate across iterations — including retry/corrective passes — into one array before each persist.
- **Evidence**: PR #260 (`persistedToolCalls` accumulator, confirmed against DB rows).
- **Verified**: 2026-05-15.
- **Re-check if**: orchestrator persistence layer is restructured.

### no-commit-launch-json — the harness mutates it locally
- **Rule**: Never commit changes to `.claude/launch.json`; the dev harness rewrites it locally and it WILL show up dirty. (Candidate hardening: gitignore or a pre-commit guard — currently convention-only.)
- **Evidence**: engineer-35 incident (accidental commit); warning repeated across 5+ handoffs.
- **Verified**: 2026-04 (incident).
- **Re-check if**: the file gets gitignored — then delete this entry.

### stale-handoffs-are-not-templates — docs/handoffs/ predates the role split
- **Rule**: Everything in `docs/handoffs/` predates the 2026-05-24 subagent role split and the 2026-06-02 eval-billing guardrails. Copying one as a template imports contradictions: 29 of them say "don't push without Ryuto's authorization" (current contract: autonomous push→PR per `.claude/agents/engineer.md`), and several instruct running `pnpm eval:agent` live (now forbidden in test-running handoffs; hard-gated behind `ALLOW_REAL_LLM` + cost cap). Treat the directory as history; the agent definitions + AGENTS.md are the live contract.
- **Evidence**: sweep 2026-06-10 (29 files with the stale push rule; engineer-52/53/54/59/62 with live-eval instructions vs `tests/agent-evals/run.ts` gate).
- **Verified**: 2026-06-10.
- **Re-check if**: handoff docs get refreshed or archived — then delete this entry.

## Tooling & environment

### worktree-bootstrap — subagent worktrees ship bare
- **Rule**: Agent-tool worktrees (`.claude/worktrees/agent-*`) have no `node_modules` and no `.env.local`. Bootstrap: `pnpm install --offline` + symlink the parent repo's `.env.local`. `tsc` OOMs at the default heap on this machine — run `NODE_OPTIONS=--max-old-space-size=8192 pnpm typecheck`. Also: `gh pr merge --delete-branch` from a branch checked out in any worktree fails only on the local-delete step — the merge itself succeeded; don't re-merge.
- **Evidence**: PRs #342–#346 (six worktree agent runs, 2026-06-09).
- **Verified**: 2026-06-09.
- **Re-check if**: the harness starts provisioning worktrees with deps/env.

### scripts-need-register-preload — ESM hoisting defeats inline dotenv
- **Rule**: Repo scripts importing app code must run via `tsx --require ./scripts/_register.cjs`: ESM hoists imports above top-level code, so inline dotenv runs AFTER `@/lib/db/client` evaluates env, and `server-only` throws outside Next. The preload stubs server-only and loads `.env.local` first. Also: `lib/db/client` always points at the DEV Neon branch — prod-targeting scripts must discover the prod URL separately.
- **Evidence**: `scripts/_register.cjs`; `embed-backfill.ts` header.
- **Verified**: 2026-04.
- **Re-check if**: scripts migrate to a different runner.

### prod-db-url-via-neon-api — Vercel won't give you the prod connection string
- **Rule**: The prod Neon `DATABASE_URL` is not obtainable from the Vercel UI and `vercel env pull` returns it empty (Neon integration marks it sensitive). Prod-DB scripts discover the URI via the Neon REST API using `NEONCTL_API_KEY` from `.env.local` (pattern: `scripts/migrate-prod.ts`).
- **Evidence**: DEPLOY.md §2; `migrate-prod.ts` + `wave5-ramp-report.ts` headers.
- **Verified**: 2026-05.
- **Re-check if**: Neon/Vercel integration changes secret exposure.

### tsx-permissive-tsc-strict — always strict-typecheck before push
- **Rule**: `pnpm tsx` executes files that strict `tsc`/`next build` rejects. Always run `pnpm typecheck` (including `scripts/*.ts`) before push — a tsx-only-verified script broke the prod build.
- **Evidence**: PR #233 (prod break) → #234 (fix).
- **Verified**: 2026-05-13.
- **Re-check if**: n/a.

### turbopack-css-hmr-cache — stale global CSS needs a .next wipe
- **Rule**: When global CSS edits stop propagating to the dev server across multiple iterations, it's the Turbopack cache: `rm -rf .next` + restart. Sibling trap: Tailwind v4 silently drops every rule BELOW a CSS comment containing glob-like text (`/app/*`) — rephrase comments, don't debug the selectors.
- **Evidence**: PR #132 iteration (2026-05-02); Tailwind comment incident (pre-launch redesign).
- **Verified**: 2026-05-02.
- **Re-check if**: Tailwind/Turbopack majors.

### bash-exit-trap-eats-status — traps must re-raise the captured rc
- **Rule**: A bash EXIT trap whose last command succeeds (e.g. `rm "$TMP"`) overwrites the script's real exit status with 0 — fail-OPEN if the script is a gate (leak scanner). The trap's first statement must capture `rc=$?` and end with `exit $rc`; missing-arg guards need explicit deterministic exit codes.
- **Evidence**: PR #332 (`check-no-pii.sh` + regression tests).
- **Verified**: 2026-06-01.
- **Re-check if**: n/a — shell semantics.

### leak-scanner-design — four traps, all hit in practice
- **Rule**: (a) Scanning only file diffs misses commit messages and PR title/body — scan all three surfaces; (b) allowlist entries are themselves leak vectors — never allowlist a real institution's domain (one suppressed a real leak); (c) diff scans must check ADDED lines only or scrub-PRs false-positive on their own deletions; (d) pass PR title/body into CI via env vars, never shell interpolation (injection). Literal identity patterns live gitignored locally + mirrored to the `PII_PATTERNS_LOCAL` repo secret — committing them would itself be the leak.
- **Evidence**: PR #329 leak → #331/#332; #339 (allowlist suppression).
- **Verified**: 2026-06-08.
- **Re-check if**: new leak shapes land — extend patterns, then update this entry.

### pnpm-action-setup-version — specify the version in exactly one place
- **Rule**: `pnpm/action-setup@v4` reads the version from package.json's `packageManager`; ALSO passing `version:` in the workflow causes `ERR_PNPM_BAD_PM_VERSION`. Keep package.json canonical.
- **Evidence**: CI fix 2026-05-18 (comment in `.github/workflows/agent-evals.yml`).
- **Verified**: 2026-05-18.
- **Re-check if**: pnpm action major bump.
