"use server";

import * as Sentry from "@sentry/nextjs";
import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  agentRules,
  type SenderRole,
} from "@/lib/db/schema";
import { auth } from "@/lib/auth/config";
import { logEmailAudit } from "./audit";
import { deleteGmailDraft } from "@/lib/agent/tools/gmail";
import { qstash } from "@/lib/integrations/qstash/client";
import { enqueueSendForDraft } from "./send-enqueue";
import { recordSenderFeedback } from "./feedback";
import { createClass } from "@/lib/classes/save";

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

// Approve → user clicked Send. Delegates to the shared enqueue helper
// with isAutomatic=false; revalidates the route paths so the UndoBar
// renders immediately.
export async function approveAgentDraftAction(
  draftId: string
): Promise<{ sendAt: Date; undoWindowSeconds: number }> {
  const userId = await getUserId();
  const result = await enqueueSendForDraft({
    userId,
    draftId,
    isAutomatic: false,
  });
  revalidatePath("/app/inbox");
  revalidatePath(`/app/inbox/${draftId}`);
  return result;
}

// Cancel the pending send. Calls QStash messages.delete to drop the
// scheduled execute publish, deletes the Gmail draft, transitions
// agent_draft status back to `pending` so the user can re-edit or re-
// send.
//
// Order: QStash cancel → Gmail delete → status flip. If the QStash
// message has already fired (between the user's click and our cancel
// call), the delete throws and we swallow it — the execute route's
// idempotency gate (`status !== 'sent_pending'`) catches the race
// because we set status='pending' immediately after, sub-second after
// the QStash call. Race window is acceptable for α.
export async function cancelPendingSendAction(draftId: string): Promise<void> {
  const userId = await getUserId();
  const { draft } = await loadDraftAndInbox(userId, draftId);
  if (draft.status !== "sent_pending") return;

  if (draft.qstashMessageId) {
    try {
      await qstash().messages.delete(draft.qstashMessageId);
    } catch (err) {
      // Two failure modes are normal here:
      //   1. message already fired — the execute route will hit the
      //      status gate (we flip to 'pending' below) and skip.
      //   2. QStash transient error — same outcome, the status flip
      //      still wins the race.
      // Log at warning so we can spot pathological misuse but don't
      // block the user.
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "send_execute", op: "qstash_cancel" },
        user: { id: userId },
        extra: { draftId: draft.id },
      });
    }
  }

  if (draft.gmailDraftId) {
    try {
      await deleteGmailDraft(userId, draft.gmailDraftId);
    } catch (err) {
      Sentry.captureException(err, {
        tags: { feature: "send_execute", op: "cancel_delete_draft" },
        user: { id: userId },
      });
    }
  }

  const now = new Date();
  await db
    .update(agentDrafts)
    .set({
      status: "pending",
      approvedAt: null,
      qstashMessageId: null,
      gmailDraftId: null,
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

// Cascade a dismiss/snooze across every pending draft in the same Gmail
// thread. Without this, dismissing one follow-up's draft just exposes the
// next-newest draft in the same thread (each follow-up email creates its
// own agent_draft) and the user has to keep clicking Skip on what looks
// like the same card. The dedup at queue-build time (PR #156's
// dedupePendingDraftsByThread) collapses to one card visually but doesn't
// flip the underlying rows — so the next render picks the next pending.
//
// `inboxItemMode` is what to set on the inbox_items: "dismissed" mirrors
// the legacy single-row dismiss behavior, "snoozed" mirrors the legacy
// 24h-snooze path. resolvedAt = now for dismiss, snooze-until for snooze.
//
// Edge: when threadExternalId is null (rare, malformed Gmail headers),
// fall back to single-row update — dismissing every null-thread draft
// would over-cascade across unrelated items.
async function cascadeDismissThread(args: {
  userId: string;
  draftId: string;
  inboxItemId: string;
  threadExternalId: string | null;
  inboxItemMode: "dismissed" | "snoozed";
  inboxItemResolvedAt: Date;
}): Promise<void> {
  const now = new Date();

  if (!args.threadExternalId) {
    await db
      .update(agentDrafts)
      .set({ status: "dismissed", updatedAt: now })
      .where(eq(agentDrafts.id, args.draftId));
    await db
      .update(inboxItems)
      .set({
        status: args.inboxItemMode,
        resolvedAt: args.inboxItemResolvedAt,
        updatedAt: now,
      })
      .where(eq(inboxItems.id, args.inboxItemId));
    return;
  }

  const threadRows = await db
    .select({ id: inboxItems.id })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, args.userId),
        eq(inboxItems.threadExternalId, args.threadExternalId)
      )
    );
  const threadInboxItemIds = threadRows.map((r) => r.id);

  await db
    .update(agentDrafts)
    .set({ status: "dismissed", updatedAt: now })
    .where(
      and(
        eq(agentDrafts.userId, args.userId),
        inArray(agentDrafts.inboxItemId, threadInboxItemIds),
        eq(agentDrafts.status, "pending")
      )
    );

  await db
    .update(inboxItems)
    .set({
      status: args.inboxItemMode,
      resolvedAt: args.inboxItemResolvedAt,
      updatedAt: now,
    })
    .where(
      and(
        eq(inboxItems.userId, args.userId),
        inArray(inboxItems.id, threadInboxItemIds),
        eq(inboxItems.status, "open")
      )
    );
}

export async function dismissAgentDraftAction(draftId: string): Promise<void> {
  const userId = await getUserId();
  const { draft, inbox } = await loadDraftAndInbox(userId, draftId);
  const now = new Date();
  await cascadeDismissThread({
    userId,
    draftId: draft.id,
    inboxItemId: draft.inboxItemId,
    threadExternalId: inbox.threadExternalId,
    inboxItemMode: "dismissed",
    inboxItemResolvedAt: now,
  });
  // Feedback + audit are scoped to the originating draft only — recording
  // per-thread-mate would over-bias the sender model toward dismissal.
  await recordSenderFeedback({
    userId,
    senderEmail: inbox.senderEmail,
    senderDomain: inbox.senderDomain,
    proposedAction: draft.action,
    userResponse: "dismissed",
    inboxItemId: inbox.id,
    agentDraftId: draft.id,
  });
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
  const { draft, inbox } = await loadDraftAndInbox(userId, draftId);
  const until = new Date(untilIso);
  if (Number.isNaN(until.getTime())) throw new Error("Invalid snooze date");
  await cascadeDismissThread({
    userId,
    draftId: draft.id,
    inboxItemId: draft.inboxItemId,
    threadExternalId: inbox.threadExternalId,
    inboxItemMode: "snoozed",
    inboxItemResolvedAt: until,
  });
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
  const { draft, inbox } = await loadDraftAndInbox(userId, args.draftId);
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
  await recordSenderFeedback({
    userId,
    senderEmail: inbox.senderEmail,
    senderDomain: inbox.senderDomain,
    proposedAction: draft.action,
    userResponse: "edited",
    inboxItemId: inbox.id,
    agentDraftId: draft.id,
  });
  await logEmailAudit({
    userId,
    action: "email_l2_completed",
    result: "success",
    resourceId: draft.id,
    detail: { subAction: "edit_saved" },
  });
  revalidatePath(`/app/inbox/${draft.id}`);
}

// Role-picker writes here. Upserts into agent_rules for the sender's
// email (not the domain — picker is specifically "who is this one
// person"). When `classId` is supplied, also binds the inbox item to
// that class. When `newClassName` is supplied, creates the class first
// then binds — same path the syllabus auto-create uses.
export async function setSenderRoleAction(args: {
  senderEmail: string;
  role: SenderRole;
  inboxItemId?: string;
  classId?: string | null;
  newClassName?: string | null;
}): Promise<void> {
  const userId = await getUserId();
  const normalized = args.senderEmail.trim().toLowerCase();
  const now = new Date();

  let resolvedClassId: string | null = args.classId ?? null;
  if (!resolvedClassId && args.newClassName?.trim()) {
    const created = await createClass({
      userId,
      input: { name: args.newClassName.trim() },
    });
    resolvedClassId = created.id;
  }

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
    const update: Partial<typeof inboxItems.$inferInsert> = {
      senderRole: args.role,
      updatedAt: now,
    };
    if (resolvedClassId) update.classId = resolvedClassId;
    await db
      .update(inboxItems)
      .set(update)
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
      classId: resolvedClassId,
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

// polish-7 — clear all feedback rows for one (user, sender) pair.
// Powers the "this contact's history was wrong" reset affordance in
// Settings → Agent Rules → Recent feedback.
export async function clearSenderFeedbackAction(formData: FormData): Promise<void> {
  const userId = await getUserId();
  const senderEmail = String(formData.get("sender_email") ?? "").trim();
  if (!senderEmail) return;
  const { clearSenderFeedback } = await import("./feedback");
  await clearSenderFeedback({ userId, senderEmail });
  revalidatePath("/app/settings");
}
