import * as Sentry from "@sentry/nextjs";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems } from "@/lib/db/schema";
import { sendAndAudit } from "@/lib/agent/tools/gmail";
import { verifyQStashSignature } from "@/lib/integrations/qstash/verify";
import { recordSenderFeedback } from "@/lib/agent/email/feedback";
import { recordSenderEvent } from "@/lib/agent/learning/sender-confidence";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Post-α #6 — per-draft execute endpoint, hit by QStash after the
// `delay = users.undo_window_seconds` set at publish time. Replaces the
// /api/cron/send-queue polling drain. The endpoint is idempotent: a
// retried QStash delivery (5xx → automatic retry; out-of-order; cancel-
// then-fire race) checks agent_drafts.status and exits cleanly if the
// draft has moved out of `sent_pending`.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ draftId: string }> }
) {
  return Sentry.startSpan(
    { name: "app.send.execute", op: "http.server" },
    async () => {
      const rawBody = await req.text();
      if (!(await verifyQStashSignature(req, rawBody))) {
        return NextResponse.json({ error: "unauthorized" }, { status: 401 });
      }

      const { draftId } = await params;

      // Idempotency gate. The execute path only runs when the draft is
      // still `sent_pending`. Any other status means cancel / dismiss /
      // a previous successful send already moved it on, so we exit 200
      // (so QStash records delivery and stops retrying).
      const [draft] = await db
        .select()
        .from(agentDrafts)
        .where(eq(agentDrafts.id, draftId))
        .limit(1);
      if (!draft) {
        return NextResponse.json({ skipped: true, reason: "not_found" });
      }
      if (draft.status !== "sent_pending") {
        return NextResponse.json({ skipped: true, reason: draft.status });
      }
      if (!draft.gmailDraftId) {
        // Defensive — every sent_pending row written by the new path
        // sets gmail_draft_id atomically. Hitting this means a legacy
        // pre-migration row leaked through, which is unrecoverable from
        // here (no draft id to send). Fail loud so we see it.
        Sentry.captureMessage("send_execute: sent_pending without gmail_draft_id", {
          level: "error",
          tags: { feature: "send_execute" },
          extra: { draftId },
        });
        return NextResponse.json(
          { skipped: true, reason: "missing_gmail_draft_id" },
          { status: 500 }
        );
      }

      try {
        const { gmailMessageId } = await sendAndAudit(
          draft.userId,
          draft.gmailDraftId,
          draft.id
        );
        const now = new Date();
        await db
          .update(agentDrafts)
          .set({
            status: "sent",
            sentAt: now,
            gmailSentMessageId: gmailMessageId,
            updatedAt: now,
          })
          .where(eq(agentDrafts.id, draft.id));

        // polish-7 — same sender-feedback signal the legacy cron path
        // recorded. Keeps the per-sender prior the L2 classifier reads
        // when proposing actions for the same correspondent later.
        const [inbox] = await db
          .select({
            id: inboxItems.id,
            senderEmail: inboxItems.senderEmail,
            senderDomain: inboxItems.senderDomain,
          })
          .from(inboxItems)
          .where(eq(inboxItems.id, draft.inboxItemId))
          .limit(1);
        if (inbox) {
          // engineer-38 — capture (original, edited) pair when the user
          // edited the draft before sending. Wrapped in the existing
          // recordSenderFeedback try/catch (the helper itself never
          // throws) so a learner-side schema regression cannot block
          // the send path that already succeeded above.
          await recordSenderFeedback({
            userId: draft.userId,
            senderEmail: inbox.senderEmail,
            senderDomain: inbox.senderDomain,
            proposedAction: draft.action,
            userResponse: draft.autoSent ? "auto_sent" : "sent",
            inboxItemId: inbox.id,
            agentDraftId: draft.id,
            originalDraftBody: draft.originalDraftBody ?? null,
            editedBody: draft.draftBody ?? null,
          });
          // engineer-49 — feed the dynamic-confirmation learner. A
          // successful send always bumps the approve counter / streak;
          // if the user edited the body before sending, also bump
          // editedCount so the confidence formula counts it as a soft
          // negative (they trusted us enough to send but corrected).
          await recordSenderEvent({
            userId: draft.userId,
            senderEmail: inbox.senderEmail,
            actionType: draft.action,
            event: "approved",
          });
          const orig = (draft.originalDraftBody ?? "").trim();
          const edited = (draft.draftBody ?? "").trim();
          if (orig.length > 0 && edited.length > 0 && orig !== edited) {
            await recordSenderEvent({
              userId: draft.userId,
              senderEmail: inbox.senderEmail,
              actionType: draft.action,
              event: "edited",
            });
          }
        }

        return NextResponse.json({ sent: true, gmailMessageId });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "send_execute" },
          user: { id: draft.userId },
          extra: { draftId: draft.id },
        });
        // Return 5xx so QStash auto-retries (up to the publish-time
        // `retries: 3`). The idempotency gate at the top blocks any
        // double-send if a retry races with a manual fix.
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "send_failed" },
          { status: 500 }
        );
      }
    }
  );
}
