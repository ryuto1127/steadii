import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems, sendQueue, users } from "@/lib/db/schema";
import { createGmailDraft } from "@/lib/agent/tools/gmail";
import { logEmailAudit } from "./audit";

// Shared core for "the user (or the orchestrator) decided this draft
// should go". Used by:
// - approveAgentDraftAction (server action, user clicked Send)
// - W4.3 staged-autonomy auto-send path (orchestrator, no user click)
//
// Differences from a raw insert:
// - creates the Gmail draft via Gmail API first (so the queue row points
//   at a real draft id Gmail can resolve into a sent message)
// - upserts on (agent_draft_id) — same draft re-enqueued just resets
//   the row instead of failing the unique constraint
// - flips agent_drafts.status to 'sent_pending' atomically with the queue
//   write so the UI is never out of sync
//
// `isAutomatic=true` sets agent_drafts.auto_sent so downstream UI /
// digest can label it distinctly. The undo window is identical for both
// paths — auto-sent drafts still have the 20s recall window.
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
  const undoWindowSeconds = userRow?.undoWindowSeconds ?? 20;

  const { gmailDraftId } = await createGmailDraft(args.userId, {
    to: draft.draftTo,
    cc: draft.draftCc,
    subject: draft.draftSubject,
    body: draft.draftBody,
    inReplyTo: draft.draftInReplyTo ?? null,
    threadId: inbox.threadExternalId ?? null,
  });

  const now = new Date();
  const sendAt = new Date(now.getTime() + undoWindowSeconds * 1000);

  await db
    .insert(sendQueue)
    .values({
      userId: args.userId,
      agentDraftId: draft.id,
      gmailDraftId,
      sendAt,
      status: "pending",
    })
    .onConflictDoUpdate({
      target: sendQueue.agentDraftId,
      set: {
        gmailDraftId,
        sendAt,
        status: "pending",
        attemptCount: 0,
        attemptedAt: null,
        lastError: null,
        sentGmailMessageId: null,
        updatedAt: now,
      },
    });

  await db
    .update(agentDrafts)
    .set({
      status: "sent_pending",
      approvedAt: now,
      autoSent: args.isAutomatic,
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
    },
  });

  return { sendAt, undoWindowSeconds };
}
