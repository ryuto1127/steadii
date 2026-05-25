"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { agentDrafts, agentNotifications } from "@/lib/db/schema";
import { logEmailAudit } from "@/lib/agent/email/audit";
import {
  loadActivityRows,
  type ActivityCursor,
  type ActivityKind,
} from "@/lib/activity/load";

// Pagination — the client load-more button hits this with the cursor of
// the last row currently rendered, gets the next page back, and appends.
// Returns rows already serialized for the wire (Date → ISO) so the
// timeline component can rehydrate without extra plumbing.

const cursorSchema = z.object({
  occurredAt: z.string(),
  id: z.string(),
});

const argsSchema = z.object({
  cursor: cursorSchema.nullable(),
  limit: z.number().int().min(1).max(100).optional(),
});

export type SerializedRow = {
  id: string;
  occurredAt: string;
  kind: ActivityKind;
  primary: string;
  secondary?: string;
  detailHref?: string;
  // Round 5 — when set, the row renders an inline undo button. Wire
  // shape is the bare notification id; the client component calls the
  // server action with it.
  undoableNotificationId?: string;
};

export async function loadActivityPage(args: {
  cursor: ActivityCursor | null;
  limit?: number;
}): Promise<{ rows: SerializedRow[]; nextCursor: ActivityCursor | null }> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const parsed = argsSchema.parse(args);
  const { rows, nextCursor } = await loadActivityRows({
    userId: session.user.id,
    cursor: parsed.cursor,
    limit: parsed.limit ?? 30,
  });
  return {
    rows: rows.map((r) => ({
      id: r.id,
      occurredAt: r.occurredAt.toISOString(),
      kind: r.kind,
      primary: r.primary,
      secondary: r.secondary,
      detailHref: r.detailHref,
      undoableNotificationId: r.undoableNotificationId,
    })),
    nextCursor,
  };
}

// ─── Round 5 notify-with-undo ─────────────────────────────────────────

const undoArgsSchema = z
  .object({
    notificationId: z.string().uuid(),
  })
  .strict();

export type UndoAutoResolveDraftArgs = z.infer<typeof undoArgsSchema>;

export type UndoAutoResolveDraftResult =
  | { ok: true }
  | { ok: false; reason: UndoFailureReason };

export type UndoFailureReason =
  | "not_found"
  | "wrong_kind"
  | "expired"
  | "draft_modified";

// Undo path for the Gmail-direct-reply auto-resolve. Verifies:
//   1. The notification exists, belongs to this user, is the right
//      kind, and `undoable_until > now` (race-safe — cron may have
//      already expired it).
//   2. The referenced draft still exists and is still in the
//      auto-resolved state. If the user explicitly modified it via
//      another path between auto-resolve and undo, refuse — we don't
//      want to silently overwrite a deliberate user action.
//
// Side effects on success:
//   - agent_drafts.status flips back to 'pending', disposition to
//     'active' (re-surfaces the queue card on next read).
//   - agent_notifications row: undoable_until cleared, dismissed_at
//     stamped so the activity feed marks it consumed.
//   - audit_log row action='draft_auto_resolve_undone' for forensics.
export async function undoAutoResolveDraftAction(
  rawArgs: UndoAutoResolveDraftArgs,
): Promise<UndoAutoResolveDraftResult> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthenticated");
  const userId = session.user.id;
  const args = undoArgsSchema.parse(rawArgs);

  const now = new Date();

  // 1. Verify the notification (and read subjectId in one round-trip).
  //    Filter user_id in the WHERE so a cross-user id leak can't pass.
  const [notif] = await db
    .select({
      id: agentNotifications.id,
      kind: agentNotifications.kind,
      subjectTable: agentNotifications.subjectTable,
      subjectId: agentNotifications.subjectId,
      undoableUntil: agentNotifications.undoableUntil,
    })
    .from(agentNotifications)
    .where(
      and(
        eq(agentNotifications.id, args.notificationId),
        eq(agentNotifications.userId, userId),
      ),
    )
    .limit(1);

  if (!notif) {
    return { ok: false, reason: "not_found" };
  }
  if (notif.kind !== "auto_resolved_draft") {
    return { ok: false, reason: "wrong_kind" };
  }
  if (!notif.undoableUntil || notif.undoableUntil.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  // 2. Verify the draft is still in the auto-resolved state. If the
  //    user's intervened elsewhere — e.g. manually re-opened it via
  //    the inbox detail view — we refuse rather than overwrite.
  const [draft] = await db
    .select({
      id: agentDrafts.id,
      status: agentDrafts.status,
    })
    .from(agentDrafts)
    .where(
      and(
        eq(agentDrafts.id, notif.subjectId),
        eq(agentDrafts.userId, userId),
      ),
    )
    .limit(1);

  if (!draft || draft.status !== "superseded_by_user_send") {
    return { ok: false, reason: "draft_modified" };
  }

  // 3. Flip the draft back + consume the notification.
  await db
    .update(agentDrafts)
    .set({
      status: "pending",
      disposition: "active",
      updatedAt: now,
    })
    .where(eq(agentDrafts.id, draft.id));

  await db
    .update(agentNotifications)
    .set({
      undoableUntil: null,
      dismissedAt: now,
    })
    .where(eq(agentNotifications.id, notif.id));

  // 4. Audit row — separate channel from the notification surface.
  try {
    await logEmailAudit({
      userId,
      action: "draft_auto_resolve_undone",
      result: "success",
      resourceId: draft.id,
      detail: {
        notificationId: notif.id,
      },
    });
  } catch {
    // best-effort — the draft flip already happened.
  }

  // The undone draft re-appears in the queue on next render.
  revalidatePath("/app");
  revalidatePath("/app/activity");
  return { ok: true };
}

