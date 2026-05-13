# Engineer-51 — Cross-source relational reasoning (entity graph)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md`

Reference shipped patterns:

- `lib/agent/email/embeddings.ts` — pgvector-backed embeddings for inbox_items. Use the same `text-embedding-3-small` pipeline for entities.
- `lib/agent/email/retrieval.ts` + `lib/agent/email/similar-sent-retrieval.ts` — existing cosine-similarity retrieval; the entity resolver borrows the pattern.
- `lib/agent/email/reranker.ts` (engineer-48) — for ambiguous entity matches, the reranker pattern applies to "is candidate entity X the same as the one mentioned in this email?"
- `lib/db/schema.ts` — `inboxItems`, `agentDrafts`, `events`, `assignments`, `chatSessions`, `chatMessages`, `agentContactPersonas`, `senderHistory` (verify name) — all data sources the entity graph spans
- `lib/agent/email/agentic-l2.ts` (engineer-41/45/47/48) — extends with an entity-lookup tool so the agent can ask "what else do we know about this project/person?"
- `lib/agent/orchestrator.ts` — chat orchestrator gets the same tool
- `lib/agent/proactive/snapshot.ts` — `UserSnapshot` carries entity-aware data into the scanner

---

## Strategic context

The biggest gap from the 2026-05-12 agent-quality research: Steadii's data sources operate as silos. Email knows senderEmail. Assignment knows classId. Event knows Google-calendar-id. Chat session knows userId. Without cross-linking, the agent can't reason "this email about 令和トラベル interview is about the same project as last week's calendar block + the Notion doc + the chat from 5 days ago." Human EAs do this naturally — "connecting the dots" is THE defining EA skill per the research literature.

Engineer-51 builds the entity layer that bridges sources:

- **Entity types** (α scope): `person` | `project` | `course` | `org` | `event_series`
- **Entity links** map domain rows (email, assignment, event, chat_message) to entities
- **Resolver** ingests new rows + matches them to existing entities (or creates new ones) via name + embedding similarity + LLM disambiguation

Once landed:
- Agentic L2 can call `lookup_entity` to pull all context about a project/person before drafting
- Chat agent can answer "what's the latest on the 令和トラベル thing?" without the user re-stating context
- CoS digest (engineer-50) gains entity-grouped synthesis (instead of "47 emails", "8 emails about project A, 12 about project B")
- Proactive scanner gains rules like "you've been quiet on project X for 12 days" or "project Y has 3 deadlines clustered next week"

This is the most ambitious engineer wave to date — ~2500 LOC across 18-22 files. Build in parts; each part is testable / shippable.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-51
```

---

## Part 1 — Schema (migration 0042)

```ts
export type EntityKind =
  | "person"          // a specific human (professor, classmate, recruiter, etc.)
  | "project"         // a body of work (group project, interview process, club initiative)
  | "course"          // a school class — usually 1:1 with the existing `classes` table; entity layer for queries
  | "org"             // a company, school, club (令和トラベル, UToronto, etc.)
  | "event_series";   // recurring event (weekly TA hours, study group)

export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    kind: text("kind").$type<EntityKind>().notNull(),
    displayName: text("display_name").notNull(),                  // canonical short name; user-editable
    aliases: text("aliases").array().notNull().default(sql`'{}'::text[]`),  // alternate spellings / abbreviations
    description: text("description"),                              // 1-2 sentence; LLM-generated, user-editable

    // For person entities specifically.
    primaryEmail: text("primary_email"),
    primaryClassId: uuid("primary_class_id").references(() => classes.id, { onDelete: "set null" }),

    // Cosine-similarity match fodder. Built from displayName + aliases + description.
    embedding: vector("embedding", { dimensions: 1536 }),         // matches text-embedding-3-small

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    mergedIntoEntityId: uuid("merged_into_entity_id"),            // soft-merge target for dedup
  },
  (t) => ({
    userKindIdx: index("entities_user_kind_idx").on(t.userId, t.kind),
    userEmailIdx: index("entities_user_email_idx").on(t.userId, t.primaryEmail),
    embeddingIvf: sql`CREATE INDEX entities_embedding_ivf ON ${t} USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50)`,
  })
);

export const entityLinks = pgTable(
  "entity_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),

    sourceKind: text("source_kind")
      .$type<"inbox_item" | "agent_draft" | "event" | "assignment" | "chat_session" | "chat_message" | "agent_contact_persona">()
      .notNull(),
    sourceId: uuid("source_id").notNull(),

    confidence: real("confidence").notNull(),                     // 0..1; resolver's confidence at link time
    method: text("method").$type<"llm_extract" | "exact_match" | "embedding_similar" | "user_manual">().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => ({
    entityIdx: index("entity_links_entity_idx").on(t.entityId),
    sourceIdx: uniqueIndex("entity_links_source_unique").on(t.userId, t.sourceKind, t.sourceId, t.entityId),
  })
);
```

Migration 0042 + journal. Includes `CREATE EXTENSION IF NOT EXISTS vector` if not already there (it should be from engineer-23's prior pgvector work — verify before adding).

---

## Part 2 — Entity resolver

New file: `lib/agent/entity-graph/resolver.ts`.

Public surface:

```ts
async function resolveEntitiesForSource(args: {
  userId: string;
  sourceKind: "inbox_item" | "agent_draft" | "event" | "assignment" | "chat_message";
  sourceId: string;
  contentText: string;       // the searchable text representation of the source row
  knownContext?: {           // optional pre-known link material
    senderEmail?: string;
    classId?: string;
  };
}): Promise<{
  linkedEntityIds: string[];
  createdEntityIds: string[];
}>;
```

Algorithm:

1. **Extract candidates** via LLM. Prompt: "Identify any person, project, course, organization, or recurring event referenced in the following text. Return a JSON list with `{ kind, displayName, aliases? }`. Return [] if nothing notable. Be precise — only return entities that would be useful as a navigation hub across the user's data." Mini-tier model (gpt-5.4-mini).

2. For each candidate:
   - **Exact match** by `displayName` or aliases against existing `entities` rows (user-scoped) → link with confidence 0.95, method='exact_match'
   - **Embedding match** if no exact: compute embedding of candidate's `displayName + aliases.join(' ')`, query top-5 nearest entities by cosine, ask reranker (engineer-48) "is this candidate the same as the matched entity?" → link with confidence from reranker, method='embedding_similar' (only if reranker confidence >= 0.7)
   - **Create new** if no match: INSERT new entity with the candidate's data, compute + store embedding, link with confidence 0.9, method='llm_extract'

3. Update `entities.lastSeenAt` on every link.

4. Fail-soft: if LLM throws or returns garbage, skip extraction; the row stays unlinked. Log via Sentry but don't block the ingest pipeline.

### Wire into ingest

- `lib/agent/email/ingest-recent.ts` or `email-ingest.ts` (verify) — after L1 risk pass, fire-and-forget `resolveEntitiesForSource` for the inbox_item
- `lib/agent/email/l2.ts` — after L2 finishes, do the same for the resulting agent_draft (often surfaces NEW entities the LLM understood from full body)
- `lib/agent/proactive/syllabus-import.ts` (or assignment creation flow) — fire when assignments are created
- Calendar event sync — fire when new events ingest
- `lib/agent/orchestrator.ts` — fire when chat_messages are persisted (user + assistant turns both contribute candidates)

All fire-and-forget; failures don't block primary flow.

### Backfill cron `/api/cron/entity-backfill`

For existing rows from before this engineer landed. Runs daily; processes 50 rows per invocation; tracks progress via `users.preferences.entityBackfillCursor` (or a small `entity_backfill_state` table — engineer's call). Stops when no unlinked rows remain.

QStash schedule: `0 3 * * *` daily. Canonical set bumps 12 → 13.

### Tests

- `tests/entity-resolver.test.ts` — exact match, embedding match (mock embedding), new-entity create, fail-soft
- `tests/entity-backfill-cron.test.ts` — cursor advances, stops when done, idempotent

---

## Part 3 — Agent + chat tool integration

### New chat tool `lookup_entity`

`lib/agent/tools/lookup-entity.ts`:

```ts
name: "lookup_entity"
description: "Look up everything Steadii knows about a person, project, course, organization, or recurring event. Returns the entity's display name + aliases + description + the most recent links (emails, assignments, events, chat sessions) tied to it. Call this when the user mentions a name / project / course you might have prior context on; the entity graph is built from cross-source extraction so this is the most efficient way to pull cohesive context."
```

Input zod:
- `query: string` — fuzzy name / alias to look up
- `kind?: EntityKind`

Returns: top 3 candidate entities (by name match + alias match + embedding similarity), each with up to 10 most recent links + 1-line summary derived from the link metadata.

### Wire into chat orchestrator tool registry

Available always (no session-type gating).

### Wire into agentic L2 tools (engineer-41 + engineer-45 pattern)

Add `lookup_entity` to the agentic L2 tool list so the draft pipeline can pull cross-source context BEFORE generating a reply — e.g., a recruiter email arrives, agent calls `lookup_entity("令和トラベル")` and finds 4 prior emails + 1 calendar event + 1 chat session, drafts a reply that respects all that history.

### System prompt extension

Add to chat + agentic L2 prompts (engineer-45 USER CONTEXT block):

```
ENTITY GRAPH:
- Steadii links emails, assignments, events, chat turns to shared entities (people, projects, courses, orgs, recurring events).
- Use lookup_entity whenever the user references a name / project that's likely to have prior context. Skip it for one-off mentions.
- The graph is built from automatic extraction; if a result looks wrong, mention it — the user can correct via /app/entities.
```

---

## Part 4 — User-facing entity surface

New page `app/app/entities/page.tsx` — list view grouped by kind. Each entity card shows display name + aliases + N links + last-seen date.

New page `app/app/entities/[id]/page.tsx` — detail. Shows all linked source rows in a unified timeline (most recent first). Edit affordances:
- Edit `displayName`, `aliases`, `description`
- Manually link / unlink source rows
- Merge into another entity (the soft-merge flow — sets `mergedIntoEntityId`, links remain queryable from the canonical entity)
- Delete (soft via `mergedIntoEntityId = SELF_TOMBSTONE` — engineer's call on representation)

Server actions: `updateEntityAction`, `linkSourceManuallyAction`, `unlinkSourceAction`, `mergeEntitiesAction`.

Settings link from `/app/settings` to `/app/entities`.

i18n keys under `entities.*`.

---

## Part 5 — Proactive rule integration

New rule: `lib/agent/proactive/rules/fading-entity.ts`. Detects entities (especially `person` kind) the user has touched in N×stddev fewer days than usual. Fires Type C card: "You haven't talked to {entityName} in {N} days. Used to be every {M} days. Drifted on purpose?"

New rule: `lib/agent/proactive/rules/entity-deadline-cluster.ts`. Detects when 3+ assignments / events linked to the same entity cluster within a 7-day window. Fires Type C card: "{entityName}: 3 deadlines this week. Worth blocking time?"

Both fire from existing scanner; same dedup pattern as engineer-44's assignment_deadline_reminder.

Add to `AgentProposalIssueType` enum.

---

## Out of scope (engineer-52+)

- **Multi-user entity sharing** — α is solo
- **Public-knowledge entities** (e.g., "OpenAI is a company") — α only tracks user-context entities
- **Entity relationships** (project → person, course → assignments) as first-class edges — currently inferred via shared link sources; explicit edges later if needed
- **Active learning** (user corrects → resolver gets retrained) — manual corrections are saved but don't tune the resolver model
- **Confidence threshold tuning UI** — fixed thresholds for α

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new ones
3. **Migration 0042** applied via `pnpm tsx scripts/migrate-prod.ts`
4. **QStash schedule** for `/api/cron/entity-backfill` daily at 03:00 UTC
5. **Live dogfood**:
   - Manually trigger resolver on Ryuto's 令和トラベル email thread → verify entity "令和トラベル" (kind=org) + person entity for the recruiter get created + linked
   - Open `/app/entities` → see them listed
   - Click 令和トラベル entity → detail page shows all linked emails / assignments / calendar events in unified timeline
   - Open a new chat, say "令和トラベルの状況どう？" → agent calls lookup_entity, returns cohesive answer without re-asking context
   - Backdated test: clear `lastTouched` on a person entity → fading-entity rule fires Type C card

---

## Commit + PR

Branch: `engineer-51`. Push, sparring agent creates the PR.

Suggested PR title: `feat(graph): cross-source entity graph — schema + resolver + chat tools + UI + proactive rules (engineer-51)`

---

## Deliverable checklist

- [ ] `lib/db/schema.ts` — entities + entityLinks tables
- [ ] `lib/db/migrations/0042_*.sql` + journal entry
- [ ] `lib/agent/entity-graph/resolver.ts` — extraction + matching + linking
- [ ] `lib/agent/entity-graph/embedding.ts` — embed entity names for similarity match
- [ ] Hooks in ingest pipelines (email, assignment, event, chat)
- [ ] `app/api/cron/entity-backfill/route.ts` — backfill cron
- [ ] `lib/agent/tools/lookup-entity.ts` — new chat tool
- [ ] `lib/agent/tool-registry.ts` — register
- [ ] Add `lookup_entity` to agentic L2 tool list
- [ ] System prompt block (chat + agentic L2)
- [ ] `app/app/entities/page.tsx` + `[id]/page.tsx` + server actions
- [ ] `lib/agent/proactive/rules/fading-entity.ts` + `entity-deadline-cluster.ts`
- [ ] Register in proactive/scanner.ts; extend AgentProposalIssueType
- [ ] `lib/i18n/translations/{ja,en}.ts` — new keys
- [ ] Tests per Verification section
- [ ] Live dogfood verified
