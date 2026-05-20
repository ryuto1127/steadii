// 2026-05-19 — Phase 2b email preview pre-fetch for the DRAFT_EMAIL_REPLY
// intent.
//
// When the classifier produces intent=DRAFT_EMAIL_REPLY with a tagged
// matchedEntityId, we look up the entity's most-recent linked
// inbox_item and persist a `preview` JSONB blob (subject, snippet,
// receivedAt). The Phase 3 UI then renders that preview under the
// task card without doing a synchronous fetch on user click — the
// smart-action button is zero-latency.
//
// Other intents (CALENDAR_EVENT, STUDY_SESSION, ASSIGNMENT_WORK) will
// grow their own pre-fetch shapes later. Phase 2b ships only the
// DRAFT_EMAIL_REPLY path because that's the canonical use case from
// the maintainer's question ("「<会社名>への返信」 タスクから直接 draft
// を始める").

import "server-only";

import { and, desc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import {
  entityLinks,
  inboxItems,
  type TaskIntentPreview,
} from "@/lib/db/schema";

export async function prefetchDraftEmailReplyPreview(args: {
  userId: string;
  entityId: string;
}): Promise<TaskIntentPreview | null> {
  // 1. Find inbox_item links for this entity (entity_links join on
  //    source_kind = 'inbox_item').
  const links = await db
    .select({ sourceId: entityLinks.sourceId })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, args.userId),
        eq(entityLinks.entityId, args.entityId),
        eq(entityLinks.sourceKind, "inbox_item"),
      ),
    )
    .limit(50);

  if (links.length === 0) return null;

  // 2. Pull the most-recently-received inbox_item among the linked
  //    set. ORDER BY received_at DESC LIMIT 1.
  const inboxItemIds = links.map((l) => l.sourceId);
  const [item] = await db
    .select({
      id: inboxItems.id,
      subject: inboxItems.subject,
      snippet: inboxItems.snippet,
      receivedAt: inboxItems.receivedAt,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, args.userId),
        inArray(inboxItems.id, inboxItemIds),
      ),
    )
    .orderBy(desc(inboxItems.receivedAt))
    .limit(1);

  if (!item) return null;

  return {
    kind: "draft_email_reply",
    inboxItemId: item.id,
    subject: item.subject ?? "",
    snippet: item.snippet ?? "",
    receivedAt: item.receivedAt.toISOString(),
  };
}
