"use server";

import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  sendQueue,
  users,
  agentRules,
  type SenderRole,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";
import { logEmailAudit } from "./audit";
import {
  createGmailDraft,
  deleteGmailDraft,
} from "@/lib/agent/tools/gmail";

async function getUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  return session.user.id;
}

// Load the draft + inbox item for the current user. Enforces userId
// ownership so a draft belonging to another user can't be approved.
async function loadDraftAndInbox(userId: string, draftId: string) {
  const [row] = await db
    .select({
      draft: agentDrafts,
      inbox: inboxItems,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(and(eq(agentDrafts.id, draftId), eq(agentDrafts.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Draft not found");
  return row;
}

// Approve → create Gmail draft + enqueue a send_queue row with send_at
// = now + user.undo_window_seconds. Draft transitions to 'sent_pending'.
// Returns the undo-window deadline so the UI can render the countdown.
export async function approveAgentDraftAction(
  draftId: string
): Promise<{ sendAt: Date; undoWindowSeconds: number }> {
  const userId = await getUserId();
  const { draft, inbox } = await loadDraftAndInbox(userId, draftId);

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
    .where(eq(users.id, userId))
    .limit(1);
  const undoWindowSeconds = userRow?.undoWindowSeconds ?? 20;

  const { gmailDraftId } = await createGmailDraft(userId, {
    to: draft.draftTo,
    cc: draft.draftCc,
    subject: draft.draftSubject,
    body: draft.draftBody,
    inReplyTo: draft.draftInReplyTo ?? null,
    threadId: inbox.threadExternalId ?? null,
  });

  const now = new Date();
  const sendAt = new Date(now.getTime() + undoWindowSeconds * 1000);

  // Upsert pattern: UNIQUE on agent_draft_id means if a prior send_queue
  // row exists (e.g. stale from a prior approve that didn't complete), we
  // overwrite. That shouldn't happen because 'approved' doesn't allow
  // re-approval, but defense-in-depth.
  await db
    .insert(sendQueue)
    .values({
      userId,
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
      updatedAt: now,
    })
    .where(eq(agentDrafts.id, draft.id));

  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: draft.id,
    detail: {
      subAction: "approve",
      undoWindowSeconds,
      gmailDraftId,
    },
  });

  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${draft.id}`);
  return { sendAt, undoWindowSeconds };
}

// Cancel the pending send. Deletes the send_queue row + Gmail draft,
// transitions agent_draft status back to 'approved' so the user can
// re-edit or re-send.
export async function cancelPendingSendAction(draftId: string): Promise<void> {
  const userId = await getUserId();
  const { draft } = await loadDraftAndInbox(userId, draftId);
  if (draft.status !== "sent_pending") return;

  const [queueRow] = await db
    .select()
    .from(sendQueue)
    .where(eq(sendQueue.agentDraftId, draft.id))
    .limit(1);
  if (queueRow) {
    try {
      await deleteGmailDraft(userId, queueRow.gmailDraftId);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "email_send_queue", op: "cancel_delete_draft" },
        user: { id: userId },
      });
    }
    await db.delete(sendQueue).where(eq(sendQueue.id, queueRow.id));
  }

  const now = new Date();
  await db
    .update(agentDrafts)
    .set({
      status: "pending",
      approvedAt: null,
      updatedAt: now,
    })
    .where(eq(agentDrafts.id, draft.id));

  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: draft.id,
    detail: { subAction: "cancel_pending_send" },
  });
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${draft.id}`);
}

export async function dismissAgentDraftAction(draftId: string): Promise<void> {
  const userId = await getUserId();
  const { draft } = await loadDraftAndInbox(userId, draftId);
  const now = new Date();
  await db
    .update(agentDrafts)
    .set({ status: "dismissed", updatedAt: now })
    .where(eq(agentDrafts.id, draft.id));
  await db
    .update(inboxItems)
    .set({ status: "dismissed", resolvedAt: now, updatedAt: now })
    .where(eq(inboxItems.id, draft.inboxItemId));
  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: draft.id,
    detail: { subAction: "dismiss" },
  });
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${draft.id}`);
}

export async function snoozeAgentDraftAction(
  draftId: string,
  untilIso: string
): Promise<void> {
  const userId = await getUserId();
  const { draft } = await loadDraftAndInbox(userId, draftId);
  const until = new Date(untilIso);
  if (Number.isNaN(until.getTime())) throw new Error("Invalid snooze date");
  const now = new Date();
  await db
    .update(agentDrafts)
    .set({ status: "dismissed", updatedAt: now })
    .where(eq(agentDrafts.id, draft.id));
  await db
    .update(inboxItems)
    .set({ status: "snoozed", resolvedAt: until, updatedAt: now })
    .where(eq(inboxItems.id, draft.inboxItemId));
  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: draft.id,
    detail: { subAction: "snooze", until: until.toISOString() },
  });
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${draft.id}`);
}

// Edit mode save — overwrites the draft body/subject. Resets status to
// 'edited' so it's distinguishable from a fresh LLM output, but the send
// path treats edited and pending identically.
export async function saveDraftEditsAction(args: {
  draftId: string;
  subject: string;
  body: string;
  to: string[];
  cc?: string[];
}): Promise<void> {
  const userId = await getUserId();
  const { draft } = await loadDraftAndInbox(userId, args.draftId);
  if (draft.status === "sent" || draft.status === "sent_pending") {
    throw new Error("Cannot edit a sent draft");
  }
  const now = new Date();
  await db
    .update(agentDrafts)
    .set({
      draftSubject: args.subject,
      draftBody: args.body,
      draftTo: args.to,
      draftCc: args.cc ?? [],
      status: "edited",
      updatedAt: now,
    })
    .where(eq(agentDrafts.id, draft.id));
  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: draft.id,
    detail: { subAction: "edit_saved" },
  });
  revalidatePath(`/app/inbox/${draft.id}`);
}

// Role-picker dialog writes here. Upserts into agent_rules for the
// sender's email (not the domain — picker is specifically "who is this
// one person"). Domain-level learning can come post-α.
export async function setSenderRoleAction(args: {
  senderEmail: string;
  role: SenderRole;
  inboxItemId?: string; // when called from the inbox detail page, update that item too
}): Promise<void> {
  const userId = await getUserId();
  const normalized = args.senderEmail.trim().toLowerCase();
  const now = new Date();

  await db
    .insert(agentRules)
    .values({
      userId,
      scope: "sender",
      matchValue: args.senderEmail,
      matchNormalized: normalized,
      senderRole: args.role,
      source: "manual",
      reason: `Set via role picker on first-time sender (${args.senderEmail})`,
      enabled: true,
    })
    .onConflictDoUpdate({
      target: [
        agentRules.userId,
        agentRules.scope,
        agentRules.matchNormalized,
      ],
      set: {
        senderRole: args.role,
        source: "manual",
        enabled: true,
        deletedAt: null,
        updatedAt: now,
      },
    });

  if (args.inboxItemId) {
    await db
      .update(inboxItems)
      .set({ senderRole: args.role, updatedAt: now })
      .where(
        and(
          eq(inboxItems.id, args.inboxItemId),
          eq(inboxItems.userId, userId)
        )
      );
  }

  await logEmailAudit({
    userId,
    action: "email_rule_applied",
    result: "success",
    detail: {
      subAction: "role_picker",
      senderEmail: normalized,
      role: args.role,
    },
  });
  revalidatePath("/app/inbox");
  if (args.inboxItemId) revalidatePath(`/app/inbox/${args.inboxItemId}`);
}

export async function deleteAgentRuleAction(ruleId: string): Promise<void> {
  const userId = await getUserId();
  const now = new Date();
  await db
    .update(agentRules)
    .set({ deletedAt: now, enabled: false, updatedAt: now })
    .where(and(eq(agentRules.id, ruleId), eq(agentRules.userId, userId)));
  revalidatePath("/app/settings");
}
