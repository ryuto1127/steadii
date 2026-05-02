import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  sendQueue,
  type SendQueueRow,
} from "@/lib/db/schema";
import { sendAndAudit } from "@/lib/agent/tools/gmail";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { recordSenderFeedback } from "@/lib/agent/email/feedback";
import { withHeartbeat } from "@/lib/observability/cron-heartbeat";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Cap on rows processed per tick. The cron cadence is 5 minutes; this
// is the safety lid so a backed-up queue can't cause one tick to exceed
// the Vercel function budget (and stall subsequent ticks behind it).
const MAX_ROWS_PER_TICK = 50;

// Anything 'processing' for longer than this is presumed to be from a
// crashed worker. Reverted to 'pending' (with attempt_count incremented
// so a persistently-crashing send eventually exhausts the 3-strike rule
// instead of looping forever). We accept the rare crash-mid-send risk
// of double-sending a single email; α scale (10 users) makes this
// acceptable per the polish-13b spec.
const STALE_PROCESSING_MINUTES = 5;

// Dispatcher for the 20s undo window. Triggered by Upstash QStash on a
// cron schedule (configured in the QStash console — see DEPLOY.md).
// Recommended cadence: every 5 minutes. The 20s undo window is enforced
// client-side via send_at; this cron only drains rows whose window has
// already closed, so cadence affects time-from-send-click to Gmail API
// call but not the undo guarantee.
//
// Concurrency: previous cron ticks that overlap (e.g. tick N+1 fires
// while tick N is still draining 50 rows) cannot double-send because
// each row is claimed atomically via UPDATE ... WHERE id = (SELECT id
// ... FOR UPDATE SKIP LOCKED). The losing tick simply skips past locked
// rows and finds nothing to send.
export async function POST(req: Request) {
  return withHeartbeat("send-queue", () =>
    Sentry.startSpan(
      {
        name: "cron.send_queue.tick",
        op: "cron",
      },
      async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const recovered = await sweepStaleProcessingClaims();

      let sent = 0;
      let failed = 0;
      let processed = 0;

      while (processed < MAX_ROWS_PER_TICK) {
        const row = await claimNextPending();
        if (!row) break;
        processed++;

        try {
          const { gmailMessageId } = await sendAndAudit(
            row.userId,
            row.gmailDraftId,
            row.agentDraftId
          );
          const updatedAt = new Date();
          await db
            .update(sendQueue)
            .set({
              status: "sent",
              attemptCount: row.attemptCount + 1,
              attemptedAt: updatedAt,
              sentGmailMessageId: gmailMessageId,
              updatedAt,
            })
            .where(eq(sendQueue.id, row.id));
          await db
            .update(agentDrafts)
            .set({
              status: "sent",
              sentAt: updatedAt,
              gmailSentMessageId: gmailMessageId,
              updatedAt,
            })
            .where(eq(agentDrafts.id, row.agentDraftId));

          // polish-7 — record the user's revealed preference now that
          // the send is final (past the undo window). auto_sent rows
          // get a separate response value so the L2 prior can tell the
          // staged-autonomy path apart from explicit user sends.
          const [draftRow] = await db
            .select({
              action: agentDrafts.action,
              autoSent: agentDrafts.autoSent,
              inboxItemId: agentDrafts.inboxItemId,
              senderEmail: inboxItems.senderEmail,
              senderDomain: inboxItems.senderDomain,
            })
            .from(agentDrafts)
            .innerJoin(inboxItems, eq(inboxItems.id, agentDrafts.inboxItemId))
            .where(eq(agentDrafts.id, row.agentDraftId))
            .limit(1);
          if (draftRow) {
            await recordSenderFeedback({
              userId: row.userId,
              senderEmail: draftRow.senderEmail,
              senderDomain: draftRow.senderDomain,
              proposedAction: draftRow.action,
              userResponse: draftRow.autoSent ? "auto_sent" : "sent",
              inboxItemId: draftRow.inboxItemId,
              agentDraftId: row.agentDraftId,
            });
          }
          sent++;
        } catch (err) {
          failed++;
          Sentry.captureException(err, {
            tags: { feature: "send_queue_cron" },
            user: { id: row.userId },
            extra: { agentDraftId: row.agentDraftId },
          });
          const updatedAt = new Date();
          const nextAttempt = row.attemptCount + 1;
          // 3-strike rule: after 3 failed attempts, mark failed so the
          // cron stops retrying on each tick. The user can manually re-
          // send from the Inbox detail page.
          const newStatus = nextAttempt >= 3 ? "failed" : "pending";
          await db
            .update(sendQueue)
            .set({
              status: newStatus,
              attemptCount: nextAttempt,
              attemptedAt: updatedAt,
              lastError: err instanceof Error ? err.message : String(err),
              updatedAt,
            })
            .where(eq(sendQueue.id, row.id));
        }
      }

      return NextResponse.json({
        tickAt: new Date().toISOString(),
        recovered,
        processed,
        sent,
        failed,
      });
      }
    )
  );
}

// Atomically claim one pending send-queue row. Uses Postgres'
// `SELECT ... FOR UPDATE SKIP LOCKED` so concurrent cron ticks (e.g.
// when a slow tick overlaps the next one) don't both pick up the same
// row. Each call returns at most one row; concurrent callers each get
// a different row (or null if everything is locked or empty).
//
// Implemented as a raw UPDATE...WHERE id = (SELECT ... FOR UPDATE SKIP
// LOCKED) followed by a typed SELECT. The two-query split is so we get
// drizzle's snake_case → camelCase column mapping without aliasing the
// 13-column RETURNING clause by hand.
async function claimNextPending(): Promise<SendQueueRow | null> {
  const result = await db.execute<{ id: string }>(sql`
    UPDATE ${sendQueue}
    SET
      status = 'processing',
      processing_started_at = now(),
      updated_at = now()
    WHERE id = (
      SELECT id FROM ${sendQueue}
      WHERE status = 'pending'
        AND send_at <= now()
      ORDER BY send_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);
  const rows = (result as unknown as { rows: { id: string }[] }).rows ?? [];
  const claimedId = rows[0]?.id;
  if (!claimedId) return null;
  const [row] = await db
    .select()
    .from(sendQueue)
    .where(eq(sendQueue.id, claimedId))
    .limit(1);
  return row ?? null;
}

// Recover rows held in 'processing' by a presumed-dead worker. Each
// recovered row has its attempt_count bumped so a persistently-crashing
// send eventually trips the 3-strike rule rather than looping forever.
//
// Returns the number of rows recovered (used for observability in the
// cron response payload).
async function sweepStaleProcessingClaims(): Promise<number> {
  const staleFloor = new Date(
    Date.now() - STALE_PROCESSING_MINUTES * 60 * 1000
  );
  const result = await db.execute(sql`
    UPDATE ${sendQueue}
    SET
      status = CASE
        WHEN attempt_count + 1 >= 3 THEN 'failed'
        ELSE 'pending'
      END,
      attempt_count = attempt_count + 1,
      attempted_at = now(),
      last_error = 'stale processing claim — presumed worker crash',
      updated_at = now()
    WHERE status = 'processing'
      AND processing_started_at < ${staleFloor.toISOString()}::timestamptz
  `);
  return (result as unknown as { rowCount?: number }).rowCount ?? 0;
}
