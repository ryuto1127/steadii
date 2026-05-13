# Engineer-48 — Quality trio: memory lifecycle + retrieval reranker + observability dashboard

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — risk-tiered confirmation model (touched by Part 3 dashboard)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — read before adding migration 0039
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — Ryuto's profile illustrates user-fact lifecycle (location → multi-year, academic → annual, schedule → semester-bound)

Reference shipped patterns:

- `lib/db/schema.ts` `userFacts` + `UserFactCategory` (engineer-47, PR #216) — Part 1 extends this with lifecycle columns.
- `lib/agent/tools/save-user-fact.ts` (engineer-47) — Part 1 extends this with TTL knowledge.
- `lib/agent/user-facts.ts` (engineer-47) — top-N injection helper. Part 1 extends to skip expired facts; Part 3's dashboard queries the same surface.
- `lib/agent/email/fanout.ts` — multi-source retrieval (similar emails + syllabus chunks + calendar + mistakes). Part 2's reranker wraps the email-source slice.
- `lib/agent/email/similar-sent-retrieval.ts`, `retrieval.ts`, `embeddings.ts` — current first-pass retrieval. Part 2 adds a second pass.
- `lib/agent/email/agentic-l2.ts` (engineer-41 + engineer-45 + engineer-47 edits) — agentic L2 pipeline; Part 2 plugs reranker between fanout and the LLM tool calls.
- `lib/agent/email/audit.ts` + `lib/db/schema.ts` `emailAuditLog` — what we have today for tracking. Part 3 aggregates these.
- `app/app/settings/how-your-agent-thinks/page.tsx` — closest existing "transparency surface" to model Part 3 against.
- `app/app/settings/page.tsx` — sidebar IA where Part 3 adds a link.

---

## Strategic context

After 2026-05-12 sparring research into AI-agent quality patterns (mem0 state-of-memory report, Carnegie Mellon AgentCompany benchmark, RAG reranker papers, human EA/CoS operating-pattern literature), three gaps surfaced in Steadii that can be closed at α with bounded scope:

1. **Memory governance** — engineer-47's `user_facts` is a flat list with no retention policy. mem0 best-practice: facts have different lifecycles (a location is years-stable, a semester schedule expires in 4 months, a communication style slow-decays from disuse). Without lifecycle, old facts stay in prompts forever or useful facts get crowded out.

2. **Retrieval precision** — Steadii's fanout collects up to 20 similar emails + syllabus chunks + calendar events into the L2 prompt. The first-pass cosine retrieval is wide; without a second-pass reranker, ~half the retrieved items aren't actually relevant to the current message, polluting the prompt and confusing the LLM. RAG-system literature consistently shows that a small reranker model gives a 20-40% precision lift for similar token budgets.

3. **Observability for the user** — Steadii logs every L2 / chat / tool call to `email_audit_log`, but the user can't see it. "Steadii did X but I don't know why" is a trust killer at α. Human-EA research: regular check-ins where the assistant explains what they did this week is core to the trust relationship. The dashboard is Steadii's version of that check-in.

All three are independently shippable; sequence them in this handoff for clean PR scope.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-48
```

---

## Part 1 — Memory lifecycle for user_facts

### Schema (migration 0039)

Add to `userFacts`:

```ts
expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),  // null = no expiry
nextReviewAt: timestamp("next_review_at", { withTimezone: true, mode: "date" }),  // when to prompt user to reconfirm
reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }),  // last time the user confirmed/edited
decayHalfLifeDays: integer("decay_half_life_days"),  // for communication_style etc.
```

### Default lifecycles per category

| Category | expiresAt | nextReviewAt | decayHalfLifeDays |
|---|---|---|---|
| `location_timezone` | NULL (multi-year) | createdAt + 365 days | NULL |
| `schedule` | createdAt + 120 days | createdAt + 100 days | NULL |
| `academic` | createdAt + 365 days | createdAt + 330 days | NULL |
| `communication_style` | NULL | NULL | 30 |
| `personal_pref` | NULL | createdAt + 180 days | NULL |
| `other` | NULL | createdAt + 180 days | NULL |

Tunable per-row by `save_user_fact` tool (new optional input fields).

### Updates

- `lib/agent/user-facts.ts` `getActiveUserFacts(userId)` — exclude rows where `deletedAt IS NOT NULL OR (expiresAt IS NOT NULL AND expiresAt < now())`
- `save_user_fact` tool — accept optional `expiresAt` / `decayHalfLifeDays` from the agent (it can infer from category if not given). On UPSERT, if a fact is re-saved, bump `reviewedAt = now()` and recompute `nextReviewAt` based on category.
- New cron `/api/cron/user-fact-review` — daily at 08:00 user-tz (or 08:00 UTC as α simplification). Queries `user_facts WHERE next_review_at <= now() AND deletedAt IS NULL`. For each, generates an `agent_proposals` row of type `user_fact_review` (Type F card surface) asking the user "これ、まだ合ってます？ → [Confirm] [Edit] [Delete]". Confirm = bump reviewedAt + recompute nextReviewAt. Edit = open inline editor. Delete = soft delete.
- Add `user_fact_review` to `AgentProposalIssueType` enum.

### Settings UI

- `/app/settings/facts` (engineer-47) — show `expiresAt` + `nextReviewAt` per row. Add a "次回再確認" indicator. Manual "再確認" button bumps reviewedAt.

### Tests

- Decay: a fact with `decayHalfLifeDays: 30` not touched for 60 days returns confidence × 0.25 from `getActiveUserFacts` (or is excluded — engineer's call, document it)
- Expiry: a fact with `expiresAt < now()` is excluded
- Re-save: bumps `reviewedAt`, recomputes `nextReviewAt`
- Cron: produces Type F proposals only for `next_review_at <= now()` facts

---

## Part 2 — Retrieval reranker

### New file `lib/agent/email/reranker.ts`

Mini-LLM-based reranker. Architecture:

```ts
type RerankerInput = {
  query: string;          // current email subject + snippet (or chat user query)
  candidates: Array<{
    id: string;
    text: string;         // candidate's textual representation
    sourceType: string;   // 'similar_email' | 'syllabus_chunk' | 'calendar_event' | etc.
  }>;
  topK: number;           // keep top K after reranking
};

type RerankerOutput = {
  ranked: Array<{
    id: string;
    score: number;        // 0..1
    reasoning: string;    // optional, for audit
  }>;
};

async function rerank(input: RerankerInput): Promise<RerankerOutput>;
```

Implementation:
- Use `email_classify_risk` model tier (mini, cheap) via `selectModel("rerank")`. Add `"rerank"` to the model registry in `lib/agent/models.ts`.
- One LLM call with structured output: list of `{ id, score }` for all candidates. Cap candidates at 30 to control token cost.
- Prompt: "Given the QUERY, score each candidate 0-1 on how directly relevant it is to answering / responding to that query. Score 0.5 means moderately useful, 0.9+ means highly relevant. Be strict — most candidates should be < 0.5."
- Return top `topK` sorted by score desc.
- Fail-soft: if the LLM call fails, return candidates unchanged with score `null`.

### Wire into fanout

`lib/agent/email/fanout.ts` — after the similar-emails source pulls its candidates (currently `searchSimilarEmails` returns top-K cosine), inject the reranker as a second pass before returning:

```ts
const cosineResults = await searchSimilarEmails(...);  // existing
const reranked = await rerank({
  query: buildEmbedInput(subject, snippet),
  candidates: cosineResults.results.map(r => ({ id: r.id, text: r.subjectAndSnippet, sourceType: 'similar_email' })),
  topK: 8,  // tighter than the cosine top-20 → less prompt noise
});
const finalSimilar = reranked.ranked.map(r => cosineResults.results.find(c => c.id === r.id)).filter(Boolean);
```

Apply the same pattern to `syllabusChunks` if cardinality is high enough to benefit (engineer's call after measuring; skip if cardinality < 5).

### Audit

`email_audit_log` entry per fanout phase: `action='retrieval_reranked'`, detail includes count before/after + dropped IDs + token cost.

### Tests

- Reranker returns top-K sorted
- Reranker fail-soft when LLM throws → returns input unchanged
- Reranker integration in fanout doesn't break existing fanout shape

---

## Part 3 — Observability dashboard

### New page `app/app/settings/activity-log/page.tsx`

Title: `Steadii のアクティビティログ` / `Steadii activity log`

Sections:

1. **Past 7 days summary** (top of page)
   - Email triaged: N
   - Drafts generated: N (M auto-sent, K dismissed)
   - Chat turns: N (M with tool calls)
   - Proactive proposals shown: N (M acted on)
   - Failures (Sentry-flagged): N — click to expand

2. **Recent activity** (paginated 20 per page)
   - Each row: timestamp, action type, resource link, optional reasoning, cost (tokens / credits)
   - Filter by action type, date range
   - Click row → expand to show full audit detail

3. **Failures** (separate tab)
   - Last 10 failed L2 / chat / tool calls
   - For each: timestamp, where (L2 / chat / tool name), error message, retry status

### Queries

All from `email_audit_log` + small joins to `agent_drafts`, `chat_messages`. Add 1-2 indices if performance suffers (measure first).

### Settings page sidebar link

Add `/app/settings/activity-log` link under the existing "How your agent thinks" section.

### Privacy

This is the user's own data. No cross-user surface. No external transmission.

### i18n keys

Under `settings.activity_log.*` — section titles, action-type labels, time-range filters.

### Tests

- Page renders for an empty audit log
- Past-7-days summary aggregates correctly
- Failures tab only shows result='failure' rows
- Cross-user access returns 403

---

## Out of scope (engineer-49+)

- Dynamic confirmation thresholds (engineer-49)
- Periodic check-in / boundary re-adjustment (engineer-49)
- CoS-mode monthly strategic digest (engineer-50)
- Cross-source relational reasoning / entity graph (engineer-51)

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new ones for each part
3. **Migration 0039** applied to prod (per `feedback_prod_migration_manual.md`)
4. **Live dogfood**:
   - Part 1: add a user_fact with category `schedule`, verify `nextReviewAt` is set ~100 days out. Manually backdate, trigger the cron, verify a Type F card appears.
   - Part 2: trigger an L2 run on a fresh email, verify the audit log shows `retrieval_reranked` with before/after counts. Check the rendered draft uses tighter context than pre-reranker baseline.
   - Part 3: open `/app/settings/activity-log`, verify the 7-day summary populates + recent activity paginates + failures tab filters correctly.

---

## Commit + PR

Branch: `engineer-48`. Push, sparring agent creates the PR.

Suggested PR title: `feat(quality): memory lifecycle + retrieval reranker + observability dashboard (engineer-48)`

---

## Deliverable checklist

- [ ] `lib/db/migrations/0039_*.sql` + journal entry (memory lifecycle columns + cron schedule if applicable)
- [ ] `lib/db/schema.ts` — userFacts extended; AgentProposalIssueType extended
- [ ] `lib/agent/user-facts.ts` — lifecycle-aware queries
- [ ] `lib/agent/tools/save-user-fact.ts` — accepts optional expiresAt / decayHalfLifeDays
- [ ] `app/api/cron/user-fact-review/route.ts` — new cron
- [ ] `app/app/settings/facts/page.tsx` — show lifecycle metadata
- [ ] `lib/agent/email/reranker.ts` — new file
- [ ] `lib/agent/email/fanout.ts` — wire reranker into similar-emails source
- [ ] `lib/agent/email/audit.ts` — `retrieval_reranked` action type
- [ ] `lib/agent/models.ts` — `"rerank"` task added to model registry
- [ ] `app/app/settings/activity-log/page.tsx` + supporting components
- [ ] `app/app/settings/page.tsx` — sidebar link
- [ ] `lib/i18n/translations/{ja,en}.ts` — new keys under `settings.activity_log.*` and `settings.user_facts.lifecycle.*`
- [ ] Tests per Verification section
- [ ] Live dogfood verified
