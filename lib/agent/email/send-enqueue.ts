import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems, users } from "@/lib/db/schema";
import { createGmailDraft } from "@/lib/agent/tools/gmail";
import { qstash } from "@/lib/integrations/qstash/client";
import { env } from "@/lib/env";
import { logEmailAudit } from "./audit";

// Shared core for "the user (or the orchestrator) decided this draft
// should go". Used by:
// - approveAgentDraftAction (server action, user clicked Send)
// - W4.3 staged-autonomy auto-send path (orchestrator, no user click)
//
// Post-α #6 (delayed-message pattern): instead of inserting a row into
// send_queue and waiting for a polling cron to drain it, we publish a
// single QStash message with `delay = users.undo_window_seconds`. QStash
// fires the configured URL after the delay, which calls the execute
// route that promotes the Gmail draft to sent. The qstashMessageId is
// stored on agent_drafts so the cancel path can call
// `messages.delete(messageId)`.
//
// `isAutomatic=true` sets agent_drafts.auto_sent so downstream UI /
// digest can label it distinctly. The undo window is identical for both
// paths — auto-sent drafts still respect the per-user recall window.
export type EnqueueSendResult = {
  sendAt: Date;
  undoWindowSeconds: number;
};

export async function enqueueSendForDraft(args: {
  userId: string;
  draftId: string;
  isAutomatic: boolean;
}): Promise<EnqueueSendResult> {
  const [row] = await db
    .select({ draft: agentDrafts, inbox: inboxItems })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(eq(agentDrafts.id, args.draftId))
    .limit(1);
  if (!row) throw new Error("Draft not found");
  const { draft, inbox } = row;

  if (draft.userId !== args.userId) {
    throw new Error("Draft does not belong to this user");
  }
  if (draft.status !== "pending" && draft.status !== "edited") {
    throw new Error(`Draft is already ${draft.status}`);
  }
  if (draft.action !== "draft_reply") {
    throw new Error("Only draft_reply actions can be sent");
  }
  if (!draft.draftBody || !draft.draftSubject || draft.draftTo.length === 0) {
    throw new Error("Draft is incomplete — missing to / subject / body");
  }

  const [userRow] = await db
    .select({ undoWindowSeconds: users.undoWindowSeconds })
    .from(users)
    .where(eq(users.id, args.userId))
    .limit(1);
  const undoWindowSeconds = userRow?.undoWindowSeconds ?? 10;

  const { gmailDraftId } = await createGmailDraft(args.userId, {
    to: draft.draftTo,
    cc: draft.draftCc,
    subject: draft.draftSubject,
    body: draft.draftBody,
    inReplyTo: draft.draftInReplyTo ?? null,
    threadId: inbox.threadExternalId ?? null,
  });

  const publishRes = await qstash().publishJSON({
    url: `${env().APP_URL}/api/send/execute/${draft.id}`,
    delay: undoWindowSeconds,
    retries: 3,
  });

  const now = new Date();
  const sendAt = new Date(now.getTime() + undoWindowSeconds * 1000);

  await db
    .update(agentDrafts)
    .set({
      status: "sent_pending",
      approvedAt: now,
      autoSent: args.isAutomatic,
      qstashMessageId: publishRes.messageId,
      gmailDraftId,
      updatedAt: now,
    })
    .where(eq(agentDrafts.id, draft.id));

  await logEmailAudit({
    userId: args.userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: draft.id,
    detail: {
      subAction: args.isAutomatic ? "auto_send" : "approve",
      undoWindowSeconds,
      gmailDraftId,
      qstashMessageId: publishRes.messageId,
    },
  });

  return { sendAt, undoWindowSeconds };
}
