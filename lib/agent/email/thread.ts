import "server-only";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";

export type ThreadMessage = {
  sender: string;
  snippet: string;
};

// Pulls the last N messages in the same Gmail thread that preceded the
// current item. We read from our own inbox_items table — cheaper than a
// Gmail API round-trip and sufficient since we ingested every triaged
// message (including bucket='ignore' rows). Cross-user leakage is
// prevented by the user_id filter. Returns [] if the current item has no
// thread_external_id or no prior items exist.
export async function fetchRecentThreadMessages(args: {
  userId: string;
  threadExternalId: string | null;
  beforeReceivedAt: Date;
  limit?: number;
}): Promise<ThreadMessage[]> {
  if (!args.threadExternalId) return [];
  const limit = args.limit ?? 2;

  const rows = await db
    .select({
      senderEmail: inboxItems.senderEmail,
      senderName: inboxItems.senderName,
      snippet: inboxItems.snippet,
      subject: inboxItems.subject,
    })
    .from(inboxItems)
    .where(
      and(
        eq(inboxItems.userId, args.userId),
        eq(inboxItems.threadExternalId, args.threadExternalId),
        lt(inboxItems.receivedAt, args.beforeReceivedAt),
        isNull(inboxItems.deletedAt)
      )
    )
    .orderBy(desc(inboxItems.receivedAt))
    .limit(limit);

  // Return oldest-first so the LLM reads the thread in chronological order.
  return rows.reverse().map((r) => ({
    sender: r.senderName ? `${r.senderName} <${r.senderEmail}>` : r.senderEmail,
    snippet: (r.snippet ?? r.subject ?? "").slice(0, 500),
  }));
}
