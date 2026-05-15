import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";
import {
  buildReplySubject,
  extractReplyTargetInboxItemId,
} from "./draft-detect";

// engineer-63 — resolve reply targets for a batch of assistant messages.
// Each message's stored tool_calls array is walked for the most recent
// email_get_body / email_get_new_content_only call; the cited inbox_item is
// looked up to get sender / subject / Gmail thread id. Returns null for
// messages with no email body fetch in their tool history.

export type ResolvedReplyTarget = {
  inboxItemId: string;
  to: string;
  subject: string; // already "Re: "-prefixed
  threadExternalId: string | null;
  externalId: string; // Gmail message id (drives In-Reply-To)
};

export type ReplyTargetMap = Map<string, ResolvedReplyTarget>;

type ToolCallsHolder = {
  id: string;
  toolCalls: unknown;
};

export async function resolveReplyTargetsForMessages(
  userId: string,
  rows: ReadonlyArray<ToolCallsHolder>
): Promise<ReplyTargetMap> {
  const messageToInboxId = new Map<string, string>();
  for (const r of rows) {
    const id = extractReplyTargetInboxItemId(r.toolCalls);
    if (id) messageToInboxId.set(r.id, id);
  }
  if (messageToInboxId.size === 0) return new Map();

  // Batch the inbox lookups so a chat with 50 assistant turns doesn't issue
  // 50 selects. dedup the ids first.
  const uniqueIds = Array.from(new Set(messageToInboxId.values()));
  const items = await db
    .select({
      id: inboxItems.id,
      senderEmail: inboxItems.senderEmail,
      subject: inboxItems.subject,
      threadExternalId: inboxItems.threadExternalId,
      externalId: inboxItems.externalId,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, userId),
        inArray(inboxItems.id, uniqueIds),
        isNull(inboxItems.deletedAt)
      )
    );

  const itemById = new Map(items.map((i) => [i.id, i]));
  const out: ReplyTargetMap = new Map();
  for (const [messageId, inboxItemId] of messageToInboxId) {
    const item = itemById.get(inboxItemId);
    if (!item) continue;
    out.set(messageId, {
      inboxItemId,
      to: item.senderEmail,
      subject: buildReplySubject(item.subject),
      threadExternalId: item.threadExternalId,
      externalId: item.externalId,
    });
  }
  return out;
}
