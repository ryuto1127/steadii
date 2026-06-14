"use server";

import { auth } from "@/lib/auth/config";
import { restoreFromAutoArchive } from "@/lib/agent/email/auto-archive";
import { logEmailAudit } from "@/lib/agent/email/audit";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
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

// 見送る — row-level NEUTRAL clear from the inbox list (Action / All views).
// Flips inbox_items.status to the EXISTING 'dismissed' value so the row drops
// out of the open inbox queries (which all filter status='open'). Critically
// this is a "I handled / don't need this" clear, NOT a learning signal:
//   - it does NOT touch sender-confidence,
//   - it does NOT record any proactive/sender feedback,
//   - it does NOT touch agent_ignored_senders.
// Sender-learning stays exclusively behind the explicit ignore-sender /
// 今後は通知しない path. The update is scoped to the user's own OPEN, non-
// deleted row so it can't resurrect an archived/sent item or flip another
// user's row.
export async function dismissInboxItemAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const id = formData.get("id");
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("invalid id");
  }

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

  // Only audit when a row actually flipped (idempotent on double-submit /
  // already-cleared rows). Neutral action descriptor — no learning detail.
  if (updated.length > 0) {
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
