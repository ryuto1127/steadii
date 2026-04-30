"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";

// Marks an inbox item as reviewed. Called from the detail page's mount
// (via <MarkReviewedOnMount>) so the DB write happens AFTER the layout
// has streamed. The inline-in-render write the page used to do raced
// the layout's countPendingDrafts call, leaving the sidebar badge
// stuck at the high-water mark — sparring root cause for the
// "badge doesn't decrement" bug (2026-04-30). Pairing the action with a
// client-side router.refresh forces the layout RSC payload to refetch.
//
// The action is idempotent: subsequent calls on an already-reviewed row
// are no-ops at the DB level and the revalidations are cheap.
export async function markInboxItemReviewedAction(
  inboxItemId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthenticated" };
  }
  const userId = session.user.id;

  const now = new Date();
  await db
    .update(inboxItems)
    .set({ reviewedAt: now, updatedAt: now })
    .where(
      and(
        eq(inboxItems.id, inboxItemId),
        eq(inboxItems.userId, userId)
      )
    );

  revalidatePath("/app", "layout");
  revalidatePath("/app/inbox");

  return { ok: true };
}
