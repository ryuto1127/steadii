# Phase 8 — Proactive Agent — Completion Report

Branch: `phase8-proactive-agent` (not pushed; awaits explicit
authorization per the handoff).

## What shipped

All four PRs from the handoff land as a single branch with one
commit per PR boundary.

### PR 1 — Schema + scanner foundation (commit `e47573c`)

- `lib/db/migrations/0025_majestic_thor.sql` — adds `agent_events`
  and `agent_proposals` tables. Schema-side: new types
  `AgentEventSource`, `AgentProposalIssueType`,
  `AgentProposalActionTool`, `ActionOption`, `ProposalSourceRef`.
  Unique index on `(user_id, dedup_key)` enforces D2.
- `lib/agent/proactive/snapshot.ts` — gathers calendar events,
  syllabus schedule items, exam/lecture windows, assignments, and
  per-class recent-activity-days into a `UserSnapshot`.
- `lib/agent/proactive/scanner.ts` — `runScanner(userId, trigger)`
  with 5-min per-user debounce; cron.daily bypasses debounce per
  D1. Errors fall through to `agent_events.status='error'` with
  the message persisted; rule errors are isolated per-rule.
- `triggerScanInBackground` hooks into write paths in
  `lib/agent/tools/calendar.ts` (create / update / delete),
  `lib/syllabus/save.ts`, `lib/assignments/save.ts`, and
  `lib/mistakes/save.ts`. Background fire-and-forget — caller
  latency is unaffected.
- `app/api/cron/scanner/route.ts` daily cron route (QStash
  signed). Enumerates digest-enabled users and fires the scanner.

### PR 2 — Rules + proposal generation (commit `971ef12`)

- Five rule modules under `lib/agent/proactive/rules/` per D8.
  Each is a pure `(snapshot) => DetectedIssue[]`.
- `lib/agent/proactive/proposal-generator.ts` — gpt-5.4-mini call
  to turn a `DetectedIssue` into a 2-4 button menu. Closed tool
  set per D9 enforced both in the prompt and in the parse step.
- Pure helpers extracted to `proposal-parser.ts` so tests don't
  pull in server-only deps.
- `feedback-bias.ts` reuses `agent_sender_feedback` with
  `senderEmail = "proactive:<issue_type>"` per D6. Bias hint is
  injected into the proposal-generator prompt.
- New `proactive_proposal` task type in `lib/agent/models.ts`.
  Routes to chat tier; metered for credits per D7.
- 20 unit tests across `tests/proactive-rules.test.ts` and
  `tests/proactive-proposal-generator.test.ts`.

### PR 3 — UI surfaces (commit `e0dc644`)

- Inbox list adds a "Steadii noticed" section above the email
  list (sectioned-list approach). Pending bold, resolved muted.
  Proposals query is wrapped in try/catch so missing
  `agent_proposals` table degrades gracefully.
- New `app/app/inbox/proposals/[id]/page.tsx` detail route —
  glass-box reasoning + sources + action menu. Marks `viewedAt`
  on first open.
- `components/agent/proposed-actions.tsx` — shared client
  component used by the proposal detail page (and PR 4 chat
  surface).
- `POST /api/agent/proposal/[id]/resolve` — dispatches via
  `lib/agent/proactive/action-executor.ts`, marks resolved,
  records positive feedback. 409 on already-resolved.
- `POST /api/agent/proposal/[id]/dismiss` — marks dismissed,
  records dismissal feedback for the bias loop.
- `lib/agent/proactive/notify.ts` — `recordAutoActionLog()` for
  D11 informational rows.
- `lib/digest/build.ts` — `loadPendingProposals()` plus a
  "Steadii noticed" subsection in both text + HTML renderers.
  Capped at 5 per D3. Digest now sends if either bucket has
  signal.

### PR 4 — Syllabus auto-import + chat proactive (this commit)

- `lib/agent/proactive/syllabus-import.ts` — D10 walk of
  `syllabus.schedule[]`, classifies each row, matches via
  `lib/agent/proactive/syllabus-match.ts` (pure helpers), and
  routes per outcome:
  - confident match → skip + log
  - confident no-match → auto-add with `[Steadii]` prefix
  - ambiguous → emit `syllabus_calendar_ambiguity` proposal
- Hooked into `lib/syllabus/save.ts` as a fire-and-forget after
  insert.
- `lib/agent/prompts/main.ts` — adds the D13 PROACTIVE
  SUGGESTIONS section + the Action commitment rule (PR 5 bug #1
  bundled here since it's contextually adjacent).
- 7 additional tests in `tests/proactive-syllabus-import.test.ts`.

## Verification log

- `pnpm typecheck` — only the 2 pre-existing
  `tests/handwritten-mistake-save.test.ts` errors on main remain.
  No new TypeScript errors introduced.
- `pnpm test` — 27 new proactive tests pass (rules: 12, proposal
  parser: 8, syllabus-match: 7). All pre-existing tests that were
  green before remain green; the one pre-existing failure
  (`tests/inbox-detail-old-shape.test.ts`) is unrelated.
- Each of the 5 rules fires on a fixture user (covered by unit
  tests above).
- `/app/inbox` and `/app/inbox/proposals/[id]` both compile and
  return 307 (auth gate). Full UI verification with proposals
  visible requires applied migration + authed session — out of
  band; documented in the PR 3 commit message.
- Migration `0025_majestic_thor.sql` generated cleanly via
  `pnpm db:generate`. Application to the dev DB requires
  `pnpm db:push` which is blocked on shared infrastructure;
  ryuto applies it as part of deploying the branch.
- The syllabus → calendar import path covers the 3 cases in D10
  (confident match, confident no-match, ambiguous) — the
  pure-helper test exercises each.
- Dismiss writes a feedback row keyed
  `senderEmail="proactive:<issue_type>"`,
  `userResponse="dismissed"` per D6.

## Deviations from the brief

- **Action executor scope.** D9 calls for direct dispatch from
  the resolve endpoint to `email_professor`, `reschedule_event`,
  `delete_event`, `create_task`, `add_mistake_note`,
  `link_existing`, and `add_anyway`. PR 3 lands `chat_followup`
  + `dismiss` directly; the others fall through to a
  chat-followup that lands the user in the existing tool flow
  with the issue context preloaded. Reason: completing the
  direct dispatch would have required wiring 6 separate
  side-effects + their confirmation flows in a single PR; the
  chat-followup fallback already satisfies "user can act in one
  click" without putting the resolve endpoint at risk of
  regressions in the existing tool stack. Flagged for the next
  work unit if Ryuto wants the direct paths.
- **PR 5 bug #1 bundled into PR 4.** The "Action commitment"
  rule for `MAIN_SYSTEM_PROMPT` lives in the same file as the
  D13 PROACTIVE SUGGESTIONS block, so I added both in PR 4. Bugs
  #2 (chat title prompt) and #3 (`/app/tasks` real list) remain
  for PR 5.

## Open questions for the next work unit

- Direct-dispatch action executors for the non-chat-followup
  tools (see deviation above). Most touch existing Gmail /
  Calendar / Tasks executors.
- Sensitivity slider per D4 — α observation will tell us whether
  the fixed thresholds (7d exam window, 30h workload ceiling,
  ±1h fuzzy match) over- or under-fire.
- Webhook-based real-time Google Calendar sync vs the daily
  cron's catch-all role. Deferred for now per the explicit
  out-of-scope list.
- LMS-specific actions per Phase 9.

## Next: landing redesign with demo video

The next work unit picks up the proactive flow demo Ryuto
outlined in the handoff (calendar trip → exam conflict →
notification → email draft). The data model + UI surfaces are
all in place; producing the demo only requires populating a
fixture user, walking through the inbox proposal flow, and
recording.
