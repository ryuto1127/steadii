# Polish-13b — Race conditions (CRITICAL/HIGH)

Two production race conditions surfaced in the multi-agent audit on 2026-04-28. Both fire under realistic α conditions (10 dogfood users), both have user-visible consequences (duplicate proposals burning credits, duplicate emails breaking trust). Fix before α invite send.

This PR depends on polish-13a (i18n parity) being on main first. If main is at polish-13a or later, proceed; otherwise STOP and wait.

## Setup

```
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
git status   # clean
git log --oneline -5
```

Branch: `polish-13b-race-conditions`. Don't push without Ryuto's explicit authorization.

---

## Issue 1 — Proactive scanner debounce: in-memory race across serverless instances (CRITICAL)

### Current state

`lib/agent/proactive/scanner.ts:65-96` has a per-user 5-minute debounce check, but the check is **in-memory within the running serverless instance**. Vercel runs multiple isolated instances behind a load balancer, so two near-simultaneous events for the same user (e.g., a calendar create + a syllabus save) can land on different instances. Each instance independently queries the DB for recent `agent_events` rows, sees none within the window, and runs the full scanner — duplicate LLM calls, duplicate proposal generation work.

The unique index on `agent_proposals (user_id, dedup_key)` prevents duplicate proposals from being inserted, so the user-visible damage is limited to:
- Duplicate LLM cost (proactive_proposal task burns credits twice for the same issue)
- Duplicate "Steadii noticed" entries appearing then collapsing (visible flicker if the second instance races to insert)
- Wasted compute / Sentry noise

### Fix — DB-level claim via `agent_events`

The `agent_events` table already has a `status` column (`'running' | 'analyzed' | 'error'`). Use it as a distributed lock:

1. **At scanner entry**, before any work, attempt to claim:
   ```ts
   // Pseudocode — adapt to existing scanner.ts shape
   const claim = await db
     .insert(agentEvents)
     .values({
       userId,
       trigger,
       status: "running",
       createdAt: now,
     })
     .returning({ id: agentEvents.id })
     .onConflictDoNothing();   // requires a unique partial index — see migration
   ```

2. **Add a unique partial index** in a new migration:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS agent_events_running_per_user_idx
     ON agent_events (user_id)
     WHERE status = 'running';
   ```
   This is a partial unique index — only one `running` row per user is allowed, but historical `analyzed` / `error` rows are unconstrained.

3. **At the start of `runScanner`**, after successful claim:
   - Proceed with snapshot + rules + proposal generation (existing flow)
   - On success: `UPDATE agent_events SET status='analyzed', completed_at=now WHERE id=:claimId`
   - On error: `UPDATE agent_events SET status='error', error_message=..., completed_at=now WHERE id=:claimId`

4. **If claim fails** (unique conflict): another instance is already running for this user. Log + return early. No duplicate scan.

5. **Replace the in-memory 5-min debounce** with the DB claim. The 5-min "don't re-run too soon" semantic is now enforced by checking `agent_events` for a recent `analyzed` row before claiming:
   ```ts
   const recent = await db
     .select()
     .from(agentEvents)
     .where(
       and(
         eq(agentEvents.userId, userId),
         eq(agentEvents.status, "analyzed"),
         gt(agentEvents.completedAt, sql`now() - interval '5 minutes'`)
       )
     )
     .limit(1);
   if (recent.length > 0 && trigger !== "cron.daily") return;
   ```
   Daily cron bypasses (per existing D1 spec).

6. **Stuck `running` rows** — if a serverless instance crashes mid-scan, its `running` row never transitions. Add a stale-claim sweep at scanner entry:
   ```ts
   // Anything 'running' for >10 minutes is presumed dead — flip to 'error'
   await db
     .update(agentEvents)
     .set({ status: "error", errorMessage: "stale running claim" })
     .where(
       and(
         eq(agentEvents.userId, userId),
         eq(agentEvents.status, "running"),
         lt(agentEvents.createdAt, sql`now() - interval '10 minutes'`)
       )
     );
   ```
   Run this BEFORE the claim attempt so a freshly-stuck row clears in the same call.

### Verification

- Add a unit test: simulate two concurrent `runScanner` calls for the same user, assert exactly one runs to completion and the other returns early
- Manual smoke: rapidly trigger 3+ writes (create calendar event 3 times in quick succession). Confirm Sentry / logs show only 1 scanner run, not 3

---

## Issue 2 — Send-queue double-send: overlapping cron runs (HIGH)

### Current state

`app/api/cron/send-queue/route.ts:35-66` runs every 5 minutes. The query selects all `status='pending' AND sendAt <= now()` rows and processes them sequentially. If a cron run takes longer than 5 minutes (e.g., 50 rows × Gmail API latency), the next cron tick fires while the first is still working. Both ticks see the same pending rows. Each tick's `UPDATE ... SET status='sent'` will have one winner per row, but if both call `sendAndAudit()` (Gmail API send) BEFORE the UPDATE returns, the user receives the same email twice.

### Fix — atomic claim per row

Replace the "select all + iterate" pattern with a per-row atomic claim:

```ts
// Pseudocode
async function claimNextPending(): Promise<SendQueueRow | null> {
  // Use UPDATE ... WHERE id = (SELECT id FROM ... LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *
  const claimed = await db.execute(sql`
    UPDATE send_queue
    SET status = 'processing', processing_started_at = now()
    WHERE id = (
      SELECT id FROM send_queue
      WHERE status = 'pending'
        AND send_at <= now()
      ORDER BY send_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);
  return claimed.rows[0] ?? null;
}

// In the cron loop:
while (true) {
  const row = await claimNextPending();
  if (!row) break;
  try {
    await sendAndAudit(row);
    await markSent(row.id);
  } catch (err) {
    await markFailed(row.id, err);
  }
}
```

Key points:

- **`SELECT ... FOR UPDATE SKIP LOCKED`** is the Postgres pattern that lets multiple workers safely consume from a queue table — each one claims a row exclusively, others skip past locked rows
- **Add a `processing` status** to the send_queue status enum. A row in `processing` is exclusively held by one cron tick. Transition rules:
  - `pending → processing` (claim)
  - `processing → sent` (success)
  - `processing → failed` (Gmail API error)
- **Stuck `processing` rows** — if a serverless instance dies mid-send, the row stays `processing` forever. Add a stale-claim sweep at cron entry (same pattern as scanner above): anything `processing` for >5 minutes presumed dead, flip back to `pending` for retry. Be careful — if the email actually sent before the crash, this will double-send. Mitigation: Gmail API has its own dedup via `threadId + Message-ID`, but at α scale we accept the rare crash-mid-send risk and prefer eventual delivery over silent loss.

### Migration

Add `processing` to the send_queue status enum + a `processing_started_at` timestamp column. New migration file under `lib/db/migrations/`.

### Verification

- Unit test simulating two concurrent calls to `claimNextPending` against a fixture row, assert only one returns the row
- Manual smoke: load the send queue with 5 fixture rows, run the cron endpoint twice in rapid succession (`curl /api/cron/send-queue` twice within 1 second), confirm each row is sent exactly once

---

## Out of scope

- **Inbox revalidate-not-awaited** (audit MEDIUM finding) — `revalidatePath()` is synchronous in Next.js, the perceived "race" is cache-layer propagation that application code can't control. Defer.
- **Stripe founding-member race** (audit MEDIUM finding) — only fires near user 100; α has 10 users. Post-α concern.
- **Digest cron timezone race** (audit MEDIUM finding) — DST transitions only, predictable rare events. Post-α.
- **OAuth token refresh dual-call** (audit LOW finding) — minor inefficiency, no data loss.
- **Scanner trigger fan-out silent error swallowing** — adjust later when we have α observability data showing it actually loses scans.

---

## Constraints

- Locked decisions in `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/` are sacred
- Pre-commit hooks must pass; no `--no-verify`
- Don't push without Ryuto's explicit authorization
- Migrations: generate with `pnpm db:generate`, name them descriptively, do NOT manually edit the snapshot
- The `agent_events.status` and `send_queue.status` enums are append-only — adding new variants is fine, removing existing ones is not
- The 5-min scanner debounce semantic stays the same (cron.daily bypasses, all other triggers respect it) — only the implementation moves from in-memory to DB
- Send-queue rows must NEVER skip a send because of a transient claim failure — failed claims should retry on the next cron tick, not silently drop

---

## Context files

- `lib/agent/proactive/scanner.ts` — primary fix site (Issue 1)
- `lib/db/schema.ts` — agent_events status enum, send_queue status enum (need to extend), partial unique index
- `app/api/cron/scanner/route.ts` — daily cron entry, may also need stale-claim sweep call
- `app/api/cron/send-queue/route.ts` — primary fix site (Issue 2)
- `lib/agent/email/send.ts` (or wherever `sendAndAudit` lives) — make sure mark-sent / mark-failed transitions are atomic
- `lib/db/migrations/` — new migration here
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_agent_model.md` — undo window + safety contract context

---

## Verification plan

1. `pnpm typecheck` — clean
2. `pnpm test` — green; new tests for the two race scenarios
3. `pnpm build` — clean
4. `pnpm db:generate` — confirm migration was generated
5. Migration application — Ryuto applies via `pnpm db:push` to the dev DB before testing
6. Concurrency test (manual): hit `/api/cron/scanner` and `/api/cron/send-queue` rapidly in sequence, confirm no double-execution / double-send

---

## When done

Report back with:
- Branch + final commit hash
- Migration file name (the new one)
- Verification log (typecheck, test, build, migration generate, manual concurrency smoke)
- Confirmation that:
  - Two concurrent `runScanner` calls produce exactly one scan
  - Two concurrent send-queue cron ticks produce exactly one send per row
  - Stale-claim sweep recovers stuck `running` and `processing` rows on next tick
- Any deviations from the brief + 1-line reason each

The next work unit is polish-13c (CSRF middleware + soft-delete filter). Fresh session.
