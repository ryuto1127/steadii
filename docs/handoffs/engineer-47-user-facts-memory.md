# Engineer-47 — User-facts memory (persistent facts the agent remembers about the user)

**Read user-memory FIRST**:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/MEMORY.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_secretary_pivot.md` — Steadii is now a secretary, NOT a tutor (the dropped "mistake notes" feature lives nearby in the schema; do NOT repurpose its semantics)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — risk-tiered confirmation; this feature touches the chat agent + agentic L2 + draft pipeline
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/user_ryuto.md` — Ryuto's profile illustrates the kind of facts that should land here (location, school, year, time-of-day patterns, communication style)
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — read before doing any migration; `drizzle.__drizzle_migrations` lives in the `drizzle` schema, NOT `public`

Reference shipped patterns:

- `lib/db/schema.ts` `agentContactPersonas` + `ContactStructuredFacts` (~line 1986+ — verify) — engineer-41 / engineer-45 work for per-contact structured facts. Same _pattern_ (a JSONB struct + audit-log INSERTs), different scope (user-self, not per-contact).
- `lib/agent/email/l2.ts` `persistAgenticSideEffects` (now exported per PR #199) — merges typed facts onto a JSONB column via `onConflictDoUpdate` + `||` jsonb concat. Mirror this for user-fact upserts.
- `lib/agent/orchestrator.ts` + `lib/agent/prompts/main.ts` — engineer-45's system-prompt injection point. New facts get spliced into the same "USER CONTEXT" block.
- `lib/agent/email/agentic-l2-prompt.ts` — agentic L2's user message builder. Same fact-context injection.
- `lib/agent/tools/convert-timezone.ts` — engineer-45 tool. Use as a template for the new `save_user_fact` chat tool.
- `lib/agent/email/voice-profile.ts` — closest existing per-user "Steadii learned this about you" surface (the writing-voice one-line summary). Sibling concept, different shape (free-form text, generated; vs. typed user facts, explicit).
- `components/chat/mistake-note-dialog.tsx` + `/api/mistakes/save` — the **dead** tutor-era code path. Kept intact per PR #210 specifically for this engineer to potentially repurpose. **Decide deliberately**: either repurpose (rename + rewire) or keep ignoring + delete in a cleanup PR. Don't half-rewire.

---

## Strategic context

In Ryuto's 2026-05-12 chat transcript with the アクメトラベル interview thread, he had to clarify the same context multiple times:

- "私がいるところはバンクーバーなのですが、時差的にはどうですか？" (I'm in Vancouver — what about the TZ?)
- "私目線で話していました" (I was speaking from my POV)
- "午後の8:30の話です" (I meant 8:30 PM)

Engineer-45 fixed the structural TZ math + system prompt injection of `users.preferences.timezone`. That handles things stored as **structured user preferences**. But there's a wider class of facts the agent should remember and use across sessions:

- "私の時刻指定は基本的にバンクーバー時間で話してます" (I generally speak in PT)
- "営業日 13:00-18:00 PT で動いてます" (I'm reachable 13:00-18:00 PT on weekdays)
- "ビジネスメールは丁寧体、友達には砕けて返信する" (Formal tone for business, casual for friends)
- "高校 12 年生で、UToronto CS 進学予定" (Grade 12, going to UToronto CS in September)
- "深夜は通知しないで" (Don't notify me at night)

Steadii currently has no place for these. `users.preferences` is the structured-prefs slot but it's flat-typed (timezone, locale, agenticL2 flag, voiceProfile string, etc.) — adding free-form remembered facts there bloats the column. A dedicated `user_facts` table is cleaner.

This engineer ships:

1. New `user_facts` table — flat list of typed facts per user, soft-delete, audit-log tied to the chat turn that minted them
2. New chat tool `save_user_fact` — the agent calls this when the student says something it should remember
3. (Optional) Inline "Save fact" affordance in chat — a button on the user's own message ("remember: ...") so the user can self-curate
4. System-prompt injection — top-N user facts spliced into the chat system prompt + agentic L2 user message at session start
5. Settings UI — view/edit/delete facts under `/app/settings`
6. (Optional repurpose decision) — either rewire the dead `/api/mistakes/save` + MistakeNoteDialog into the new flow, or delete them in a separate cleanup PR. Pick one and document.

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git checkout -b engineer-47
```

---

## Scope — build in order

### Part 1 — `user_facts` schema

New table:

```ts
export const userFacts = pgTable(
  "user_facts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    fact: text("fact").notNull(),                    // free-form sentence the agent stores
    category: text("category").$type<UserFactCategory>(),  // optional typed bucket
    source: text("source").$type<UserFactSource>().notNull(),  // 'user_explicit' | 'agent_inferred'
    confidence: real("confidence"),                  // 0..1; non-null when source='agent_inferred'

    // Engineer-evidence: where this fact came from. Optional.
    // Future: surface in /app/settings so the user can verify "Steadii thinks this because..."
    sourceChatMessageId: uuid("source_chat_message_id"),
    sourceInboxItemId: uuid("source_inbox_item_id"),

    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
  },
  (t) => ({
    userIdx: index("user_facts_user_idx")
      .on(t.userId, t.lastUsedAt)
      .where(sql`deleted_at IS NULL`),
    // De-dup soft index — if `fact` exact-matches and is non-deleted,
    // upsert instead of insert. Strict match keeps the impl trivial;
    // semantic dedup is an LLM call we'd rather do in the tool.
    userFactSoftUnique: uniqueIndex("user_facts_user_fact_unique")
      .on(t.userId, t.fact)
      .where(sql`deleted_at IS NULL`),
  })
);

export type UserFactCategory =
  | "schedule"            // "I work 9-5 PT weekdays"
  | "communication_style" // "formal with business, casual with friends"
  | "location_timezone"   // "I'm in Vancouver"
  | "academic"            // "Grade 12, UToronto CS in Sept"
  | "personal_pref"       // "don't notify me at night"
  | "other";

export type UserFactSource = "user_explicit" | "agent_inferred";
```

New migration file + journal entry per `feedback_prod_migration_manual.md`. Schema dump migrations as `0038_user_facts.sql`.

### Part 2 — Chat tool `save_user_fact`

New file: `lib/agent/tools/save-user-fact.ts`.

Mirror `lib/agent/tools/convert-timezone.ts` shape.

**Tool definition**:

```ts
name: "save_user_fact"
description: "Save a persistent fact about the user that should be remembered across chat sessions. Call this when the user reveals something Steadii should know for the long term — their schedule, communication style, location/timezone if they say it explicitly, academic situation, personal preferences (e.g. 'don't notify me at night'). Do NOT save transient state ('I'm tired today'), passwords/secrets, or anything they specifically said is private. The fact is shown back to the user in Settings — write it in their app locale, first-person ('私は…' / 'I…') is fine."
```

Input schema (zod):
- `fact: string` — the sentence to save (1..500 chars)
- `category: UserFactCategory | "other"` — see enum above; default "other"
- `source: "user_explicit" | "agent_inferred"` — default "agent_inferred" when LLM heuristically picked it up, "user_explicit" when user said "remember that..."

What it does:
1. Auth (chat orchestrator owns userId)
2. UPSERT into `user_facts` via `onConflictDoUpdate(target=[userId, fact], set={ lastUsedAt: now(), deletedAt: null })` — handles re-saves cleanly without duplicates
3. INSERT `email_audit_log` entry (action='user_fact_saved') with the chat-message context
4. Return `{ id, fact, category, source }` so the LLM can confirm

Register in `lib/agent/tool-registry.ts`. Available in EVERY chat session (no gating).

### Part 3 — System-prompt injection (top-N facts at session start)

Edit `lib/agent/prompts/main.ts` (engineer-45's USER CONTEXT injection point).

At chat-session-start, query:

```sql
SELECT fact, category 
FROM user_facts 
WHERE user_id = $1 AND deleted_at IS NULL 
ORDER BY last_used_at DESC NULLS LAST, created_at DESC
LIMIT 12;
```

Splice into the USER CONTEXT block:

```
USER FACTS (things Steadii has learned about you across past sessions):
- [schedule] I work 9-5 PT weekdays
- [location_timezone] I'm in Vancouver
- [communication_style] Formal with business, casual with friends
- [academic] Grade 12, UToronto CS in September
...

Use these as ambient context. Don't re-ask things already covered. If a fact looks stale or wrong, call save_user_fact with the corrected version (the soft-unique index upserts cleanly).
```

Cap at 12 facts to keep prompt cost predictable. If user has >12, oldest-touched drop off.

Same injection into `lib/agent/email/agentic-l2-prompt.ts` `buildAgenticL2UserMessage` — agentic L2 also benefits from knowing the user's persistent context (e.g., user's TZ from a saved fact, communication style for the draft).

Test: stub a user with 3 user_facts rows, verify the prompt contains the rendered fact list.

### Part 4 — Mark facts as used

When the agent's response cites a fact (or even when facts are injected), bump `last_used_at`. Cheapest implementation:

After each chat turn (in the orchestrator), UPDATE `user_facts SET last_used_at = now() WHERE user_id = $1 AND fact IN (<facts that appeared in the prompt>)`.

Skip if it's hot-path-sensitive; can be deferred to a post-response background task.

### Part 5 — Settings UI: view + edit + delete user facts

New file: `app/app/settings/facts/page.tsx` (or extend `/app/settings/how-your-agent-thinks` — engineer's call).

Renders:

```
あなたについて Steadii が覚えていること

  [schedule] 平日 9-5 PT で動いてます           [編集] [削除]
  [location_timezone] バンクーバーに住んでます    [編集] [削除]
  [communication_style] 仕事は丁寧、友達には砕けて [編集] [削除]
  ...

  + 新しく覚えてほしいことを追加
```

Each fact: source attribution (you said this / Steadii inferred this), createdAt, optional sourceChatMessageId link.

EN equivalent.

New server actions: `userFactUpsertAction(args)`, `userFactDeleteAction(id)`. Soft-delete (set `deletedAt`), don't hard-delete (might be useful for audit).

i18n keys under `settings.user_facts.*`.

### Part 6 — Repurpose decision (you choose, document it)

The dead `+ Steadii のメモに追加` pill was removed in PR #210; the underlying `MistakeNoteDialog`, `/api/mistakes/save`, `mistakes` table were left intact for this engineer. **Pick one**:

**Path A (repurpose)**: rename `mistakes` → `user_facts`, rewire `/api/mistakes/save` to write to the new schema, restore a renamed chat pill ("+ Steadii に覚えておいてもらう" / "+ Remember this") that opens the dialog. Reuses old infra.

**Path B (delete cleanup)**: in this PR or a follow-up sparring-inline, delete `MistakeNoteDialog`, `/api/mistakes/save`, the `mistakes` table (migration: DROP), the orphan i18n keys (`add_to_mistakes`, `save_mistake`, `mistake_note_dialog.*`). Path B is cleaner; user-facts surface lives at the chat-pill + tool + settings level, independent of the old code.

Lean: **Path B**. The mistakes-era schema is class-scoped (`class_id` foreign key) which doesn't fit user-facts. Rewiring is more work than redoing. Document in the PR which path you picked + why.

---

## Out of scope

- **Agent-driven proactive fact extraction** (background cron that mines past chat transcripts for facts) — interesting but separate engineer. For now facts come from the `save_user_fact` tool which the agent calls during a live conversation.
- **Multi-tenant facts** (sharing facts across multiple Steadii users on a team account) — α is solo.
- **Fact versioning** (history of how a fact changed) — soft-delete is enough; full versioning is overengineered.
- **Encrypted-at-rest secrets** — `save_user_fact` description says don't save passwords/secrets, but no DB-level encryption beyond Neon's defaults. Document this in the settings page UI: "Facts are stored in plaintext; don't save passwords or sensitive secrets."
- **Manual fact entry from the user side in chat** — Part 6 lays the groundwork (Path A or B); user-facing add-fact button is optional. Settings UI is enough for manual entry at α.

---

## Verification

1. `pnpm typecheck` clean
2. `pnpm vitest run` — all existing tests pass + new tests for:
   - `save_user_fact` tool — upserts cleanly on re-save; respects soft-delete
   - Prompt injection — top-12 facts render in expected format; orders by `last_used_at`
   - Settings page — user can edit + soft-delete; trying to access another user's facts 403s
3. **Migration 0038 applied** to prod (Ryuto runs in Neon SQL Editor, sparring assists with hash/journal sync — same pattern as 0037)
4. **Live dogfood**:
   - Open new chat, say "覚えておいて: 私は基本的にバンクーバー時間で時刻を話します"
   - Agent calls `save_user_fact` with that sentence
   - Refresh `/app/settings/facts` — see the fact rendered
   - Start a NEW chat session, say "明日の 10:30 の打ち合わせ、調整して" — agent should NOT re-ask which TZ; should default to PT per the saved fact
   - Edit the fact via settings, change to JST — next chat session uses JST

---

## Commit + PR

Branch: `engineer-47`. Push, sparring agent creates the PR.

Suggested PR title: `feat(memory): user_facts table + save_user_fact tool + settings UI + prompt injection (engineer-47)`

---

## Deliverable checklist

- [ ] `lib/db/schema.ts` — `user_facts` table + enums
- [ ] `lib/db/migrations/0038_user_facts.sql` + journal entry
- [ ] `lib/agent/tools/save-user-fact.ts` — new tool
- [ ] `lib/agent/tool-registry.ts` — register
- [ ] `lib/agent/prompts/main.ts` — fact injection into chat system prompt
- [ ] `lib/agent/email/agentic-l2-prompt.ts` — same injection into agentic L2 user message
- [ ] Orchestrator — bump `last_used_at` post-turn for facts that appeared in prompt
- [ ] `app/app/settings/facts/page.tsx` — view/edit/delete UI
- [ ] Server actions `userFactUpsertAction` + `userFactDeleteAction`
- [ ] `lib/i18n/translations/{ja,en}.ts` — new keys under `settings.user_facts.*`
- [ ] Decide Path A vs B for mistake-era cleanup; document in PR
- [ ] Tests per Verification section
- [ ] Live dogfood verified
