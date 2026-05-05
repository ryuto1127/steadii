# Post-α #6 — Send-queue refactor: delayed-message pattern

**Read user-memory FIRST** before this doc:

- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_prod_migration_manual.md` — flag any new migration so sparring runs `pnpm db:migrate` post-merge
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/feedback_self_capture_verification_screenshots.md`
- `~/.claude/projects/-Users-ryuto-Documents-steadii/memory/project_steadii.md`

Reference shipped patterns:

- `lib/agent/email/send-enqueue.ts` — current `enqueueSendForDraft` (becomes the publish site)
- `app/api/cron/send-queue/route.ts` — current cron drain (becomes the per-message execute route)
- `lib/agent/email/draft-actions.ts` — current undo path (becomes QStash cancel call)
- `lib/integrations/qstash/verify.ts` — existing signature verify (reuse verbatim)

---

## Strategic context

The current send-queue is a polling pattern: every 5 minutes a cron sweeps the `send_queue` table for rows whose `send_at` has elapsed, processes them, marks them `sent`. Two problems:

1. **User-perceived latency** — the user clicks Send, waits out the undo window (default **10s**, configurable per-user via `users.undo_window_seconds`), then waits up to another 5 min before the email actually leaves Gmail. Average wait beyond undo: **2.5 minutes**.
2. **Wasted QStash budget** — 288 cron ticks/day fire even on days the user sends zero emails. The polling exists only because `send_at` is row-local; a global-time cron is the only way to discover them.

QStash supports per-message delivery with an `Upstash-Delay: <seconds>` header. Each send becomes a single delayed publish that QStash itself fires at the exact send time. No table polling, no cron, no average wait. The delay value comes from the same `users.undo_window_seconds` the existing path already reads — engineer must NOT hard-code seconds.

**Cost shift**: 288 fixed messages/day → ~5 messages/day per active user (at α). Net **decrease** in QStash usage.

**Out of scope** (defer):
- Dropping the `send_queue` table — keep for now, just stop writing to it. Separate deprecation cycle once we've run on the new path for ≥2 weeks with no incidents.
- Migration of in-flight `send_queue` rows at deploy time. Deploy when the queue is naturally empty (any time of day will do — drain cycle is 5 min).
- Adding QStash to draft-creation paths (Gmail draft creation stays synchronous).

---

## Setup

```bash
cd /Users/ryuto/Documents/steadii
git fetch origin
git checkout main
git pull origin main
```

Most recent expected: PR #140 (DEPLOY.md ingest-sweep tighten) or any sparring inline after. If main isn't there, **STOP**.

Branch: `post-alpha-6-send-queue-delayed`. Don't push without Ryuto's explicit authorization.

---

## Architecture

### Publish path — `lib/agent/email/send-enqueue.ts`

Replace the `db.insert(sendQueue)` block with a QStash publish:

```ts
const publishRes = await qstash().publishJSON({
  url: `${env().APP_URL}/api/send/execute/${draft.id}`,
  delay: undoWindowSeconds, // seconds
  retries: 3,
});

await db
  .update(agentDrafts)
  .set({
    status: "sent_pending",
    approvedAt: now,
    autoSent: args.isAutomatic,
    qstashMessageId: publishRes.messageId,
    gmailDraftId, // already set elsewhere — moves from send_queue to agent_drafts
    updatedAt: now,
  })
  .where(eq(agentDrafts.id, draft.id));
```

The `publishRes.messageId` is what we use to cancel later.

### Execute route — `app/api/send/execute/[draftId]/route.ts` (NEW)

```ts
export async function POST(req, { params }) {
  if (!(await verifyQStashSignature(req, await req.text()))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const draftId = params.draftId;
  // Idempotency gate — if already sent or cancelled, skip silently.
  const [draft] = await db.select().from(agentDrafts).where(eq(agentDrafts.id, draftId)).limit(1);
  if (!draft || draft.status !== "sent_pending") {
    return NextResponse.json({ skipped: true, reason: draft?.status ?? "not_found" });
  }

  const { gmailMessageId } = await sendAndAudit(draft.userId, draft.gmailDraftId, draftId);
  await db.update(agentDrafts).set({ status: "sent", sentAt: new Date(), gmailSentMessageId: gmailMessageId }).where(eq(agentDrafts.id, draftId));

  // Sender-feedback signal — same as current cron path.
  await recordSenderFeedback({ ... });

  return NextResponse.json({ sent: true, gmailMessageId });
}
```

QStash automatically retries on 5xx. Idempotency via the status gate at the top — a retry that arrives after a successful send hits `status='sent'` and exits cleanly.

### Cancel path — `lib/agent/email/draft-actions.ts`

Replace `db.delete(sendQueue)` with QStash cancel:

```ts
if (draft.qstashMessageId) {
  try {
    await qstash().messages.delete(draft.qstashMessageId);
  } catch (err) {
    // If delete fails because the message already fired, that's fine —
    // the execute route's idempotency gate will catch it via the
    // status flip we do next.
    Sentry.captureException(err, { level: "warning", tags: { context: "qstash_cancel" } });
  }
}
await db.update(agentDrafts).set({ status: "cancelled" }).where(eq(agentDrafts.id, draft.id));
```

Order matters: status flip happens **after** the QStash cancel attempt. If the message fires between the cancel attempt and the status update, the execute route still sees `status='sent_pending'` and sends — race window is sub-second and acceptable for α.

(Stronger idempotency requires an additional `cancelled_at IS NULL` check inside the execute route's transaction. Add later if needed.)

---

## Schema migration `0031_send_queue_delayed_message.sql`

```sql
-- Track the QStash message id that will fire the actual send. Nullable
-- because legacy rows from the polling era won't have one.
ALTER TABLE agent_drafts ADD COLUMN qstash_message_id text;

-- Move gmail_draft_id from send_queue to agent_drafts so the execute
-- route can read both fields off the draft row directly.
ALTER TABLE agent_drafts ADD COLUMN gmail_draft_id text;

-- Backfill the existing in-flight rows so they don't get stranded.
UPDATE agent_drafts d
SET gmail_draft_id = q.gmail_draft_id
FROM send_queue q
WHERE q.agent_draft_id = d.id AND q.status IN ('pending', 'processing');
```

`send_queue` table is **kept** for historical audit. The cron route + writes to the table are deleted.

---

## Files

- `lib/agent/email/send-enqueue.ts` — publish instead of insert
- `lib/agent/email/draft-actions.ts` — cancel via QStash API instead of DELETE
- `app/api/send/execute/[draftId]/route.ts` — NEW, idempotent send
- `lib/integrations/qstash/client.ts` — NEW thin wrapper around `@upstash/qstash` (or extend existing if present)
- `app/api/cron/send-queue/route.ts` — DELETE
- `DEPLOY.md` §11 — remove send-queue cron schedule row, add deprecation note
- `lib/db/schema.ts` — `agent_drafts.qstashMessageId` + `gmailDraftId` columns
- `lib/db/migrations/0031_send_queue_delayed_message.sql` — migration

Sparring will:
- run `pnpm db:migrate` against prod post-merge
- delete the QStash `/api/cron/send-queue` schedule from console

---

## Tests

Aim: 915 stay green, +12 new across 3 files → **927+** total.

- `tests/send-execute-route.test.ts` (~5) — idempotency gate (already-sent / cancelled / not-found), happy-path send, QStash sig fail returns 401
- `tests/send-enqueue-delayed.test.ts` (~4) — publishes with correct delay, persists messageId, race with cancel returns sane state
- `tests/draft-cancel-qstash.test.ts` (~3) — cancel calls QStash delete, swallows already-fired error, status flips to cancelled

---

## Verification

Per AGENTS.md §13 — `preview_screenshot @ 1440×900` EN+JA:

- Inbox draft detail page with "Send" pressed → undo banner countdown
- Confirmed send, status flips to `sent` (Recent Activity entry appears)
- Cancel during undo, status flips to `cancelled`
- (Verifies the visible flow; the new code path is server-side and confirmed via tests + dev-server actual send)

For dev-side verification: with `QSTASH_TOKEN` set in `.env.local` (publish target = QStash production), sending a draft should produce a QStash message visible in the QStash console **Logs** tab firing after the user's undo window (default 10 seconds).

---

## Sequence after merge

1. Sparring `pnpm db:migrate` (additive)
2. Sparring deletes the QStash `/api/cron/send-queue` schedule from console
3. Monitor Sentry for `cron.send_queue.tick` spans — expect ZERO over the next hour (cron deleted)
4. Watch for `app.send.execute` (new) Sentry span / 200 responses
5. Manually send a draft → verify QStash console **Logs** shows the publish + delivery
6. After 2 weeks no incidents → separate PR drops the `send_queue` table

---

## Final report (per AGENTS.md §12)

- Branch / PR: `post-alpha-6-send-queue-delayed`
- Schema migration filename + columns added
- Cron route deleted + schedule deletion instructions
- Tests added (3 files, +12 tests target)
- **Migration flag**: yes — `lib/db/migrations/0031_send_queue_delayed_message.sql`. Sparring applies post-merge.
- **Memory entries to update**: `project_decisions.md` if any new locked decision; sparring snapshot updated.
- **QStash console deltas**: delete `/api/cron/send-queue` schedule (sparring will execute, not engineer).
