# Engineer-50 — CoS-mode monthly strategic digest

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md` — defines Steadii as secretary/chief-of-staff (this engineer is the "chief of staff" side of that label)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_wave_2_home_design.md` — weekly-digest pattern; CoS digest is the monthly cousin
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — read before any migration
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_qstash_orphan_schedules.md` — adds new schedule; canonical set bumps to 12

Reference shipped patterns:

- `app/api/cron/weekly-digest/route.ts` + `lib/agent/digest/*` (verify path) — current weekly-digest pipeline. Model the monthly version on this.
- `lib/agent/email/audit.ts` — `email_audit_log` rows aggregate cleanly per month
- `lib/db/schema.ts` — `agentDrafts`, `events`, `assignments`, `chatSessions`, `emailAuditLog`, `userFacts` (engineer-47) — data sources for the monthly synthesis
- `lib/agent/proactive/scanner.ts` + `rules/` — the digest emerges as a proactive proposal (Type C card linking to the digest page)
- `lib/agent/email/draft.ts` — the digest body is rendered via a structured-output LLM call analogous to a draft generator
- `app/app/activity/page.tsx` — closest existing "show me what happened" surface; the digest page extends this with strategic framing

---

## Strategic context

Per the 2026-05-12 agent-quality research, Steadii today operates at the EA level (tactical, daily/weekly: email triage, calendar adjust, draft suggest). The Chief-of-Staff layer (monthly/quarterly: pattern recognition, dot-connecting across the student's full life, surface "what you've been quietly drifting on") is missing. Engineer-50 adds it.

Specifically the CoS digest answers questions a tactical EA never would:

- "This month you replied to 47 emails but 9 were dismissed unread — is that bucket worth reviewing?"
- "Your 3 group-project meetings all slipped past their planned end times — pattern or coincidence?"
- "You said 'I'm overwhelmed' to chat 4 times this month. Earlier in the term it was zero. Worth a structural look?"
- "5 assignments touched this month, 2 done, 3 still in_progress. Compare to last month's velocity."
- "You haven't talked to Mei in 23 days; you used to ping her every ~5 days. Drifted?"

The digest renders monthly (first Sunday of each month after engineer-49's monthly tuning card has had a chance to fire), email-delivered + in-app, with explicit dot-connections grounded in retrievable evidence.

Differentiation note: this is what most "AI assistant" products (Reflect, Mem, Notion AI, etc.) do not do. They store + retrieve. They do not synthesize across the user's full activity at the strategic layer. CoS-mode is part of Steadii's α-launch differentiation pitch.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-50
```

---

## Part 1 — Monthly aggregation queries

New file: `lib/agent/digest/monthly-aggregation.ts`.

Pure-DB-query layer. Given `(userId, monthStart, monthEnd)`, returns a structured `MonthlyAggregate`:

```ts
type MonthlyAggregate = {
  emailActivity: {
    receivedCount: number;
    triagedHighCount: number;
    triagedMediumCount: number;
    triagedLowCount: number;
    draftsGenerated: number;
    draftsApproved: number;
    draftsDismissed: number;
    autoSentCount: number;
    avgResponseLatencyHours: number | null;     // for medium/high tier user-approved
    topSenders: Array<{ email: string; received: number; approved: number; dismissed: number }>; // top 5
  };
  calendarActivity: {
    eventsAttended: number;
    eventsMissed: number;
    averageDailyMeetingHours: number;
    classesAttended: number;
    classesMissed: number;
  };
  assignmentActivity: {
    completed: number;
    inProgressCarryover: number;       // started this month, still in_progress at month end
    notStartedCarryover: number;       // due-date this month, still not_started
    avgLeadTimeBetweenCreatedAndDone: number | null;
  };
  chatActivity: {
    sessionCount: number;
    messageCount: number;
    voiceSessionCount: number;
    toolCallCount: number;
    topToolsUsed: Array<{ name: string; count: number }>;
  };
  proactiveActivity: {
    proposalsShown: number;
    proposalsActedOn: number;
    proposalsDismissed: number;
    topRulesFired: Array<{ rule: string; count: number }>;
  };
  driftSignals: {
    overwhelmedMentions: number;              // chat messages containing "overwhelmed" / "辛い" / similar
    blockedMentions: number;                  // "stuck" / "詰まってる" / similar
    cancelledMeetingsCount: number;
    fadingContacts: Array<{ email: string; daysSinceLastTouch: number }>;
  };
  comparisons: {
    // Same shape as above but for prior month, for delta rendering.
    priorMonth?: Partial<MonthlyAggregate>;
  };
};
```

Pure SQL where possible; small LLM-free aggregation only.

Tests: `tests/monthly-aggregation.test.ts` — seed fixture user, verify each section against known fixture data.

### Drift signals

`overwhelmedMentions` / `blockedMentions` — regex over chat_messages content (ja: "辛い", "厳しい", "やばい", "詰まってる"; en: "overwhelmed", "stuck", "blocked", "swamped"). Approximation; LLM-based sentiment is overkill.

`fadingContacts` — query `sender_history` (or chat-recipient pairs); contacts the user pinged frequently early in the term but hasn't touched in N×stddev days now. Threshold heuristic only — don't over-engineer.

---

## Part 2 — LLM synthesis layer

New file: `lib/agent/digest/monthly-synthesis.ts`.

Given a `MonthlyAggregate`, produce a structured digest output via one GPT-5.4 call. Mini tier — this is per-month per-user, so cost is bounded; quality matters more than speed.

```ts
type MonthlySynthesis = {
  oneLineSummary: string;                     // <120 chars, ja-first
  themes: Array<{
    title: string;                            // "Group project velocity dropping"
    body: string;                             // 2-3 sentences, grounded in the aggregate
    evidence: Array<{
      kind: "email_thread" | "assignment" | "event" | "chat_session" | "proactive_proposal";
      id: string;
      label: string;
    }>;
  }>;
  recommendations: Array<{
    action: string;                           // "Block 3 hours for CS 348 PS4 this Saturday"
    why: string;                              // 1-line justification
    suggestedDate?: string;                   // ISO date if applicable
  }>;
  driftCallouts: Array<{
    callout: string;                          // "You haven't talked to Mei in 23 days"
    severity: "info" | "warn" | "high";
  }>;
};
```

Prompt design (in `lib/agent/digest/prompts/monthly-synthesis-prompt.ts`):

- Inject the entire `MonthlyAggregate` (it's small — maybe 2-3KB JSON)
- Inject the user's `userFacts` (engineer-47) so the synthesis knows the student's role / goals
- Inject the prior-month synthesis (`MonthlySynthesis`) so themes can carry / compare
- Strict instruction: every theme / callout cites at least 1 evidence row. No hallucinated patterns.
- Locale: respect user's locale; produce JA-primary if locale is ja.

Tests: `tests/monthly-synthesis.test.ts` — stub OpenAI client, verify prompt assembly + response parse.

---

## Part 3 — Persistence + access surface

### Schema (migration 0041)

```ts
export const monthlyDigests = pgTable(
  "monthly_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    monthStart: timestamp("month_start", { withTimezone: true, mode: "date" }).notNull(), // first day of covered month, user's local TZ at 00:00
    aggregate: jsonb("aggregate").$type<MonthlyAggregate>().notNull(),
    synthesis: jsonb("synthesis").$type<MonthlySynthesis>().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),                   // when email was dispatched
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),                   // user opened the in-app page

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    userMonthIdx: uniqueIndex("monthly_digests_user_month_idx")
      .on(t.userId, t.monthStart),
  })
);
```

Migration 0041 + journal entry.

### Cron `/api/cron/monthly-digest`

New route. Fires daily at 09:00 UTC; only does work for users whose local-tz first-Sunday-of-month is today.

For each eligible user:
1. Compute month boundaries in user's TZ
2. Check if `monthly_digests` row exists for that month — skip if so
3. Run `monthly-aggregation` → `monthly-synthesis`
4. INSERT row
5. Dispatch email via Resend (subject: "Steadii からの月次レビュー", body: rendered HTML version of the synthesis)
6. Generate a Type C card pointing to `/app/digests/monthly/{id}` so the in-app surface is also visible

Add `'monthly_digest'` to `AgentProposalIssueType` enum.

QStash schedule: `0 9 * * *` daily (the route's per-user logic filters down to first-Sunday-of-month-for-this-user). Canonical schedule set bumps from 11 → 12 — update `feedback_qstash_orphan_schedules.md` after merge.

### In-app surface

New page `app/app/digests/monthly/[id]/page.tsx`. Renders the synthesis sections with the evidence cited as in-app links (email thread → /app/inbox/{id}, assignment → /app/tasks/{id}, etc.).

Sidebar link from `/app/settings` (or `/app/activity` — engineer's pick) pointing to `/app/digests/monthly` (index page listing prior months).

i18n keys under `digest.monthly.*` for the synthesis section headings + email subject + email body templates (handlebars-style with named slots).

### Email template

`lib/email/monthly-digest-template.ts` — HTML email built from the synthesis. Lean Mailpit-style: minimal CSS, accessible, readable on mobile. Reuse existing email template infra if any (verify; check `lib/email/`).

---

## Out of scope (engineer-51+)

- **Cross-source relational reasoning** (engineer-51) — entity-graph extraction. The digest's evidence links are surface-level here ("this assignment, that email"). Engineer-51 deepens to "this email mentions this project that depends on this assignment".
- **Quarterly / yearly digest** — same pattern with longer windows. Engineer-52 candidate after monthly sees usage.
- **Custom-cadence digest** ("send me a weekly mini-CoS") — preference setting deferred.
- **Multi-recipient digest** (advisor sees student's CoS digest) — multi-tenant; α is solo.
- **In-app theme tuning** — user adjusting which themes the synthesis emphasizes. Deferred; let usage shape demand.

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new ones
3. **Migration 0041** applied via `pnpm tsx scripts/migrate-prod.ts`
4. **QStash schedule** `/api/cron/monthly-digest` daily at `0 9 * * *` — Ryuto adds in Upstash console post-merge
5. **Live dogfood**:
   - Backdate a test: run the cron handler manually for Ryuto's user with `monthStart = 2026-04-01`, verify aggregate populates, synthesis returns sensible output, row inserted, email sent (Mailpit / Resend test), card appears in queue with link to the digest page
   - Verify digest page renders + evidence links navigate correctly
   - 2nd run for same month → skipped (idempotent)

---

## Commit + PR

Branch: `engineer-50`. Push, sparring agent creates the PR.

Suggested PR title: `feat(digest): CoS-mode monthly strategic digest — aggregation + LLM synthesis + email delivery (engineer-50)`

---

## Deliverable checklist

- [ ] `lib/db/schema.ts` — monthly_digests table
- [ ] `lib/db/migrations/0041_*.sql` + journal entry
- [ ] `lib/agent/digest/monthly-aggregation.ts` — pure-DB aggregation
- [ ] `lib/agent/digest/monthly-synthesis.ts` — LLM synthesis layer
- [ ] `lib/agent/digest/prompts/monthly-synthesis-prompt.ts` — prompt assembly
- [ ] `app/api/cron/monthly-digest/route.ts` — new cron route
- [ ] `lib/email/monthly-digest-template.ts` — HTML email
- [ ] `app/app/digests/monthly/[id]/page.tsx` + index page
- [ ] Type C card surface — `'monthly_digest'` added to AgentProposalIssueType
- [ ] `lib/i18n/translations/{ja,en}.ts` — new keys under `digest.monthly.*`
- [ ] Tests per Verification section
- [ ] Live dogfood verified
