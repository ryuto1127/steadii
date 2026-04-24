# Steadii Phase 6 W2 — L2 LLM + Embedding Cache + Risk-Based Deep Pass + Credit Bridge

## Context

You are the implementation engineer for Steadii. This is **W2 of Phase 6** (agent core). W1 shipped: Gmail OAuth, L1 rule-based triage, Inbox schema, first-24h ingest, Inbox sidebar, onboarding rewrite. W1 branch `phase6-w1` is merged (or imminently merged) into `main` before you start.

**W2 is the most scope-heavy week of Phase 6** — originally just "L2 LLM classify/draft + credit bridge", but during sparring on 2026-04-23 the original Phase 7 content (embedding cache + risk-based deep-pass context retrieval) was **merged into W2** so that α launches with the full glass-box agent instead of a shallow version. This prompt reflects the expanded scope. See `project_decisions.md` §"Phase 6/7 rescoping (2026-04-23)".

Phase 6 outline (for your map):
- W1 ✅ Gmail OAuth + L1 + Inbox schema + 24h ingest
- **W2 (this prompt)**: L2 (risk pass + deep pass) + embedding cache + retrieval + credit bridge + rounding fix + supervisor role
- W3: Confirm UX + 7am email digest + Settings → Agent Rules + "Why this draft" + "Thinking" UI
- W4: Staged autonomy + dogfood metrics + glass-box narrative in landing/onboarding

## Read before starting

Auto-memory (under `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/`):

- `MEMORY.md` — index
- `project_steadii.md` — product overview, phase state
- `project_agent_model.md` — authoritative agent design. **L2 design section is the primary spec for W2.**
- `project_decisions.md` — **read the 2026-04-23 entries** (Phase 6/7 rescoping, Tier capability rule, Glass-box brand). These are W2 constraints.
- `project_pre_launch_redesign.md` — UI constraints (inbox UI lands in W3, but schema you write in W2 must be W3-ready)
- `feedback_role_split.md` — you are the engineer; do not re-spar scope
- `feedback_prompts_in_english.md` — English prompts/code/commits

Repo docs:
- `docs/handoffs/phase6-prew1-scoping.md` — current repo state (as of pre-W1). Still the best map of existing code. Re-read §2.2 (existing agent scaffolding), §2.4 (credit enforcement state), §2.8 C4 / C6 / C7 (the locked-decision conflicts W2 resolves).
- `docs/handoffs/phase6-w1.md` — what W1 shipped. Especially the schema section (§Schema) — `inbox_items`, `agent_rules`, `agent_drafts` already exist; W2 adds columns + new tables, not a rewrite.
- `AGENTS.md` — test/commit/migration conventions
- `lib/agent/email/*` (W1 output) — the rule engine and ingest pipeline you build on

## Decision precedence — READ THIS CAREFULLY

Memory is authoritative. The **2026-04-23 rescoping entries in `project_decisions.md`** are the newest and take priority over any older statements. If an older memory or docstring conflicts with the 2026-04-23 entries, the new entries win.

Specifically:
- **No tier-gating of agent features.** Free / Student / Pro get identical classify + deep-pass + draft behavior. Differentiation is credit volume only. If you catch yourself writing `if (plan === 'pro') enableDeepPass`, stop and re-read.
- **Glass-box α**: retrieval must actually work and retrieval provenance must be persisted (for W3 UI). No placeholder "thinking" output.
- **Email-only retrieval in W2.** Syllabus / Mistakes / Classroom / Calendar retrieval is Phase 7 W1. Do not embed those sources in W2.

Locked-decision conflicts from the scoping doc addressed in W2:
- **C4** (confirmation model: binary → risk-tiered). W2 introduces `risk_tier` field population. Chat-side confirmation enum stays unchanged; email-side uses the new risk_tier on `inbox_items` + `agent_drafts`.
- **C6** (cap exhaustion: drafts pause, classify continues). W2 implements this. See §"Credit enforcement" below.
- **C7** (credit cost rounding: floor → round). W2 fixes `usdToCredits` so sub-1-credit tasks don't silently round to zero.

## Environment

- **Still test mode for Google.** Google Cloud Console stays in Testing. No verification/CASA work in W2.
- **OpenAI**: production API keys (already configured). `text-embedding-3-small` is the new model used in W2; verify your `.env` has `OPENAI_API_KEY` with embeddings access (should be implicit on the standard key).
- **pgvector extension** must be available on Neon. Neon supports it natively — enable via migration. Verify before writing long-running code.

## Scope of W2 (strictly)

**In scope:**

1. **pgvector extension** enabled via a fresh migration. Verify `CREATE EXTENSION IF NOT EXISTS vector` succeeds on Neon dev branch first.
2. **`email_embeddings` table** (schema in §Schema).
3. **`academic_embeddings` column addition — NO.** Defer to Phase 7 W1. W2 is email-only.
4. **Embedding helper `lib/agent/email/embeddings.ts`** — `embedText(text: string): Promise<number[]>` using OpenAI `text-embedding-3-small`. Record usage via existing `recordUsage()`.
5. **Embed-on-ingest hook** — modify `applyTriageResult` (or add a post-triage step) to embed subject+body of each stored `inbox_item` immediately after insert. Idempotent: if an embedding row already exists for this `inbox_item_id`, skip.
6. **Backfill script `scripts/embed-backfill.ts`** — iterates existing `inbox_items` without embeddings and embeds them. Run manually once post-deploy. Idempotent, resumable. Expected cost: <$1 for current α user count. Log total cost at end.
7. **Retrieval helper `lib/agent/email/retrieval.ts`** — `searchSimilarEmails(userId, queryText, topK): Promise<SimilarEmail[]>`. Cosine distance via pgvector. Returns `{ inboxItemId, similarity, subject, snippet, receivedAt, senderEmail }[]`.
8. **L2 risk pass `lib/agent/email/classify-risk.ts`** — GPT-5.4 Mini. Input: sender + subject + snippet + sender role (from `agent_rules`) + domain-first-time flag. Output JSON: `{ risk_tier: 'low'|'medium'|'high', confidence: 0..1, reasoning: string }`. Always called for inbox_items with `bucket === 'l2_pending'`.
9. **L2 deep classify `lib/agent/email/classify-deep.ts`** — GPT-5.4 Full. Called only when `risk_tier === 'high'`. Input: risk-pass output + top-20 retrieved similar emails + last 2 thread messages + user profile. Output JSON: `{ action: 'draft_reply'|'archive'|'snooze'|'no_op'|'ask_clarifying', reasoning: string, retrieval_used: {...} }`. Medium-risk stays with risk-pass output (shallower) to keep costs bounded while still providing "some reasoning".
10. **L2 draft generation `lib/agent/email/draft.ts`** — GPT-5.4 Full. Called when `action === 'draft_reply'` (from either deep or risk pass). Generates subject + body. Uses retrieved context for high-risk; last 2 thread messages only for medium-risk.
11. **L2 orchestrator `lib/agent/email/l2.ts`** — `processL2(inboxItemId)`: runs risk → (optional deep) → (optional draft) pipeline end-to-end. Persists `agent_drafts` row. Calls credit gate before each LLM step.
12. **L2 invocation trigger**: `processL2` is called from `applyTriageResult` for items with `bucket === 'l2_pending'` **synchronously on ingest** for now (W2 α volume is low). Queue-based processing is post-α.
13. **`agent_drafts.retrieval_provenance`** JSONB column added via migration. Stores `{ sources: [{ type: 'email', id: uuid, similarity: number, snippet: string }], total_candidates: number, returned: number }`.
14. **`agent_drafts.risk_pass_usage_id`, `agent_drafts.deep_pass_usage_id`, `agent_drafts.draft_usage_id`** — W1 schema had `classify_usage_id` + `draft_usage_id`. Rename/split: `classify_usage_id` → `deep_pass_usage_id`, add `risk_pass_usage_id`. Migration-level rename + new column. W1 wrote no rows, so a hard rename is safe.
15. **Credit enforcement hookup** — add `assertCreditsAvailable(userId)` callsites:
    - Before risk pass in `processL2`
    - Before deep pass
    - Before draft generation
    - In `lib/syllabus/extract.ts` and `lib/mistakes/save.ts` (the existing credit-metered features that were never gated — fix now, part of the C6 resolution)
    - On failure, throw `BillingQuotaExceededError`; caller in `processL2` catches and sets `agent_drafts.status = 'paused'` + records which step exhausted.
16. **Credit pause behavior (C6 fix)** — when `balance.exceeded`:
    - Risk pass continues (Mini is cheap; memory says "classify continues")
    - Deep pass skipped → draft skipped → `agent_drafts.status = 'paused'`
    - Insert an audit log entry tagging the pause
    - W3 will render "paused" state in UI; W2 only records state
17. **Rounding fix (C7)** — change `usdToCredits` in `lib/agent/models.ts` from `floor(usd * 200)` to `Math.round(usd * 200)`. Update any tests that asserted on floor behavior.
18. **TaskType finalization** in `lib/agent/models.ts`:
    - `email_classify_risk` → Mini
    - `email_classify_deep` → Full
    - `email_draft` → Full (already placeholder'd in W1; ensure actually wired)
    - `email_embed` → new Nano-cost type for embedding calls (actually use `text-embedding-3-small` pricing, not Nano — it's a separate model. Add a new tier `'embedding'` to the pricing table.)
    - Update `taskTypeMetersCredits` to include all four.
19. **Supervisor role fix** — in `lib/agent/email/rules.ts`, the L1 rule that checks `agent_rules.sender_role` should treat `'supervisor'` as AUTO_HIGH in addition to `'admin'`. `'professor'` / `'ta'` stay AUTO_MEDIUM. The UI role picker doesn't exist yet (W3 scope), so this is purely a mapping addition — future-proof. No new picker code in W2.
20. **Privacy policy doc** — add `docs/privacy-embedding-disclosure.md` (a draft doc, NOT the public policy page). Explain: embeddings of email subject+body are generated via OpenAI `text-embedding-3-small`, stored in Steadii's database as 1536-dim vectors, covered by the existing OpenAI DPA, no opt-out for α. The public-facing policy page update lands in W3/W4.
21. **Tests**:
    - `tests/email-embedding.test.ts` — embed known text twice, assert deterministic shape (1536 dims), record usage.
    - `tests/email-retrieval.test.ts` — insert 10 fixture embeddings with known semantic clusters, query for each cluster, assert top-3 returns match expected cluster.
    - `tests/l2-risk-pass.test.ts` — fixture Gmail message → risk pass → assert risk_tier.
    - `tests/l2-deep-pass.test.ts` — fixture high-risk item + fixture retrieval → deep pass → assert action + reasoning non-empty.
    - `tests/l2-orchestrator.test.ts` — end-to-end with mocked OpenAI client, assert persistence + usage event count + provenance shape.
    - `tests/credit-pause.test.ts` — mocked balance exhausted → L2 orchestrator → assert risk completed, deep+draft skipped, status='paused'.
    - `tests/credit-rounding.test.ts` — `usdToCredits(0.001)` = 0 (still rounds to 0, boundary), `usdToCredits(0.003)` = 1 (now 1, was 0 under floor).
22. **Sentry instrumentation** — wrap OpenAI embedding calls + retrieval SQL + each L2 step with `Sentry.startSpan`. Capture with user id tag.

**Explicitly out of scope for W2 — do not implement, do not stub:**

- **Multi-source retrieval** (Syllabus / Mistakes / Classroom / Calendar embeddings) → Phase 7 W1. Do not add `academic_embeddings` or similar tables.
- **Confirm UX / draft review page** → W3. The backend writes `agent_drafts` rows; W2 does not surface them in a UI.
- **"Why this draft" panel, "Thinking" summary bar rendering** → W3. W2 populates the data (`retrieval_provenance`, `reasoning`); W3 renders it.
- **7am email digest** → W3.
- **Settings → Agent Rules transparency UI** → W3.
- **First-time-sender role picker dialog** → W3. W2 adds `'supervisor'` to the *mapping logic* only.
- **20s undo window / `gmail_send` tool** → W3.
- **Pro+ tier anything** → Phase 7 W2. Do not add a `'pro_plus'` enum value or reserve one.
- **Queue-based async L2** → post-α. W2 runs L2 synchronously on ingest.
- **Embedding backfill for academic sources** → Phase 7 W1.
- **Medium-risk deep pass** → not in W2. Medium stays with risk-pass output. If α edit-rate data shows medium needs more depth, Phase 7 can widen.
- **Conversation memory for chat (using email_embeddings for chat context)** → post-α.
- **Any multi-language keyword expansion** → post-α.

## Concrete decisions handed over

Sparring side resolved these — do not re-litigate:

1. **Embedding model**: `text-embedding-3-small` (1536 dims, $0.02/1M tokens input). Do NOT use `text-embedding-3-large` — 5x cost for marginal α benefit.
2. **Vector store**: `pgvector` on existing Neon Postgres. NOT Pinecone / Qdrant / Weaviate. One DB, one billing surface.
3. **Similarity**: cosine distance (`vector_cosine_ops`).
4. **Index**: `ivfflat` with `lists = 100` for α (≤ ~10k rows). Build after data lands; low-volume is fine without index initially but add it in the migration regardless.
5. **top-K for deep-pass retrieval**: `20`. Hardcoded constant in `lib/agent/email/retrieval.ts`. Do not expose as user setting.
6. **Deep-pass trigger**: `risk_tier === 'high'` only in W2. Medium-risk uses risk-pass reasoning (shallower). Do NOT gate by tier.
7. **Embedding trigger**: every inbox_item gets embedded at ingest time, including `bucket === 'ignore'` rows. Small cost, keeps retrieval corpus complete for "what did we dismiss?" queries.
8. **Backfill strategy**: one-shot script, run manually by Ryuto post-deploy. Not a cron. Not a migration. Log the total embedding cost at end.
9. **Credit rounding fix**: `Math.round` not `Math.ceil` or `Math.floor`. Balanced behavior. Mid-point rounding (banker's) not needed at this scale.
10. **Cap behavior**: L2 draft pause is per-item, not global. When the gate denies deep/draft for an item, the next item is still attempted — if the user tops up between items, later items succeed.
11. **Sync vs async L2**: synchronous from ingest for W2. Ingest latency goes up by ~3-5 seconds per l2_pending item but α volume is 10-20 l2_pending items per user per 24h = acceptable. Post-α: queue.
12. **Retrieval corpus scope**: one user's own emails only. Cross-user retrieval is a hard privacy boundary. Enforce via `WHERE user_id = $1` on every retrieval query.
13. **Risk-pass prompt language**: English system prompt, input email content in its original language (EN or JA). Output JSON parsed; reasoning field kept in input language for user-facing transparency.
14. **Deep-pass retrieval includes the current email's own context**: the 20 retrieved similar emails exclude the in-progress `inbox_item_id` (no self-match). Plus the 2 immediate thread predecessors always included regardless of similarity.
15. **`agent_drafts.retrieval_provenance` JSONB schema** (frozen):
    ```ts
    {
      sources: Array<{
        type: 'email',
        id: string,           // inbox_items.id
        similarity: number,   // 0..1
        snippet: string       // <=200 chars
      }>,
      total_candidates: number,  // how many were in the user's corpus at query time
      returned: number           // length of sources array
    }
    ```
16. **Credit costs you'll see** (post-rounding fix, for your mental model):
    - Risk pass (Mini, ~1k in / 100 out): ~0.24 credits → rounds to 0 credits charged. Memory OK with this — "classify continues on exhaustion" semantics.
    - Deep pass (Full, ~5k in with retrieval / 800 out): ~4.9 credits → 5.
    - Draft (Full, ~3k in / 800 out): ~3.9 credits → 4.
    - Embedding (per email, ~500 tokens avg): ~$0.00001 = 0.002 credits → 0.
    - High-risk event end-to-end: 0 + 5 + 4 = ~9 credits.
    - Medium-risk event: 0 (risk) + 4 (draft only) = ~4 credits.
    - Student 1000 credits: ≈ 15 high-risk + 50 medium + unlimited low = ~135 + 200 = 335 credits agent-side, leaving ~650 for chat/mistakes/syllabus. ✓ (matches margin math in `project_decisions.md`)

## Schema (additions)

Edit `lib/db/schema.ts`, `pnpm db:generate`, name the migration `0014_*.sql`.

**1. Enable pgvector (separate migration, `0014_*`):**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Drizzle Kit may not generate this directly — you may need to hand-write this migration file alongside the generated one, or use `drizzle-kit generate --custom`. See Drizzle docs for extension enablement; if in doubt, write a `0014_enable_pgvector.sql` manually and `0015_*.sql` generated for table additions.

**2. `email_embeddings` table:**

Columns:
- `id` uuid PK
- `user_id` uuid FK → users ON DELETE CASCADE
- `inbox_item_id` uuid UNIQUE FK → inbox_items ON DELETE CASCADE
- `embedding` vector(1536) NOT NULL
- `model` text NOT NULL default `'text-embedding-3-small'`
- `token_count` integer NOT NULL (cost accounting)
- `created_at` timestamptz NOT NULL default now()

Indexes:
- `(user_id)` btree
- `(embedding) USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)`

Drizzle doesn't have first-class `vector` column type support out of the box — use `customType` (Drizzle provides this pattern) or the `pg-vector` Drizzle plugin if already a dep. If `pg-vector` isn't installed, the simplest path is `customType<{ data: number[]; driverData: string }>`.

**3. `agent_drafts` migration:**

- Add `retrieval_provenance` jsonb nullable
- Rename `classify_usage_id` → `deep_pass_usage_id` (W1 wrote no rows; safe rename)
- Add `risk_pass_usage_id` uuid nullable FK → usage_events ON DELETE SET NULL
- Add `paused_at_step` text nullable — `'risk' | 'deep' | 'draft'` — set when status transitions to 'paused'

Drizzle will generate the ALTER statements. Verify the generated SQL before apply.

**4. Types export:** ensure `EmailEmbedding`, `NewEmailEmbedding` are exported alongside existing Drizzle types.

## Implementation order

Roughly 1.5 weeks of focused work. Each step sized to approximately half a day.

1. **Enable pgvector extension** — write the manual migration. Run locally against a scratch Neon branch first to verify. *Depends on: nothing.*
2. **Add `email_embeddings` table + schema types + `agent_drafts` alterations.** Commit migration + type export. *Depends on: step 1.*
3. **`embedText` helper** in `lib/agent/email/embeddings.ts` — OpenAI client, error handling, usage recording. Unit test with mocked SDK. *Depends on: nothing (parallel with 1-2).*
4. **Embed-on-ingest hook** — modify `applyTriageResult` to call `embedText` + insert `email_embeddings` row. Idempotent check. Test. *Depends on: 2 + 3.*
5. **Backfill script `scripts/embed-backfill.ts`** — paginated scan of inbox_items without embeddings, embed each, insert, log. Graceful resume on crash (idempotent). *Depends on: 3 + 4.*
6. **Retrieval helper `searchSimilarEmails`** — raw SQL via Drizzle, `vector_cosine_ops`, parameterized user scope. Test with fixture embeddings. *Depends on: 2.*
7. **Risk pass `classify-risk.ts`** — prompt template, OpenAI Mini call, JSON parse, record usage, return `{risk_tier, confidence, reasoning}`. Test. *Depends on: nothing.*
8. **Deep classify `classify-deep.ts`** — prompt template with retrieved-context block, OpenAI Full call, JSON parse with action enum, record usage, return structured result. Test. *Depends on: 6 + 7.*
9. **Draft generation `draft.ts`** — prompt template, OpenAI Full call, returns `{subject, body, to, cc, inReplyTo}`. Test. *Depends on: nothing (can be written in parallel; wires into orchestrator later).*
10. **L2 orchestrator `l2.ts`** — sequences risk → (if high) deep → (if draft_reply) draft. Handles credit gate at each step. Persists `agent_drafts` with full provenance. Branch on paused state. Test end-to-end. *Depends on: 6-9.*
11. **Trigger L2 from ingest** — modify `applyTriageResult` (or a post-apply step) to call `processL2` synchronously for `bucket === 'l2_pending'` items. *Depends on: 10.*
12. **Credit gate hookup in existing non-email features** — `lib/syllabus/extract.ts`, `lib/mistakes/save.ts`. Add `await assertCreditsAvailable(userId)` before the LLM call, handle `BillingQuotaExceededError` to return a UI-friendly error. *Depends on: nothing.*
13. **Rounding fix** — `usdToCredits` floor → round. Update `tests/credit-*.test.ts` accordingly. `pnpm test` should stay green. *Depends on: nothing.*
14. **TaskType additions + pricing table for embedding tier** — `models.ts` changes. *Depends on: nothing.*
15. **Supervisor role mapping** — tiny change in `lib/agent/email/rules.ts`. *Depends on: nothing.*
16. **Sentry spans** — wrap each OpenAI call + retrieval SQL. Tag with user id, task type, inbox_item_id. *Depends on: 3, 6, 7, 8, 9.*
17. **Privacy disclosure doc** — `docs/privacy-embedding-disclosure.md`. Short, factual. *Depends on: nothing.*
18. **Full test suite green** — `pnpm typecheck && pnpm test && pnpm build`. Fix drift. *Depends on: everything.*
19. **Manual smoke on Ryuto's dev account** — after `pnpm db:migrate`, run `pnpm tsx scripts/embed-backfill.ts`, then trigger a fresh email manually or wait for one, verify full pipeline: ingest → embed → L1 → L2 risk (maybe deep) → draft row. Check `agent_drafts` in db:studio for populated provenance. *Depends on: 18.*
20. **Report**: branch name, PR URL, per-task-type usage_events counts, a sample `retrieval_provenance` from Ryuto's actual inbox (anonymized if needed).

## Test expectations

- Every LLM call must be mockable — inject a client or use `vi.mock('@/lib/integrations/openai')` patterns consistent with existing `tests/credit-gate.test.ts`.
- Fixture-based tests should use **fixed timestamps + deterministic embeddings** (mock `embedText` to return fixtures from `tests/fixtures/embeddings/`).
- Target: zero `it.todo`, zero skipped tests. If a test genuinely cannot be written, surface to Ryuto before marking W2 complete.
- Coverage target: every new file gets at least one happy-path + one error-path test.

## Commit strategy

Follow the W1 pattern (~10-13 commits). Suggested split:

1. `feat(db): enable pgvector extension`
2. `feat(db): add email_embeddings + expand agent_drafts`
3. `feat(agent): embedding helper + embed-on-ingest`
4. `feat(scripts): one-shot email embedding backfill`
5. `feat(agent): retrieval via cosine similarity`
6. `feat(agent): L2 risk pass (Mini)`
7. `feat(agent): L2 deep classify with retrieval (Full)`
8. `feat(agent): L2 draft generation`
9. `feat(agent): L2 orchestrator + sync ingest invocation`
10. `feat(billing): hook credit gate into L2 + syllabus + mistakes; drafts pause on cap`
11. `fix(billing): round(usd*200) instead of floor for sub-1-credit tasks`
12. `feat(agent): supervisor role → AUTO_HIGH`
13. `test(agent): L2 pipeline + retrieval + credit pause coverage`
14. `chore(observability): Sentry spans for OpenAI + retrieval`
15. `docs: draft privacy disclosure for embedding usage`

Each commit passes `pnpm typecheck && pnpm test` independently. Do not squash.

## Success criteria / deliverable

W2 is done when:

- [ ] `pnpm typecheck && pnpm test && pnpm build` all green
- [ ] `pnpm db:migrate` applies cleanly on a fresh Neon branch (Ryuto will run against staging separately)
- [ ] `pnpm tsx scripts/embed-backfill.ts` runs end-to-end on Ryuto's dev data without errors; total embedded count + total cost logged
- [ ] A fresh email landing in Ryuto's inbox flows: ingest → embed → L1 → L2 risk → (if high) deep → (if draft action) draft → `agent_drafts` row persisted with non-empty `retrieval_provenance`
- [ ] Credit exhaustion (simulated via a test override) correctly pauses draft generation while allowing risk-pass to complete
- [ ] Branch `phase6-w2` off `main`
- [ ] PR opened manually (`gh` still not installed; print URL) with: test counts, per-bucket L2 distribution, a sample `retrieval_provenance` payload, total embedding cost from backfill run
- [ ] Do NOT merge the PR yourself — Ryuto reviews

## If you get stuck

- **pgvector not available on the Neon plan / extension enable fails**: stop, surface to Ryuto. May need a plan change or branch-scoped enablement. Do not proceed with a JSON-array fallback (retrieval performance tanks).
- **Drizzle `vector` column typing issues**: the `customType` pattern is stable; don't try to PR Drizzle. If you can't get types clean in an hour, write the vector column as `text` in the schema (store as JSON array) and note the TODO in a code comment — flag for post-W2 cleanup.
- **OpenAI embedding cost unexpectedly high on backfill**: check token count per email — subject + body truncated to first 2000 chars is plenty. If costs exceed $5 across α user base, stop and re-investigate truncation.
- **L2 output not parseable as JSON**: use OpenAI's `response_format: { type: 'json_object' }` structured output mode. If even that fails consistently, reduce prompt complexity before falling back to regex parsing.
- **Retrieval returns irrelevant results even with good similarity scores**: investigate the embedding input text. Likely cause: you're embedding only the subject, not subject+body. Re-embed with richer input.
- **Credit pause test flakes**: mock the balance fetch, not the database. Tests that hit the balance SQL path are fragile.
- **Locked-decision conflict not listed in this prompt**: stop and surface to Ryuto in a 3-line summary + 2 options. Do not silently decide.

## Post-W2 follow-ups (do not do in W2, just flag in the PR description)

- `email_embeddings` rows will accumulate; a retention/prune policy aligned with the 120-day data retention grace period is needed by public launch. W4 or post-α.
- Retrieval quality metrics (precision@20 on user-rated retrievals) need a collection mechanism. Part of W4 dogfood.
- The `ivfflat` index's `lists` parameter needs re-tuning when per-user embedding counts exceed ~10k. Not relevant at α scale.
- Post-send regret loop (memory: rollback policy) requires agent_send_history which W3 introduces. W2 just notes that `agent_drafts.status='sent'` is the state machine's terminus for now.
