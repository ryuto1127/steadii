# Phase 7 W1 Scoping — Multi-source retrieval fanout

Read-only investigation pass. No application code or schema was changed
by this pass. References below are to the working-tree files on
`phase7-prew-cleanup` (head `012d484`, the cleanup tip of the
Notion → Postgres migration stack — PRs [#33](https://github.com/ryuto1127/steadii/pull/33)
+ [#34](https://github.com/ryuto1127/steadii/pull/34) — not yet merged
to main at the time of this pass).

The premise is the Architecture revision dated 2026-04-25 in
`memory/project_decisions.md`: **Postgres-canonical for all 4 academic
entities, Postgres-native fanout at L2 classify + draft time**, plus
the Phase 7 W1 brief in this scoping pass's input:

- Fanout sources for α: **Syllabus + Mistakes + Calendar**. Classroom
  is excluded (no JP-LMS market fit; per the Market scope revision
  2026-04-25 LMS work is gated on observed α user demand).
- **Both classify and draft fanout fully** — Mini latency / token cost
  is non-issue at α scale; no presence-only-at-classify design.
- Retrieval mechanism = **hybrid**: structured-by-class-id first,
  vector similarity fallback when class binding is unknown.
- α target = **JP university students**; binding heuristics must work
  with kanji course names and 〇〇先生 sender patterns alongside Latin
  course codes (CSC108, MAT135).

---

## 1. Executive summary

- **Fanout = a new context-assembly stage that runs between the L1
  bucket decision and the L2 prompt sends.** It pulls
  per-class-relevant Mistakes, Syllabus chunks, and upcoming Calendar
  events into the classify/draft prompts so the agent can ground its
  reasoning in the user's own academic state instead of the email body
  alone. Today the L2 pipeline retrieves only similar past *emails*
  (cosine over `email_embeddings`) and an opportunistic 7-day Calendar
  slice in the *draft* step ([lib/agent/email/l2.ts:198-292](lib/agent/email/l2.ts:198)).
  W1 generalizes that to a 4-source fanout (Mistakes / Syllabus / Past
  emails / Calendar) and slots it into both classify and draft.

- **The schema is in place; the writers are wired; the readers don't
  exist yet.** The cleanup branch ships `mistake_note_chunks` +
  `syllabus_chunks` ([lib/db/schema.ts:1181-1241](lib/db/schema.ts:1181)),
  with `refreshMistakeEmbeddings` / `refreshSyllabusEmbeddings`
  populating them on every save and on Notion → Postgres import
  ([lib/embeddings/entity-embed.ts:16-72](lib/embeddings/entity-embed.ts:16),
  [lib/mistakes/save.ts:126](lib/mistakes/save.ts:126),
  [lib/syllabus/save.ts:73](lib/syllabus/save.ts:73),
  [lib/integrations/notion/import-to-postgres.ts:285](lib/integrations/notion/import-to-postgres.ts:285)).
  No code reads from these tables — that's the W1 implementation surface.

- **A class binding sub-step is the new keystone.** Today
  `inbox_items` has no `class_id` column and no resolver. Hybrid
  retrieval is meaningless without one: the structured branch *is*
  "WHERE class_id = ?". Recommend a standalone module
  (`lib/agent/email/class-binding.ts`) that runs once per inbox item at
  ingest time, caches `(inbox_item_id, class_id, confidence, method)`
  on the inbox row, and is consulted by the fanout retrievers later.
  See §3.

- **The L2 classify path has zero token-budget pressure today; draft
  has some.** Current classify (`runRiskPass`) sends ~2 KB of envelope
  + snippet ([lib/agent/email/classify-risk.ts:110-123](lib/agent/email/classify-risk.ts:110)),
  ~500 tokens — Mini's context ceiling is 200k. Adding ~1500 tokens of
  fanout context (3 mistakes + 3 syllabus chunks + ≤8 calendar events,
  truncated) takes classify to ~2k tokens of prompt — still pocket
  change at $0.75/$4.50 per 1M tokens. The draft step already runs
  larger (3 KB envelope + up to 5 similar emails + up to 25 calendar
  events) — adding 2-3 KB of mistakes/syllabus puts it at ~4-5k input
  tokens, well under GPT-5.4's window. Cost section §7 confirms.

- **Glass-box obligation expands too.** Today reasoning is a single
  text blob ([components/agent/reasoning-panel.tsx:9-55](components/agent/reasoning-panel.tsx:9))
  + a thinking bar that lists similar-email pills with similarity %
  ([components/agent/thinking-bar.tsx:8-67](components/agent/thinking-bar.tsx:8)).
  After W1 the prompt instructs the model to cite which fanout source
  informed each conclusion (mistake X, syllabus chunk Y, calendar event
  Z). The `RetrievalProvenance` JSONB blob
  ([lib/db/schema.ts:720-729](lib/db/schema.ts:720)) is currently
  email-only (`type: "email"`); W1 needs to widen the discriminated
  union to `email | mistake | syllabus | calendar` and the
  thinking-bar UI needs source-typed pills (different colour /
  icon per source). Settings → "How your agent thinks" (a Phase 6 W4
  landing-copy promise) does **not yet exist** as a route — the
  current Settings page surfaces Agent Rules + Notifications +
  Staged-Autonomy, not a per-decision reasoning surface
  ([app/app/settings/page.tsx:278-333](app/app/settings/page.tsx:278)).
  W1 is the right time to land it.

- **Conflicts with the locked decisions: none found.** Schema, writers,
  and the Calendar-in-draft slot all match what the brief assumes. The
  only nuance: the existing email-similar retrieval at deep-pass time
  uses K=20 with a synchronous embed call per inbound email
  ([lib/agent/email/retrieval.ts:25-118](lib/agent/email/retrieval.ts:25));
  the W1 fanout *reuses the same query embedding* across all four
  sources to keep embed cost flat. Don't issue a fresh embed per source.

---

## 2. Inventory of current L2 pipeline

### 2.1 Where classify is invoked

The L2 entry point is `processL2(inboxItemId, options)` at
[lib/agent/email/l2.ts:68-83](lib/agent/email/l2.ts:68). It is called
synchronously from `ingestLast24h` for every freshly-created inbox
item whose bucket is `l2_pending`, `auto_high`, or `auto_medium`
([lib/agent/email/ingest-recent.ts:118-138](lib/agent/email/ingest-recent.ts:118)).
There is no async queue today — α volume (≤20 items per user per day)
is small enough that one in-process pass per ingest is fine, and the
ingest itself is fired from `maybeTriggerAutoIngest` on a 24h cool-off
([lib/agent/email/auto-ingest.ts:21-59](lib/agent/email/auto-ingest.ts:21))
plus the QStash-driven `/api/cron/digest` 30-minute sweep.

The pipeline is three steps gated by tier:

1. **Risk pass** (`runRiskPass`,
   [lib/agent/email/classify-risk.ts:59-108](lib/agent/email/classify-risk.ts:59))
   — Mini, always runs unless `forceTier` is set. AUTO_HIGH and
   AUTO_MEDIUM L1 paths bypass it via `synthesizeForcedHighRisk` /
   `synthesizeForcedMediumRisk`
   ([lib/agent/email/l2.ts:485-527](lib/agent/email/l2.ts:485)) so the
   L1 strict-bucket decision is preserved, with the firing
   `RuleProvenance` carried forward as the synthesized reasoning.
   Output: `{risk_tier, confidence, reasoning}`.

2. **Deep pass** (`runDeepPass`,
   [lib/agent/email/classify-deep.ts:68-125](lib/agent/email/classify-deep.ts:68))
   — GPT-5.4 Full, **only for high-risk**. Adds the `searchSimilarEmails`
   top-20 retrieval ([lib/agent/email/l2.ts:198-220](lib/agent/email/l2.ts:198)),
   uses cosine over `email_embeddings`. Output: `{action, reasoning,
   retrievalProvenance}` where action ∈ {draft_reply | archive |
   snooze | no_op | ask_clarifying}.

3. **Draft** (`runDraft`,
   [lib/agent/email/draft.ts:108-166](lib/agent/email/draft.ts:108)) —
   GPT-5.4 Full, only when the decided action is `draft_reply`.
   Reuses the deep-pass retrieval slate when called from the high-risk
   branch; for medium-risk it issues a smaller K=5 retrieval inline
   ([lib/agent/email/l2.ts:254-278](lib/agent/email/l2.ts:254)). Also
   pulls 7 days of upcoming calendar via `fetchUpcomingEvents`
   ([lib/agent/email/l2.ts:280-292](lib/agent/email/l2.ts:280)). Output:
   `{kind, subject, body, to, cc, inReplyTo, reasoning}` where kind
   ∈ {draft | clarify} — the model can self-escalate to clarify when
   it spots ambiguity.

Credit gate behavior (preserved): risk pass is never gated (Mini cost
rounds to 0); deep-pass and draft are each gated by
`assertCreditsAvailable` and persist a `paused` row on
`BillingQuotaExceededError`
([lib/agent/email/l2.ts:182-252](lib/agent/email/l2.ts:182),
[persistPaused](lib/agent/email/l2.ts:422)).

### 2.2 What context is currently assembled for each step

**Risk pass** (`buildUserContent` at [lib/agent/email/classify-risk.ts:110-123](lib/agent/email/classify-risk.ts:110)):

```
Sender: <email>
Sender domain: <domain>
Sender role (learned): <role>?              # learnedSenders / learnedDomains
First-time sender: ...                      # firstTimeSender flag
Subject: <subject>
Snippet: <snippet, sliced 1500 chars>
```

No retrieval. No class context. ~400-600 tokens of envelope.

**Deep pass** (`buildUserContent` at [lib/agent/email/classify-deep.ts:155-192](lib/agent/email/classify-deep.ts:155)):

```
=== Current email ===
From / role / subject / body (sliced 2000 chars)

=== Risk-pass output ===
Tier + confidence + reasoning

=== Last messages in thread (oldest first) ===  # up to 2
- From <sender>: <snippet, sliced 400>...

=== Retrieved similar emails (top N of M) ===   # up to 20 from email_embeddings
1. [sim=0.87] <sender> — <subject> — <snippet, sliced 160>...
```

Similar-email retrieval is the *only* fanout today.

**Draft** (`buildUserContent` at [lib/agent/email/draft.ts:212-269](lib/agent/email/draft.ts:212)):

```
=== Email you're replying to ===
From / role / subject / body (sliced 2500 chars) / In-Reply-To?

=== Prior thread messages (oldest first) ===    # up to 2
- From <sender>: <snippet, sliced 500>...

=== Reference: similar past emails ... (N) ===  # 5 medium-risk, ≤20 high-risk
1. [sim=0.87] <sender> — <subject> — <snippet, sliced 180>...

=== Calendar (next 7 days) ===                  # W3.6 — see §2.3
1. <start> → <end> :: <title>[ @ <location>]    # always present even when empty

=== Student ===
Email / Name
```

### 2.3 W3.6 calendar integration shape

Already shipped (commit `0aeece5`, per the brief). The draft step
opportunistically pulls 7 days of upcoming events via
`fetchUpcomingEvents(userId, { days: 7 })`
([lib/integrations/google/calendar.ts:78-109](lib/integrations/google/calendar.ts:78))
and wraps the call in a try/catch that swallows
`CalendarNotConnectedError` to an empty list
([lib/agent/email/l2.ts:284-292](lib/agent/email/l2.ts:284)). The
prompt's calendar block is **always rendered** — empty when calendar
isn't connected — so the model knows whether to fall back to
ask-on-availability vs. confidently commit
([lib/agent/email/draft.ts:249-260](lib/agent/email/draft.ts:249)).

The system prompt explicitly instructs calendar grounding:

> Calendar grounding (when the "Calendar" block is non-empty below):
> - If the sender proposes a specific time AND that time has no
>   conflicting event, draft an acceptance — don't ask back…
> - "Free this week?" / open-ended availability questions: kind="draft"
>   suggesting one or two specific free slots from the calendar, not
>   "let me check and get back."
> - If calendar is empty (user hasn't connected it OR genuinely has
>   nothing), fall back to clarify on availability questions as before.

([lib/agent/email/draft.ts:71-76](lib/agent/email/draft.ts:71)).

**For W1, calendar fanout = "expand the existing draft-side block to also
appear in classify, scoped narrower (next 24-72h, not 7 days)."** No
fetch-shape changes needed; just call `fetchUpcomingEvents` from the
classify step too (or once at fanout time and pass to both). Per the
brief's "both classify and draft fanout fully" decision, classify
benefits because risk-tier decisions hinge on whether a meeting is
actually on the user's calendar (e.g. an "interview confirmation"
email is materially less risky if the calendar already has the slot
booked — known sender, known meeting, low risk; vs. an interview
*proposal* that needs confirmation, which is the standard
HIGH-risk-internship-offer path).

### 2.4 Embedding cache surface

**What's already cached / persisted:**

- `email_embeddings` ([lib/db/schema.ts:815-841](lib/db/schema.ts:815))
  — one row per inbox item, populated synchronously at ingest by
  `embedAndStoreInboxItem`
  ([lib/agent/email/embeddings.ts:72-108](lib/agent/email/embeddings.ts:72)),
  with a unique constraint on `inbox_item_id` to keep re-ingest a
  no-op.
- `mistake_note_chunks` ([lib/db/schema.ts:1181-1210](lib/db/schema.ts:1181))
  — populated by `refreshMistakeEmbeddings` on every mistake save and
  on Notion → Postgres import; uses a delete-then-insert
  transaction-shaped pattern so chunk identity is positional and stale
  chunks don't linger across body edits.
- `syllabus_chunks` ([lib/db/schema.ts:1212-1241](lib/db/schema.ts:1212))
  — symmetric to mistakes; populated by `refreshSyllabusEmbeddings`
  on every syllabus save.
- All three tables use `vector(1536)` with the
  `text-embedding-3-small` model — same model, same dimension, so a
  single query embedding can cosine-search any of the three tables in
  one expression.

**What is NOT cached:**

- The L2 risk-pass embeddings the orchestrator currently builds via
  `buildEmbedInput(item.subject, item.snippet)`
  ([lib/agent/email/l2.ts:198-206](lib/agent/email/l2.ts:198)) +
  `embedText` ([lib/agent/email/embeddings.ts:34-67](lib/agent/email/embeddings.ts:34))
  are issued **fresh each L2 call** for the *query* side. The corpus
  side (the row being embedded into `email_embeddings`) IS cached;
  the per-call query embed is not. Since the inbox row's body doesn't
  change between ingest-time corpus embed and L2-time query embed, the
  query embed is logically redundant.
- **Recommendation for W1: reuse the row's `email_embeddings.embedding`
  as the fanout query vector instead of issuing a fresh embed.** Saves
  one embed API call per L2 invocation (~$0.00001, but more importantly
  a round-trip and a token of usage) and guarantees query/corpus
  similarity is symmetric. There is no reason to re-embed. Cache miss
  fallback: only re-embed when the row's embedding row hasn't yet
  been written (race between ingest and processL2 in the synchronous
  path is not currently possible — `triageMessage`'s synchronous
  embed-on-ingest at [triage.ts:92-111](lib/agent/email/triage.ts:92)
  always runs *before* `processL2` — but the fanout caller should
  guard with a fresh `embedText` if the row is missing).

### 2.5 Provenance / glass-box surfaces today

- **`RuleProvenance[]`** ([schema.ts:553-557](lib/db/schema.ts:553))
  — L1-side "which keyword/learned rule fired"; persisted on
  `inbox_items.rule_provenance` ([schema.ts:596](lib/db/schema.ts:596));
  populated by `classifyEmail` ([rules.ts](lib/agent/email/rules.ts));
  consumed by the `synthesize*Risk` helpers and by the Settings →
  Agent Rules transparency surface ([components/settings/agent-rules.tsx](components/settings/agent-rules.tsx)).

- **`RetrievalProvenance`** ([schema.ts:720-729](lib/db/schema.ts:720))
  — L2-side "which similar emails grounded the deep-pass decision";
  persisted on `agent_drafts.retrieval_provenance`
  ([schema.ts:764](lib/db/schema.ts:764)); populated by
  `buildProvenance` ([classify-deep.ts:194-207](lib/agent/email/classify-deep.ts:194));
  consumed by `<ThinkingBar />`
  ([components/agent/thinking-bar.tsx:8-67](components/agent/thinking-bar.tsx:8))
  to render the "X of Y emails surfaced" strip and up to 3 source
  pills with similarity %.

- **`agent_drafts.reasoning`** — free-text from the model, pinned to
  English regardless of the email's language ("internal transparency
  string surfaced in a debug panel, not user-facing prose" per the
  draft system prompt at [draft.ts:81-83](lib/agent/email/draft.ts:81)).
  Rendered by `<ReasoningPanel />`
  ([components/agent/reasoning-panel.tsx:9-55](components/agent/reasoning-panel.tsx:9))
  as a "Why this draft" panel below the thinking bar
  ([app/app/inbox/[id]/page.tsx:166-197](app/app/inbox/[id]/page.tsx:166)).
  When the model used bullet markers the panel renders a list;
  otherwise paragraph + collapse-at-400-chars.

- **`audit_log` action enum** — `EmailAuditAction` at
  [audit.ts:7-19](lib/agent/email/audit.ts:7) covers the L2 lifecycle
  (started / completed / paused / failed / embed_failed) but writes a
  fixed `resourceType: "email_inbox"` regardless of which step. Open
  question #7 from the migration report (audit_log.resourceType
  taxonomy) intersects W1: the per-source fanout will want to log
  fanout decisions (cache hit / cache miss / class-binding method /
  retrieval k) and a structured `resourceType` per source would let
  post-hoc analysis filter cleanly. See §12.6.

### 2.6 What is NOT instrumented today

- No metric for "did fanout return relevant context?" — there isn't
  fanout yet. W1 must seed eval logging from day 1; see §10.
- No metric for "did the model actually cite the fanout source?"
  Today's reasoning string is free-text and a citation requirement
  is enforced only by the deep-pass system prompt
  ([classify-deep.ts:53](lib/agent/email/classify-deep.ts:53)) —
  there's no programmatic check that the citation exists.
- The `auto_sent` flag at [schema.ts:789](lib/db/schema.ts:789) marks
  which drafts went out via W4.3 staged autonomy without a human
  click. It's the most useful eval lever post-α: per-source counterfactual
  ("did the auto-sent drafts have higher / lower edit rate when
  fanout context was non-empty?"). Wire fanout-result metrics to it
  in §10.

---

## 3. Class binding sub-step design

This is the single biggest net-new piece. Without a `class_id` on the
inbox row, the structured branch of hybrid retrieval has nothing to
join against and the fanout collapses to "vector similarity over
everything," which is what the brief explicitly rejected.

### 3.1 Sources of class identity for an inbound email

Ranked by precision (highest first):

1. **Course code in subject — regex match against `classes.code`.**
   `WHERE upper(?subject?) LIKE '%' || upper(classes.code) || '%'`.
   Latin-script codes ("CSC108", "MAT244", "PHL235H1") are clean
   regex anchors. The current schema field is `classes.code TEXT`
   ([schema.ts:934](lib/db/schema.ts:934)), free-form. Precision: ~95%
   when a code is present; the false-positive risk is only when a
   different class's name happens to contain the code as a substring.
   Mitigate by anchoring on word boundaries (`\b<code>\b` —
   case-insensitive).

2. **Sender domain → registered prof/TA → class lookup.** If
   `inbox_items.sender_role` is `"professor"` or `"ta"` (set by the
   L1 learned-domain map at [rules.ts:35-38](lib/agent/email/rules.ts:35)),
   there is a high prior that this email belongs to a class taught by
   that prof. The link is currently *unmodelled* —
   `classes.professor` is a free-text TEXT field
   ([schema.ts:936](lib/db/schema.ts:936)) with no structured
   prof→class join. v1 can do a fuzzy match: `WHERE
   classes.professor ILIKE '%' || sender_name || '%' OR
   classes.professor ILIKE '%' || sender_email_local || '%'`. Precision
   varies; this signal is best treated as a *boost* (multiplicative
   prior) on the top vector candidates rather than a hard filter.

3. **Body-content vector similarity to syllabus / class chunks.** Take
   the email's existing `email_embeddings.embedding` and find the
   `class_id` of the top-N most-similar `syllabus_chunks` /
   `mistake_note_chunks` rows. If a single `class_id` dominates the
   top-K (e.g., 3+ of top-5 chunks point to the same class), that's
   the binding. Recall is high; precision drops when classes are
   topically similar (e.g., two math classes).

4. **Calendar-event proximity** — "the user has a CSC108 class in 2
   hours, this email is from a stranger asking about an assignment due
   tomorrow." Look up `events` (Google Calendar mirror) and
   `assignments.due_at` for windows around the email's `received_at`;
   if a class's session or a class's assignment is within ±48h, weight
   that class. Cheap to add later; not a v1 hard requirement.

5. **JP-specific signals:**
   - **Kanji course names in subject.** JP courses often have full
     kanji names ("線形代数学", "情報科学概論"). The existing
     `classes.code` field works as a regex anchor for these too — the
     match is case-insensitive substring, kanji are 1 grapheme each,
     no Unicode normalization is needed beyond NFC (Postgres handles
     this).
   - **〇〇先生 honorific in body.** A pattern like
     `/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]{1,5})先生/u`
     can extract the professor's family name; cross-reference against
     `classes.professor` (which often contains the kanji name).
     Precision is high when the user's profs are populated into
     classes.professor in kanji.
   - **JP universities frequently encode course codes differently** —
     e.g., UTAS uses 8-digit numeric codes ("21130200") that wouldn't
     match an English regex but *would* match the same word-boundary
     anchor since they're surrounded by separators in the subject.
     Same regex, no special-casing.

### 3.2 Recommended structure: standalone module

**`lib/agent/email/class-binding.ts`** (new) — pure function:

```ts
export type ClassBindingMethod =
  | "subject_code"          // exact code match in subject (regex)
  | "subject_name"          // class name substring in subject
  | "sender_professor"      // prof/TA learned + classes.professor match
  | "vector_chunks"         // cosine majority over syllabus/mistake chunks
  | "calendar_proximity"    // class session / assignment within ±48h
  | "ja_sensei_pattern"     // 〇〇先生 → classes.professor
  | "none";                 // unbound

export type ClassBindingResult = {
  classId: string | null;
  confidence: number;       // 0..1
  method: ClassBindingMethod;
  // Multiple methods can agree; we record the dominant one in `method`
  // and the runners-up in `alternates` for the glass-box pill.
  alternates: Array<{ classId: string; confidence: number; method: ClassBindingMethod }>;
};

export async function bindEmailToClass(args: {
  userId: string;
  inboxItemId: string;
  subject: string | null;
  bodySnippet: string | null;
  senderEmail: string;
  senderName: string | null;
  senderRole: SenderRole | null;
  receivedAt: Date;
  // Pre-fetched query embedding (reused from email_embeddings to save
  // one API call). Pass null only when missing — the function will
  // skip the vector branch and fall back to structured-only.
  queryEmbedding: number[] | null;
}): Promise<ClassBindingResult>;
```

Implementation order inside the function:

1. Fetch all `classes` for the user (one query, ~5-15 rows for a
   typical student). Cache for the lifetime of the request.
2. Run the 6 method-checks above in priority order; first method to
   yield a `confidence > 0.85` short-circuits.
3. If no method clears 0.85, take the highest-confidence result.
4. If the highest is below `MIN_CONFIDENCE` (suggest 0.40), return
   `{classId: null, method: "none"}` — let the L2 prompts run with
   "no class identified, fanout is vector-only over the user's full
   corpus."

### 3.3 Persistence — cache on the inbox row

Add three columns to `inbox_items` (one new migration, no breaking
change since they're nullable):

```sql
ALTER TABLE inbox_items
  ADD COLUMN class_id              UUID REFERENCES classes(id) ON DELETE SET NULL,
  ADD COLUMN class_binding_method  TEXT,                                          -- enum-ish, validated in TS
  ADD COLUMN class_binding_score   REAL;
CREATE INDEX inbox_items_user_class_idx
  ON inbox_items (user_id, class_id)
  WHERE deleted_at IS NULL AND class_id IS NOT NULL;
```

The fanout retriever consults `inbox_items.class_id` rather than
re-running the binding on every call. Re-bind only when the row is
re-ingested (which is idempotent — see
[triage.ts:62-71](lib/agent/email/triage.ts:62)) or on an explicit
manual override (post-α — Settings → "this email is about CSC108"
correction). v1 = no manual override surface; the binding is final
at ingest.

The `RuleProvenance` shape doesn't need to change; the binding gets
its own JSONB-on-row fields for cleaner querying, plus a typed
provenance entry pushed into the existing `RetrievalProvenance`
union (see §6).

### 3.4 Order of operations — binding at ingest vs. at L2 time

**Recommend ingest-time.** The binding query touches:
- 1 query to load `classes` (small, cacheable per-request).
- 1 query to vector-search `syllabus_chunks` + `mistake_note_chunks`
  (fast under sequential scan at <1k chunks per α user).
- 0 LLM calls.

Total ~30-50 ms. Adding it to `triageMessage` →
`applyTriageResult` ([triage.ts:23-122](lib/agent/email/triage.ts:23))
runs once per inbox row, persists, and means the L2 fanout step is a
single index probe (`SELECT class_id FROM inbox_items WHERE id = ?`)
rather than a 50ms binding compute. Doing it at L2 time saves nothing
(L2 would have to bind anyway) and means the `class_id` isn't visible
to non-L2 consumers (e.g., a future "show this email under Classes →
CSC108 → Email" UI surface that the brief hints at via the existing
class-detail tabs).

Failure mode: when no class matches, persist `class_id = NULL,
class_binding_method = "none"`. The fanout step then runs vector-only
across all of the user's syllabus/mistake chunks (no class filter).

### 3.5 Class metadata embedding — open question revisit

The migration doc §3.5 deferred a `class_chunks` /
`assignment_embedding` design ("Classes don't get a chunk table v1:
they're tiny ... unlikely to add signal over the much-richer
mistake/syllabus chunks"). W1 evidence:

- The vector-binding method (#3 above) already gets class-level
  similarity *for free* by aggregating over the chunks that point to
  each class. No `class_chunks` row needed.
- For the *retrieval* side, the question is "should I cite a syllabus
  chunk or a class-level summary?" The chunks already win on
  granularity (they cite a specific syllabus paragraph instead of "the
  class metadata"). Skipping `class_chunks` for v1 stands.
- For *assignments*, similar reasoning: a single `assignment_embedding`
  column adds noise unless we want to surface "find me my similar past
  assignment to this one" — which is not a use case the brief calls
  out. Defer; revisit if α students surface it organically.

→ Surface as §12.6 (closed for v1, document the punt).

---

## 4. Hybrid retrieval SQL shapes

### 4.1 Structured branch (used when `class_id IS NOT NULL`)

**Mistakes by class:**

```sql
SELECT id, title, unit, difficulty, body_markdown,
       created_at
  FROM mistake_notes
 WHERE user_id = $1
   AND class_id = $2
   AND deleted_at IS NULL
 ORDER BY created_at DESC
 LIMIT $3;                      -- $3 = 3 (suggested k_mistakes_per_class)
```

Index used: `mistake_notes_user_class_idx (user_id, class_id) WHERE
deleted_at IS NULL` ([schema.ts:1014-1016](lib/db/schema.ts:1014)).
Latency: <5 ms at α volume.

**Syllabus chunks by class** — "give me the most-relevant syllabus
chunks from this class":

```sql
SELECT sc.id, sc.chunk_index, sc.chunk_text,
       (sc.embedding <=> $1::vector(1536)) AS distance,
       sc.syllabus_id
  FROM syllabus_chunks sc
  JOIN syllabi s ON s.id = sc.syllabus_id
 WHERE sc.user_id = $2
   AND s.class_id = $3
   AND s.deleted_at IS NULL
 ORDER BY sc.embedding <=> $1::vector(1536)
 LIMIT $4;                      -- $4 = 3 (suggested k_syllabus_per_class)
```

Note the *hybrid-within-hybrid*: even in the structured branch the
syllabus chunk *ranking* is by vector similarity, because a long
syllabus has many chunks and we want the *relevant* ones, not "the
first 3 chunks". The class filter just narrows the search space to
the right syllabus.

**Calendar events near received_at** — uses the existing
`fetchUpcomingEvents` shape but narrower (next 72h instead of 7
days at classify, full 7 days kept at draft):

```ts
fetchUpcomingEvents(userId, { days: 3 });   // classify
fetchUpcomingEvents(userId, { days: 7 });   // draft (existing)
```

(Calendar isn't queried via SQL — it's a Google API call. See §2.3.
Local mirror of calendar events lives in `events`
[schema.ts:451-516](lib/db/schema.ts:451) but is currently
not the source of truth for the L2 calendar slot — `fetchUpcomingEvents`
goes live to Google. Optional W1 optimization: switch to the local
`events` mirror when fresh; defer.)

### 4.2 Vector fallback branch (used when `class_id IS NULL`)

**Mistakes — top-K cosine over the user's whole corpus:**

```sql
SELECT mc.id, mc.mistake_id, mc.chunk_text,
       (mc.embedding <=> $1::vector(1536)) AS distance,
       mn.title, mn.class_id
  FROM mistake_note_chunks mc
  JOIN mistake_notes mn ON mn.id = mc.mistake_id
 WHERE mc.user_id = $2
   AND mn.deleted_at IS NULL
 ORDER BY mc.embedding <=> $1::vector(1536)
 LIMIT $3;                      -- $3 = 3
```

**Syllabus chunks — top-K cosine over the user's whole corpus:**

```sql
SELECT sc.id, sc.syllabus_id, sc.chunk_text,
       (sc.embedding <=> $1::vector(1536)) AS distance,
       s.title, s.class_id
  FROM syllabus_chunks sc
  JOIN syllabi s ON s.id = sc.syllabus_id
 WHERE sc.user_id = $2
   AND s.deleted_at IS NULL
 ORDER BY sc.embedding <=> $1::vector(1536)
 LIMIT $3;                      -- $3 = 3
```

Both queries share the same query embedding ($1) — pulled from
`email_embeddings.embedding` for the inbox row, *not* freshly
re-embedded.

### 4.3 Past emails (the existing retrieval, refit)

The existing `searchSimilarEmails`
([retrieval.ts:25-118](lib/agent/email/retrieval.ts:25)) keeps its
shape. For W1 fanout it becomes one of four sources, with K reduced
from 20 (deep-pass legacy) to 5 (medium-tier draft baseline) at
classify time, kept at 20 for high-risk deep pass. The existing
`MEDIUM_DRAFT_TOP_K = 5` constant ([l2.ts:36](lib/agent/email/l2.ts:36))
is reused.

### 4.4 Hybrid orchestration — when to use which

```
fanoutContext(inbox_item):
  classId = inbox_item.class_id              # set at ingest by §3
  qVec    = inbox_item.email_embeddings.embedding   # cached, no re-embed

  mistakes  = classId
              ? structured_mistakes_by_class(userId, classId, k=3)
              : vector_mistakes_topk(userId, qVec, k=3)

  syllabus  = classId
              ? hybrid_syllabus_chunks_by_class(userId, classId, qVec, k=3)
              : vector_syllabus_chunks_topk(userId, qVec, k=3)

  emails    = vector_emails_topk(userId, qVec, k=K)
              # K=5 at classify, K=20 at high-risk deep pass

  calendar  = fetchUpcomingEvents(userId, { days: classify ? 3 : 7 })

  return { mistakes, syllabus, emails, calendar, classId, method }
```

### 4.5 Result merging, dedup, ranking

- **Each source is a separate prompt block** (§5) — no merge/rank
  across sources. The prompt structure makes provenance citation
  trivial ("syllabus chunk #2: ...").
- **Within-source dedup:** for syllabus chunks, dedup on `syllabus_id`
  to avoid surfacing 3 chunks from the same syllabus when the user has
  multiple syllabi. For mistakes, dedup is unnecessary (each row is
  its own mistake).
- **Within-source ranking:** mistakes by `created_at DESC` (recency
  is meaningful — the most-recent mistake on a topic is what the
  student learned most recently, and likely most relevant). Syllabus
  chunks by similarity (the structured-branch query already orders by
  `<=>` distance). Past emails by similarity (existing).
- **Hybrid weighting between methods:** not needed at v1 — each source
  is its own prompt block, the LLM does cross-source reasoning. A
  weighted single ranked list (Reciprocal Rank Fusion etc.) is more
  complexity than the brief asks for.

### 4.6 Latency target

**Total fanout < 50 ms** at α volume:

| Step                                          | Estimate |
|-----------------------------------------------|----------|
| Mistakes (structured or vector, k=3)          | <5 ms    |
| Syllabus chunks (structured or vector, k=3)   | <10 ms   |
| Past emails (vector, k=5 classify / 20 deep)  | <10 ms   |
| Calendar (Google API)                         | 100-300 ms* |
| Total (excluding calendar)                    | <30 ms   |

\* Calendar is the long pole and is already in the draft-step budget.
For classify, recommend the same fire-and-forget pattern: run
calendar fetch in parallel with the structured/vector branches
(`Promise.all([...])`), and treat a >500ms timeout as "calendar
unavailable for this classify call" (skip the block, like
`fetchUpcomingEvents` does on `CalendarNotConnectedError` already).

### 4.7 pgvector index — defer per migration scoping §3.5

Migration scoping §3.5 (line 547) deferred IVFFlat / HNSW indexes:
"sequential scan is fine for 10 users × <1k emails." That stands at
α scale (10 users × ~30 mistakes × ~3 chunks per mistake = ~900 chunks
per user; ~5 syllabi × ~10 chunks = ~50 chunks per user). Add the
index when:
- Per-user chunk count exceeds ~5k (Ryuto's first dogfood-2-month
  population is the natural early-warning signal).
- Or fanout p95 latency on the chunk queries crosses 30 ms in
  Sentry's `db.query` spans
  ([retrieval.ts:38-44](lib/agent/email/retrieval.ts:38) for the
  pattern).

Document the deferral in the W1 implementation PR; don't pre-optimize.

---

## 5. L2 prompt restructuring

### 5.1 Today's prompts — what they say about retrieval

Risk-pass system prompt is silent on retrieval (no retrieval today)
— see [classify-risk.ts:34-46](lib/agent/email/classify-risk.ts:34).

Deep-pass system prompt mentions retrieval and *requires* citation:

> Reasoning must cite at least one retrieved similar email by subject
> when applicable — glass-box transparency is a hard product
> requirement. Reasoning is ALWAYS in English regardless of the
> email's language; it's an internal transparency string surfaced in
> a debug panel, not user-facing prose.

([classify-deep.ts:38-53](lib/agent/email/classify-deep.ts:38)).

Draft system prompt has no retrieval-citation requirement; it
mentions calendar grounding extensively but the
"=== Reference: similar past emails ===" block is provided "for tone
and style only" ([draft.ts:230-244](lib/agent/email/draft.ts:230)).

### 5.2 Where to slot the fanout context

For both classify and draft, fanout becomes a **fixed block sequence
between the email envelope and the existing similar-emails block**:

```
=== Email you're replying to ===          # existing
=== Risk-pass output ===                  # deep pass only
=== Prior thread messages ===             # existing

# --- W1 fanout begins ---
=== Class binding ===                     # NEW
Class: <name> (<code>) — bound by <method> (confidence <score>)
Or: (no class identified — fanout is vector-only across your corpus)

=== Relevant past mistakes (N) ===        # NEW
1. <title> [<unit>] [<difficulty>] — <body, sliced 200 chars>
2. ...

=== Relevant syllabus sections (N) ===    # NEW
1. <syllabus title> — <chunk_text, sliced 250 chars>
2. ...

=== Calendar (next D days) ===            # existing in draft, NEW in classify
1. <start> → <end> :: <title>[ @ <location>]

=== Reference: similar past emails (N) === # existing
1. [sim=0.87] <sender> — <subject> — <snippet, sliced 180>...
# --- W1 fanout ends ---

=== Student ===                           # existing in draft
```

Both prompts are extended to require *which source informed each
conclusion* in the reasoning string:

> Reasoning bullets must cite which fanout source informed each
> conclusion (mistake-N, syllabus-N, calendar-N, or email-N).
> Glass-box transparency is a hard requirement; ungrounded claims
> are unacceptable.

This makes the reasoning string parseable enough to render typed
provenance pills (§6).

### 5.3 Token budget allocation

**Per-source caps** (suggest, not absolute — see §12.2):

| Source            | Classify cap (chars) | Draft cap (chars) |
|-------------------|----------------------|-------------------|
| Class binding     | 200                  | 200               |
| Mistakes (k=3)    | 800 (3 × 250)        | 1500 (3 × 500)    |
| Syllabus (k=3)    | 1000 (3 × 300)       | 2000 (3 × 650)    |
| Calendar (24-72h) | 600 (~8 events)      | 1500 (~20 events) |
| Past emails (k)   | 800 (5 × 160)        | 900 (5 × 180)     |
| **Total fanout**  | ~3400 chars (~850 tk) | ~6100 chars (~1500 tk) |

Plus existing envelope:
- Classify base: ~600 tokens → with fanout: **~1500 tokens** (Mini ceiling 200k).
- Draft base: ~2500 tokens → with fanout: **~4000 tokens** (Full ceiling 200k).

**Risk-tier scaling:** for high-risk drafts that already get the K=20
similar-email slate from deep pass, keep mistake/syllabus k=3 but
allow chars-per-row to scale up (mistake 500 → 800, syllabus 650 →
900) — high-stakes replies benefit most from richer context, and the
deep pass already paid for the class binding lookup.

**Compression strategy if budget squeezed (post-α growth path):**
- Drop `Reference: similar past emails` from classify (the structured
  fanout sources should be doing the heavy lifting; similar-email is
  more of a tone-anchor for draft).
- Drop calendar from classify (keep at draft only — risk-tier
  decisions hinge less on calendar than draft tone does).
- Truncate mistake bodies harder before truncating syllabus chunks
  (syllabus is more often the load-bearing context).

---

## 6. Provenance / glass-box surfacing

### 6.1 Current `RetrievalProvenance` is email-only

```ts
export type RetrievalProvenance = {
  sources: Array<{
    type: "email";        // ← currently a single literal
    id: string;
    similarity: number;
    snippet: string;
  }>;
  total_candidates: number;
  returned: number;
};
```

([schema.ts:720-729](lib/db/schema.ts:720)).

### 6.2 Widen the discriminated union

```ts
export type RetrievalProvenanceSource =
  | { type: "email";    id: string; similarity: number; snippet: string }
  | { type: "mistake";  id: string; classId: string | null; similarity?: number; snippet: string }
  | { type: "syllabus"; id: string; classId: string | null; chunkId: string; similarity: number; snippet: string }
  | { type: "calendar"; id: string; title: string; start: string; end: string };

export type RetrievalProvenance = {
  sources: RetrievalProvenanceSource[];
  total_candidates: number;       // total across ALL sources, used by ThinkingBar
  returned: number;
  // NEW — class binding payload, separate so the UI can render it
  // distinct from the per-source pills.
  classBinding: {
    classId: string | null;
    method: ClassBindingMethod;
    confidence: number;
  } | null;
};
```

The JSONB column doesn't need a migration (it's already `jsonb`); the
TS type widening is the only change. Existing rows continue to parse
since the `type: "email"` branch is unchanged.

### 6.3 ThinkingBar UI shape

Per-source pills instead of homogeneous similarity-only pills:

- 🟦 Email pill (existing, "85% — <subject>")
- 🟧 Mistake pill ("from MAT244 — Kinematics")
- 🟪 Syllabus pill ("MAT244 syllabus — week 3 grading")
- 📅 Calendar pill ("Tomorrow 10am — Office hours")

A new "bound to <class name>" chip rendered before the source pills
when `classBinding.classId !== null`, with hover tooltip showing the
binding method ("matched 'CSC108' in subject" / "vector — 78% to
syllabus chunks of CSC108").

[components/agent/thinking-bar.tsx:44-63](components/agent/thinking-bar.tsx:44)
is the right place for this — the existing pill render loop generalizes
to a switch on `s.type`.

### 6.4 ReasoningPanel — citation footnotes

The panel already extracts bullets from the reasoning string when the
model used bullet markers ([reasoning-panel.tsx:57-67](components/agent/reasoning-panel.tsx:57)).
For W1, the prompts emit reasoning bullets like:

```
- Sender is asking about the homework deadline (mistake-1: similar
  pattern in past CSC108 mistakes shows the deadline is firm).
- Calendar shows no conflict at the proposed slot (calendar-2:
  Friday 2pm is free).
- Risk tier is medium — routine deadline question, not grade-related.
```

Render `(mistake-1)`, `(calendar-2)` etc. as clickable footnote
markers that scroll to / highlight the corresponding pill in the
ThinkingBar above. Implementation: regex
`/\((mistake|syllabus|calendar|email)-(\d+)\)/g` over the bullet
text; replace with a `<sup data-source-ref="..." />` that maps to the
pill ID.

### 6.5 Settings → "How your agent thinks"

The Phase 6 W4 landing copy (per
[memory/project_decisions.md](memory/project_decisions.md) "Brand
principle — Glass-box (2026-04-23)") promises this surface from α
launch. It does **not yet exist** as a route — the current Settings
page surfaces Agent Rules + Notifications + Staged Autonomy
([app/app/settings/page.tsx:278-333](app/app/settings/page.tsx:278))
but no per-decision reasoning explorer. W1 should land it.

Minimal v1 (1 day of UI work):
- Route: `/app/settings/how-your-agent-thinks`
- Renders the most-recent N (suggest 10) `agent_drafts` rows for the
  user, each as a card showing:
  - Subject + sender + risk tier
  - The full reasoning string
  - The `RetrievalProvenance` source list (using the same pill
    components as the inbox detail view — DRY)
  - The `RuleProvenance` from the inbox row (which L1 rule fired)
  - The class binding result + method
- No edit affordances — read-only retrospective view.
- Link prominently from the landing page (not yet wired) and from the
  Settings sidebar.

---

## 7. Performance budget

### 7.1 Postgres query latency

| Query                                       | p50    | p95    | Notes |
|---------------------------------------------|--------|--------|-------|
| `SELECT class_id FROM inbox_items WHERE id` | <2 ms  | <5 ms  | PK lookup |
| Mistakes by class (k=3)                     | <3 ms  | <10 ms | uses `mistake_notes_user_class_idx` |
| Syllabus chunks by class (k=3, hybrid)      | <8 ms  | <20 ms | sequential scan over chunks (no IVFFlat at α) |
| Vector mistakes (k=3, no class)             | <8 ms  | <20 ms | sequential scan |
| Vector syllabus (k=3, no class)             | <10 ms | <25 ms | sequential scan |
| Past emails (k=5)                           | <10 ms | <30 ms | matches existing `searchSimilarEmails` |
| Class binding (full)                        | <20 ms | <50 ms | combines several of the above |

**Total fanout at L2 invocation < 50 ms** (excluding Calendar API,
which runs in parallel and tolerates 100-500 ms).

### 7.2 Mini input cost (classify)

- Base prompt: ~600 tokens × $0.75/1M = $0.00045
- + ~850 fanout tokens × $0.75/1M = $0.00064
- + ~150 output tokens × $4.50/1M = $0.00068
- **Per classify with fanout: ~$0.00177** (was ~$0.00113 without)
- In credits (1 credit = $0.005): **~0.35 credits → 1 credit
  (Math.round at [models.ts:136-138](lib/agent/models.ts:136))**

### 7.3 GPT-5.4 input cost (draft)

- Base prompt: ~2500 tokens × $2.50/1M = $0.00625
- + ~1500 fanout tokens × $2.50/1M = $0.00375
- + ~400 output tokens × $15/1M = $0.006
- **Per draft with fanout: ~$0.016** (was ~$0.012 without)
- In credits: **~3.2 credits → 3 credits (rounded)**

### 7.4 Per-α-user month estimate

Assuming the brief's volume — 10 emails/day classify, ~30% escalating
to draft (3/day):

- Classifies/month: 10 × 30 = 300 → 300 credits with fanout (was ~225)
- Drafts/month: 3 × 30 = 90 → 270 credits with fanout (was ~180)
- **Per-user fanout-marginal cost: ~165 credits/month** (incremental
  on top of the existing ~405-credit baseline of classify + draft).

Note: these are *increases over the existing baseline*. The brief
quotes "9 drafts/day = 270/mo" which assumes ~30% escalation off 30
emails/day — that's a heavier user. Margins below stress-test against
the heavier number too.

### 7.5 Total fanout cost / user / month under various k values

| k_mistakes | k_syllabus | Fanout token Δ | Cost Δ/user/mo (300 classify + 90 draft) |
|------------|------------|----------------|------------------------------------------|
| 3          | 3          | ~850 (cls) / ~1500 (drf) | $0.34 |
| 5          | 5          | ~1300 / ~2400  | $0.55 |
| 3          | 5          | ~1100 / ~2000  | $0.45 |
| 5          | 3          | ~1050 / ~1900  | $0.43 |

At the heavier 270-drafts/mo workload:
- k=3,3: **$0.85/user/mo** marginal cost.
- k=5,5: **$1.40/user/mo** marginal cost.

In credits at 1c/$0.005:
- k=3,3 light:  ~70 credits/user/mo of the +165 credit margin lives
  in classify volume; the rest in drafts.
- k=5,5 heavy: ~280 credits/user/mo.

### 7.6 Recommendation: ship k=3,3

Smallest k with meaningful retrieval signal; ample margin under all
tier budgets (§8). Re-evaluate to k=5 only if α shows
"the model frequently cites all 3 chunks as relevant" — that's the
ceiling-saturation signal that warrants more headroom.

---

## 8. Cost / credit accounting

Per `memory/project_decisions.md`:

- 1 credit = $0.005 of token spend.
- Free: **300 credits/mo**; cap-behavior is hard pause on draft
  generation, classify continues.
- Pro Student: **1000 credits/mo**.
- Pro: **1000 credits/mo**.
- Tier capability rule: identical features across tiers; differentiation
  is credit volume only.

### 8.1 Baseline (no fanout — current main behavior)

| Operation         | Credits |
|-------------------|---------|
| Embed @ ingest    | ~0      |
| Risk pass (Mini)  | ~0.5    |
| Deep pass (Full)  | ~3.0 (high-risk only) |
| Draft (Full)      | ~3.0    |

For a 30-email/day typical user (~70% classify-only, ~25% medium-draft,
~5% high-deep+draft):
- Classify: 30 × 30 × 0.5 = 450 credits/mo
- Medium draft: 30 × 30 × 0.25 × 3.0 = 675 credits/mo
- High deep+draft: 30 × 30 × 0.05 × 6.0 = 270 credits/mo
- **Baseline: ~1395 credits/mo** (already over Free's 300; that's the
  expected cap-behavior — Free user sees draft generation hard-pause
  after ~36 medium drafts/mo).

### 8.2 With k=3,3 fanout

| Operation              | Credits (was → now) |
|------------------------|---------------------|
| Classify (Mini + fanout) | 0.5 → ~0.7 |
| Deep pass (Full + fanout) | 3.0 → ~3.6 |
| Draft (Full + fanout)   | 3.0 → ~3.5 |

Per-user/mo at 30-email/day:
- Classify: 30 × 30 × 0.7 = 630 (+180 vs baseline)
- Medium draft: 30 × 30 × 0.25 × 3.5 = 788 (+113)
- High deep+draft: 30 × 30 × 0.05 × 7.1 = 320 (+50)
- **With fanout: ~1738 credits/mo** (+343 vs baseline; +25%).

### 8.3 Tier fit

- **Free (300 credits)**: Already over budget at baseline; fanout
  doesn't change the cap-behavior story. Free users will hit their
  cap *slightly sooner* — the cap message at
  ([app/app/inbox/[id]/page.tsx:171-189](app/app/inbox/[id]/page.tsx:171))
  doesn't need wording changes.
- **Student / Pro (1000 credits)**: A 30-email/day user is over
  budget *with or without fanout* (1395 / 1738 vs 1000). The
  brief's quote "270 drafts/mo" is roughly the cap-headroom limit at
  baseline. Fanout pushes that down by ~20% (220 drafts/mo cap
  before exhaustion).

### 8.4 Recommendation — no tier-gating, surface in soft-cap copy

Per the locked decision "Free / Student / Pro get identical agent
capabilities" (`memory/project_decisions.md`), do **NOT**
tier-gate fanout. Land at k=3,3 across the board and update the
cap-exhaustion soft-message copy to include "your agent's deep
reasoning uses more credits per email than basic classification —
top up to extend." Existing copy at
[app/app/inbox/[id]/page.tsx:179-181](app/app/inbox/[id]/page.tsx:179)
just says "you ran out of credits." Mild rewording suffices.

If post-α data shows fanout cost squeezes Pro Student margin (from
$5/mo at baseline to ~$3/mo with heavy fanout users), the lever to
pull is **k reduction (3→2) for medium-tier drafts only**, not tier
gating. Surface as §12.5.

---

## 9. Failure mode handling

### 9.1 User has 0 mistakes / 0 syllabi (new user, first week)

The structured-branch query returns 0 rows; the vector branch returns
0 rows (the embedding tables are empty). The fanout retriever returns
`{ mistakes: [], syllabus: [], emails: [], calendar: [...] }`. The
prompt blocks render as `(none — your corpus is empty)` lines. The L2
prompts already handle this for the email source
([classify-deep.ts:177-178](lib/agent/email/classify-deep.ts:177)).

**Recommendation: prompt-side "empty-corpus" hint** — when ALL three
fanout sources are empty, prepend a one-line note to the user content
("This user is in their first week — corpus is empty. Reason from
email content only."). Keeps the model from over-hedging.

### 9.2 Fanout returns nothing relevant (k results all <0.4 similarity)

The structured branch always returns up to k rows even at low
similarity. The vector branch ranks by `<=>` distance — if all results
are far, they're still returned. Recommend a **similarity floor**:
drop chunks with similarity < 0.55 (cosine distance > 0.9) from the
prompt. Empty results then render as "(none — no relevant past
context)."

The 0.55 threshold is a v1 guess. Log the dropped-vs-kept count per
fanout call for post-α tuning (§10).

### 9.3 Postgres temporarily slow (>500 ms on a fanout query)

Wrap the structured + vector branches in `Promise.race` against a
500ms timeout per source. On timeout, treat that source as empty,
log a `email_fanout_timeout` audit row, and proceed.

The L2 step is synchronous in `ingestLast24h`; we don't want one
slow fanout query to hold the ingest loop. Existing pattern: the
calendar fetch is already fail-soft
([l2.ts:284-292](lib/agent/email/l2.ts:284)) — extend the same shape
to the structured/vector branches.

### 9.4 Embedding API down (OpenAI outage)

The fanout *query* embedding is **reused from `email_embeddings`**
(§2.4) — no fresh embed needed. The only embed-API dependency at L2
time is gone.

The *corpus-write* path (mistake save → `refreshMistakeEmbeddings`)
still depends on the embedding API. On API failure today, the
mistake save fails; the row never gets chunks. W1 should make this
fail-soft too: catch the embed error in the save path, persist the
mistake row, log `email_embed_failed`, and let a background worker
(post-α) backfill chunks. v1 = surface as a Sentry alert; chunks for
that mistake stay missing until the user manually re-saves it.

### 9.5 Calendar scope revoked mid-session

Already handled. `getCalendarForUser` throws
`CalendarNotConnectedError`, swallowed at
[l2.ts:284-292](lib/agent/email/l2.ts:284). Calendar block
renders as empty. Same shape for W1's classify-side calendar fetch.

### 9.6 Class binding picks the wrong class

Worst case: the model gets a syllabus block that mentions "Newton's
laws" when the email was actually about Linear Algebra. The reasoning
will (per §5.2 prompt requirement) cite "syllabus-1: Newton's laws"
— which is a *visible* failure (the user reads the reasoning and
sees the wrong cite). Glass-box transparency turns a silent retrieval
failure into a debuggable one.

For α: log the binding method + confidence on every L2 row (§10).
Post-α: add a "this email isn't about <class>" correction button on
the inbox detail page that triggers re-bind + persists the override.

---

## 10. Eval / measurement

### 10.1 Today's metrics

Per `memory/project_agent_model.md`:
- Classification error rate < 5%
- Draft edit rate < 20%
- Post-send regret rate = 0

Tracked manually in dogfood; admin metrics surface lives at
`/app/admin` ([app/app/admin/page.tsx](app/app/admin/page.tsx),
W4.2).

### 10.2 Counterfactual eval — "would L2 reach a different conclusion
without fanout?"

Practical α design: **shadow run**.

For each L2 invocation, run:
1. The real fanout pipeline (persist its result).
2. A *shadow* classify+draft with `fanout = empty` (don't persist;
   compare in-memory).

Log the diff:
- Did the risk tier change?
- Did the draft action change (draft_reply ↔ ask_clarifying ↔
  archive)?
- Bag-of-tokens distance on the draft body?

This doubles the LLM cost per L2 call — only run for **10% of
classify + draft calls** (sampled by `inbox_item_id` hash) so the
overhead is bounded.

Cost: 0.1 × 1738 credits/user/mo ≈ +175 credits/user/mo. At dogfood
(Ryuto's account with admin coupon = no monetary cost), this is
free. For α users — disable shadow mode and rely on §10.3
post-hoc analysis instead.

### 10.3 Simpler α metric — before/after edit rate

Switch fanout on for half the α users (5 of 10), keep it off for the
other 5 (control). Compare:
- Draft edit rate (existing W3 metric).
- Time-to-send (a proxy for "did the user trust the draft enough to
  not heavily edit").
- Drafts dismissed without sending (signal that the agent picked the
  wrong action entirely).

The 5/5 split is small but the effect size from fanout *should* be
large enough to register at this n if the moat thesis is correct. If
no detectable difference, the moat thesis needs revision — a
quasi-publishable negative result.

### 10.4 What to log on each L2 invocation

New audit_log rows per L2 call (one row per fanout call, joinable to
the existing `email_l2_completed` row by `resourceId` =
inbox_item_id):

```ts
logEmailAudit({
  userId,
  action: "email_fanout_completed",
  result: "success",
  resourceId: inboxItemId,
  detail: {
    classBinding: { classId, method, confidence },
    counts: { mistakes: N, syllabus: N, emails: N, calendar: N },
    timings_ms: { mistakes, syllabus, emails, calendar, total },
    droppedBelowThreshold: { mistakes: N, syllabus: N },
    sourcesCited: { /* parsed from reasoning */ },  // post-LLM
  },
});
```

Plus a `email_fanout_timeout` failure variant when one of the source
queries hits the 500ms cap.

### 10.5 Class binding accuracy

For α dogfood: spot-check by exporting the latest 50 inbox rows with
their `class_binding_method` + `class_id` + sender + subject; manually
label correct/incorrect. Target precision >85% at v1.

---

## 11. Effort estimate (engineer-days)

Assumes "ship + manual smoke test" sizing. Sequential where ordering
matters; parallelizable items called out.

| # | Item | Days |
|---|------|------|
| 1 | `class-binding.ts` module + unit tests + persistence migration (3 columns on `inbox_items` + index) | 1.5 |
| 2 | Fanout retriever module (`lib/agent/email/fanout.ts`) — structured + vector branches, `Promise.all`-shaped orchestration, 500ms-per-source timeouts | 1.5 |
| 3 | Classify-side fanout integration (`runRiskPass` user-content build expansion + system prompt rewrite + new prompt blocks) | 0.75 |
| 4 | Deep-pass fanout integration (similar to #3 but with bigger char caps + cite requirement is already in the system prompt — extend to per-source cite) | 0.5 |
| 5 | Draft-side fanout integration (`runDraft` user-content build expansion + system prompt rewrite, calendar block already exists) | 0.75 |
| 6 | `RetrievalProvenance` discriminated-union widening + ThinkingBar typed pills | 0.75 |
| 7 | ReasoningPanel footnote-citation rendering | 0.5 |
| 8 | Settings → "How your agent thinks" route (read-only retrospective view of last N drafts) | 1.0 |
| 9 | Eval logging (`email_fanout_completed` audit shape + per-source timing spans in Sentry) | 0.5 |
| 10 | Post-α dogfood instrumentation (admin page section: per-source citation rate, fanout latency p50/p95) | 0.5 |
| 11 | Backfill script — bind existing `inbox_items` rows to classes (one-shot) | 0.5 |
| 12 | Test suite expansion (binding fixtures EN + JA, fanout merge edge cases, prompt-shape snapshot tests) | 1.0 |
| 13 | Docs + handoff report | 0.5 |
| **Total** | | **~9.75 days** |

Items 3, 4, 5, 6, 7 can parallelize across two engineer-pairs if
needed; the critical path is 1 → 2 → 3/4/5 → 6/7 → 8 → 11 → 12.

Aligns with the brief's "~1.5 weeks" in
`memory/project_steadii.md`.

---

## 12. Open questions for Ryuto

These are the decisions the implementation cannot make silently. Bring
to the next sparring round.

### 12.1 Class binding location — standalone module vs folded into classify?

**Recommend standalone (§3.2).** Folding into classify means re-binding
on every L2 call (waste), means non-L2 surfaces (future "Class →
related emails" UI) can't read the binding without running L2, and
mixes a deterministic structured/vector compute with the LLM call.
Standalone module + persisted cache on the inbox row is the cleaner
shape. **OK to proceed?**

### 12.2 Token budget — per-source caps or single total cap?

Per §5.3, recommendation is **per-source caps** (3 mistakes × 250
chars classify, etc.) rather than a total budget the merger enforces.
Per-source caps:
- Are easier to reason about ("each source fits in its own block").
- Don't require a cross-source merger that has to decide which source
  to truncate when budget squeezed.
- Keep the prompt structure stable across runs.

A total cap would be relevant if we wanted dynamic re-allocation
("if mistakes are short, give syllabus more room"). v1 caps are
small enough that this re-allocation isn't worth the complexity.
**Confirm per-source caps, or pick a total cap target?**

### 12.3 Fanout k values per source — start at 3,3,5 or different?

§4.4 / §7.6 recommends `k_mistakes=3, k_syllabus=3, k_emails=5
(classify) / 20 (deep)`. The picks are seed values; α observation
will tune. Specific worry: a typical α user might have only 2-5
syllabi total — k=3 syllabus-chunks could pull from 1 syllabus = no
diversity. Mitigation: dedup by `syllabus_id` in §4.5 means k=3
chunks comes from up to 3 distinct syllabi when available.

**Confirm 3/3/5 starting values, or override?**

### 12.4 Ranking — pure recency (mistakes), pure similarity (syllabus,
emails), or weighted hybrid?

§4.5 recommends:
- Mistakes: recency (`created_at DESC`) — "what did the student learn
  recently."
- Syllabus chunks: similarity (`<=>`) — "what part of the syllabus is
  most about this email's topic."
- Past emails: similarity — existing.

Alternative: weighted hybrid for mistakes (similarity × log(recency))
to get the "topically-relevant *and* recent" sweet spot. Adds query
complexity for unclear gain.

**Confirm pure-recency for mistakes, or experiment?**

### 12.5 JA-specific course-code regex patterns to seed

Recommend adding a handful of JP-formatted course-code patterns to
the §3.1 method-1 regex set:

```
/\b\d{8}\b/        # UTAS 8-digit course codes
/\b[A-Z]{2,4}-\d{2,4}\b/   # mixed-style (some JP universities)
/[線形代数学|微分積分学|情報科学|...]/g  # well-known kanji course names
```

The kanji-name pattern is operator-maintained. Recommend a
`COURSE_CODE_PATTERNS_JA` constant alongside the existing
`AUTO_HIGH_KEYWORDS` set in
[lib/agent/email/rules-global.ts](lib/agent/email/rules-global.ts).

**Want operator-curated seed list, or rely on `classes.code`
substring match alone?**

### 12.6 `assignment_embedding` / `class_chunks` revisit (open Q #2 from migration report)

Recommend **defer** for v1 (§3.5). The vector binding method already
gets class-level signal by aggregating over chunks; assignments are
short text and similarity-search isn't a use case the brief calls
out.

Post-α revisit triggers:
- α users surface "find me my similar assignment" as a workflow.
- The vector binding precision is poor and class-level summary
  embeddings would help disambiguate (e.g., two math classes on
  same topic).

**Punt to post-α, agreed?**

### 12.7 `audit_log.resourceType` taxonomy enum (open Q #7 from migration report)

W1 will add at least one new resourceType (`email_fanout` for the
new `email_fanout_completed` action). Per the migration report, no
typed enum exists in [lib/db/schema.ts](lib/db/schema.ts) for
resourceType — it's plain `text("resource_type")` and writers use
free strings ([example writers above](#26-what-is-not-instrumented-today)).

Recommend introducing an `AuditResourceType` union type in schema.ts
(non-runtime, type-only) and a `assertAuditResourceType()` helper at
the writer side, then migrating writers in a follow-up cleanup PR.
W1 doesn't *block* on this; safe to ship the new
`resourceType: "email_fanout"` writer string and codify the taxonomy
later.

**OK to defer the taxonomy enum to a separate cleanup PR, just adding
the new strings inline for W1?**

### 12.8 Shadow eval — run for α users or dogfood-only?

§10.2 proposes a 10% shadow-eval sample to measure counterfactual
"with vs without fanout" impact. At dogfood (Ryuto's admin account)
this is free; at α it doubles the LLM cost per sampled call.

Two shapes:
1. **Dogfood-only.** Honest signal but n=1 user.
2. **5/5 α split (§10.3).** Clean A/B but no per-call counterfactual.

Recommend §10.3 (split). Cleaner inference, no per-user cost
inflation.

**Pick split or shadow?**

### 12.9 "How your agent thinks" Settings route — ship in W1 or defer?

§6.5 recommends shipping the route in W1 since the landing copy
already promises it (Phase 6 W4) and it's 1 day of UI work. The
alternative is to ship fanout but defer the UI, leaving the landing
copy promise unfulfilled at α launch.

**Ship in W1, or defer?**

### 12.10 Calendar source — Google API or local `events` mirror?

Today's draft path calls Google live (`fetchUpcomingEvents`,
[lib/integrations/google/calendar.ts:78-109](lib/integrations/google/calendar.ts:78))
on every L2 invocation. The local `events` table at
[schema.ts:451-516](lib/db/schema.ts:451) holds a mirror, but it's
populated by a separate sync job (post-α) that doesn't yet exist.

Adding classify-side calendar fanout means **doubling** the live
Google API call rate (every classify + every draft). Per-call latency
adds 100-300ms.

Three options:
1. **Live both, parallel.** Simplest; latency dominates.
2. **Live at draft, skip at classify.** Defends the 50 ms classify
   target; sacrifices some classify-time signal.
3. **Build the local mirror as W1 prereq.** Adds 0.5-1 day; lets both
   classify and draft hit Postgres at <5ms.

**Recommend (2) for v1** — the brief's "both fanout fully" clause is
strongest about Mistakes/Syllabus where the structured-vector hybrid
matters most; calendar-at-classify is the marginal win and trades
against latency. Defer (3) until α observation shows classify-time
calendar context would have changed the outcome.

**Confirm (2), or pick another?**

### 12.11 Anything else surprising

- **The query embedding can be reused from `email_embeddings` at
  near-zero cost** (§2.4). Surfaces as an obvious latency/cost win,
  but the existing deep-pass code re-embeds on every call
  ([l2.ts:198-206](lib/agent/email/l2.ts:198)) and would benefit
  from the same cleanup. Bundle as part of #2 in §11 or surface
  separately?

- **Mistakes' chunk-write strategy is delete-then-insert per save**
  ([entity-embed.ts:22-41](lib/embeddings/entity-embed.ts:22)) —
  positional chunk_index is meaningful, so a body edit deletes all
  existing chunks and re-embeds. At dogfood scale this is fine.
  Post-α at heavier write rates this becomes a noisy noisy embed
  cost line item; W1 doesn't need to fix it but flag for awareness.

- **The `ReasoningPanel` collapses at 400 chars** — reasoning strings
  with citations to multiple fanout sources will routinely exceed
  this. Recommend bumping to 800 chars or removing the collapse for
  the bullets-rendering path (collapse remains for paragraph-style
  fallback).

---

## 13. Conflicts with locked decisions

**None found.** Everything in this scoping doc operates within the
2026-04-25 Architecture revision (Postgres-canonical) and the W1
brief's locked decisions:

- Fanout sources = Mistakes + Syllabus + Calendar ✓
- Both classify and draft fanout fully ✓
- Hybrid retrieval (structured first, vector fallback) ✓
- Postgres-canonical for all 4 entities ✓ (the schema is in place)
- α target = JP students; binding heuristics handle JA ✓ (§3.1.5,
  §12.5)

---

## 14. Assumptions made

Listed so they can be challenged independently of the section content.

1. **α volume = 10 users × ~30 emails/day × ~30% draft rate.** Cost
   numbers are sensitive to this; if the real volume is 100
   emails/day per user (heavy users), the per-user margins in §8
   need re-running.

2. **`email_embeddings.embedding` is always present at L2 time.** True
   under the current synchronous `triageMessage` →
   `embedAndStoreInboxItem` → `processL2` ordering. Becomes false if
   embed-on-ingest is moved to a background worker (not currently
   planned).

3. **The 500ms per-source timeout is acceptable for fanout fail-soft.**
   The L2 step is in the synchronous ingest loop; a 500ms timeout
   per source × 4 sources = 2s worst-case fanout latency. At α
   volume (≤20 ingests per user per day, run on a 24h-cool-off cron)
   this is invisible.

4. **`text-embedding-3-small` model stays the canonical embed model.**
   The vector-column dimension is 1536, hard-baked into the schema. A
   future model swap requires a re-embed of all chunks; v1 doesn't
   plan for this.

5. **JP α users will have populated `classes.professor` in kanji**
   (or that they'll use the upcoming Settings → Classes UI to do so).
   Without that, the §3.1.5 〇〇先生 binding method has nothing to
   match against.

6. **Settings → "How your agent thinks" can ship as a read-only
   retrospective view.** A more interactive surface (rule-tweaking,
   per-decision feedback buttons) is post-α and out of W1 scope.

7. **The 10-engineer-day estimate assumes solo execution with
   intermittent sparring rounds for §12 questions.** Pair work or
   parallelization across 2 engineers brings this to ~7 calendar
   days; a single engineer with no parallel work is closer to 10-12.

---

End of W1 scoping pass. Implementation pickup: see `engineer-brief`
once Ryuto confirms §12 open questions.
