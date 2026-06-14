"use server";

import { auth } from "@/lib/auth/config";
import { restoreFromAutoArchive } from "@/lib/agent/email/auto-archive";
import { logEmailAudit } from "@/lib/agent/email/audit";
import { recordSenderFeedback } from "@/lib/agent/email/feedback";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems } from "@/lib/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

// Wave 5 — server action wrapping the restore helper. The Inbox Hidden
// view renders a Restore button per row that posts here; the helper
// flips status, stamps user_restored_at, and seeds the learned
// agent_rules row so similar items don't auto-hide again. The path
// revalidation ensures the freshly-restored row shows back up in the
// default inbox view immediately.
export async function restoreAutoArchivedAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("invalid id");
  }
  const result = await restoreFromAutoArchive(session.user.id, id);
  if (!result.ok) {
    throw new Error(`Restore failed: ${result.reason}`);
  }
  revalidatePath("/app/inbox");
  revalidatePath("/app");
}

// Flip an OPEN, non-deleted inbox row owned by this user to the existing
// 'dismissed' status. Shared by both row-level buttons (確認済み / 不要); the
// status write is identical, only the audit + optional feedback differ.
// Returns the flipped row id (or null when nothing matched — idempotent on
// double-submit / already-cleared rows).
async function clearInboxRow(
  userId: string,
  id: string
): Promise<string | null> {
  const updated = await db
    .update(inboxItems)
    .set({ status: "dismissed" })
    .where(
      and(
        eq(inboxItems.id, id),
        eq(inboxItems.userId, userId),
        eq(inboxItems.status, "open"),
        isNull(inboxItems.deletedAt)
      )
    )
    .returning({ id: inboxItems.id });
  return updated[0]?.id ?? null;
}

// 確認済み — row-level NEUTRAL clear from the inbox list (Action / All views).
// Flips inbox_items.status to the EXISTING 'dismissed' value so the row drops
// out of the open inbox queries (which all filter status='open'). This is a
// pure "I saw / handled this" clear, NOT a learning signal:
//   - it does NOT touch sender-confidence,
//   - it does NOT record any proactive/sender feedback,
//   - it does NOT touch agent_ignored_senders.
// Sender-learning stays exclusively behind the explicit ignore-sender /
// 今後は通知しない path. Scoped to the user's own OPEN, non-deleted row so it
// can't resurrect an archived/sent item or flip another user's row.
export async function dismissInboxItemAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("invalid id");
  }

  const flippedId = await clearInboxRow(userId, id);
  // Only audit when a row actually flipped (idempotent on double-submit /
  // already-cleared rows). Neutral action descriptor — no learning detail.
  if (flippedId) {
    await logEmailAudit({
      userId,
      action: "email_item_dismissed",
      result: "success",
      resourceId: id,
      detail: { source: "inbox_list_row" },
    });
  }

  revalidatePath("/app/inbox");
  revalidatePath("/app");
}

// 不要 — row-level SOFT-NEGATIVE clear from the inbox list. Same status flip
// as 確認済み (status='dismissed') PLUS a record-only soft-negative feedback
// signal for the row's sender.
//
// RECORD-ONLY by contract — recordSenderFeedback is a pure INSERT into
// agent_sender_feedback. We deliberately do NOT call recordSenderEvent (the
// sender-confidence learner that the full dismiss path uses to demote a
// sender), so logging this signal can never flip a sender into always_review
// or activate any suppression threshold. Behavior change is deferred; the row
// is logged for later analysis only. agent_ignored_senders is never touched.
export async function markInboxItemNotNeededAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("invalid id");
  }

  const flippedId = await clearInboxRow(userId, id);
  if (flippedId) {
    // Resolve the sender + latest draft action for the soft-negative row.
    // Best-effort: a missing/odd row just skips the feedback write — the
    // status clear already happened and must not be blocked.
    const [row] = await db
      .select({
        senderEmail: inboxItems.senderEmail,
        senderDomain: inboxItems.senderDomain,
        draftAction: agentDrafts.action,
      })
      .from(inboxItems)
      .leftJoin(agentDrafts, eq(agentDrafts.inboxItemId, inboxItems.id))
      .where(and(eq(inboxItems.id, id), eq(inboxItems.userId, userId)))
      .orderBy(desc(agentDrafts.createdAt))
      .limit(1);
    if (row?.senderEmail) {
      await recordSenderFeedback({
        userId,
        senderEmail: row.senderEmail,
        senderDomain: row.senderDomain,
        // notify_only is the proposedAction for rows the user marks not-needed
        // from the list when no draft exists; an existing draft's action wins.
        proposedAction: row.draftAction ?? "notify_only",
        userResponse: "dismissed",
        inboxItemId: id,
        agentDraftId: null,
      });
    }
    await logEmailAudit({
      userId,
      action: "email_item_marked_not_needed",
      result: "success",
      resourceId: id,
      detail: { source: "inbox_list_row" },
    });
  }

  revalidatePath("/app/inbox");
  revalidatePath("/app");
}
