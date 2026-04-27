import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems, sendQueue } from "@/lib/db/schema";
import { sendAndAudit } from "@/lib/agent/tools/gmail";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { recordSenderFeedback } from "@/lib/agent/email/feedback";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Dispatcher for the 20s undo window. Triggered by Upstash QStash on a
// cron schedule (configured in the QStash console — see DEPLOY.md).
// Recommended cadence: every 5 minutes. The 20s undo window is enforced
// client-side via send_at; this cron only drains rows whose window has
// already closed, so cadence affects time-from-send-click to Gmail API
// call but not the undo guarantee. Picks rows where send_at <= now()
// AND status='pending', calls Gmail's drafts.send, flips the agent_draft
// to 'sent', and the queue row to 'sent'. Failures bump attempt_count
// and surface via Sentry.
export async function POST(req: Request) {
  return Sentry.startSpan(
    {
      name: "cron.send_queue.tick",
      op: "cron",
    },
    async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const now = new Date();
      const due = await db
        .select()
        .from(sendQueue)
        .where(
          and(
            eq(sendQueue.status, "pending"),
            lte(sendQueue.sendAt, now)
          )
        )
        .limit(50);

      let sent = 0;
      let failed = 0;

      for (const row of due) {
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
        tickAt: now.toISOString(),
        due: due.length,
        sent,
        failed,
      });
    }
  );
}
