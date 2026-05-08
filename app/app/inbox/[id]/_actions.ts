"use server";

import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  inboxItems,
  type ExtractedActionItem,
} from "@/lib/db/schema";
import { createAssignment } from "@/lib/assignments/save";
import {
  dueFromDateOnly,
  getTasksForUser,
  TasksNotConnectedError,
} from "@/lib/integrations/google/tasks";

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

// engineer-39 — accept a single action item the deep pass extracted.
// Writes the item to BOTH:
//   1. assignments (Steadii native, class-bound when the inbox row has a
//      class binding so the calendar surfaces it under the right course).
//   2. Google Tasks via the @default tasklist so the user sees it in
//      their Google Tasks app too. Failure here is non-fatal — the
//      Steadii-side write is the source of truth.
//
// Idempotency: agent_drafts.accepted_action_item_indices is a JSONB int[]
// of indices already accepted. A double-click checks the column first
// and returns { ok: true, alreadyAccepted: true } without doing any
// further work. The route handler revalidates only on the first accept
// so subsequent renders see a stable "added" pill.
export async function acceptDraftActionItemAction(
  draftId: string,
  itemIndex: number
): Promise<
  | { ok: true; alreadyAccepted?: boolean }
  | { ok: false; error: string }
> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, error: "unauthenticated" };
  }
  const userId = session.user.id;

  const [row] = await db
    .select({
      draft: agentDrafts,
      inbox: inboxItems,
    })
    .from(agentDrafts)
    .innerJoin(inboxItems, eq(agentDrafts.inboxItemId, inboxItems.id))
    .where(and(eq(agentDrafts.id, draftId), eq(agentDrafts.userId, userId)))
    .limit(1);
  if (!row) return { ok: false, error: "draft_not_found" };

  const items = (row.draft.extractedActionItems ?? []) as ExtractedActionItem[];
  if (itemIndex < 0 || itemIndex >= items.length) {
    return { ok: false, error: "invalid_item_index" };
  }
  const item = items[itemIndex];
  const accepted = (row.draft.acceptedActionItemIndices ?? []) as number[];
  if (accepted.includes(itemIndex)) {
    return { ok: true, alreadyAccepted: true };
  }

  // Steadii native — class-bound when we have a binding, undated when
  // the model didn't extract a deadline. dueAt is stored as ISO at UTC
  // midnight for date-only deadlines (assignments.dueAt is timestamptz;
  // this matches how Notion/manual creates persist date-only dues).
  try {
    await createAssignment({
      userId,
      input: {
        title: item.title,
        classId: row.inbox.classId,
        dueAt: item.dueDate
          ? new Date(`${item.dueDate}T00:00:00.000Z`).toISOString()
          : null,
        priority: null,
        notes: `From email: ${row.inbox.subject ?? "(no subject)"}`,
        source: "manual",
      },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "accept_action_item", target: "assignments" },
      user: { id: userId },
      extra: { draftId, itemIndex, title: item.title },
    });
    return { ok: false, error: "assignment_create_failed" };
  }

  // Google Tasks — non-fatal soft-fail. The user already got the
  // assignment row (the source of truth); the Google mirror is a
  // courtesy. Skip silently when Tasks isn't connected.
  try {
    const tasks = await getTasksForUser(userId);
    await tasks.tasks.insert({
      tasklist: "@default",
      requestBody: {
        title: item.title,
        notes: `From email: ${row.inbox.subject ?? "(no subject)"}`,
        due: item.dueDate ? dueFromDateOnly(item.dueDate) : undefined,
      },
    });
  } catch (err) {
    if (!(err instanceof TasksNotConnectedError)) {
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "accept_action_item", target: "google_tasks" },
        user: { id: userId },
        extra: { draftId, itemIndex },
      });
    }
  }

  // Mark accepted on the draft row LAST — if the assignment succeeded
  // but the marker write fails, the user can re-click and we no-op
  // because a second createAssignment isn't checked-against. That's
  // an edge case (the marker write is dirt-cheap and usually doesn't
  // fail); a unique index on (userId, draft_id, item_index, source)
  // would be the bulletproof guard but is out of scope for v1.
  const newAccepted = Array.from(new Set([...accepted, itemIndex])).sort(
    (a, b) => a - b
  );
  await db
    .update(agentDrafts)
    .set({
      acceptedActionItemIndices: newAccepted,
      updatedAt: new Date(),
    })
    .where(eq(agentDrafts.id, row.draft.id));

  revalidatePath(`/app/inbox/${row.draft.id}`);
  revalidatePath("/app/calendar");
  return { ok: true };
}
