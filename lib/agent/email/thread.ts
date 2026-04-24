import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { inboxItems } from "@/lib/db/schema";
import {
  getGmailForUser,
  GmailNotConnectedError,
} from "@/lib/integrations/google/gmail";
import { getHeader } from "@/lib/integrations/google/gmail-fetch";

export type ThreadMessage = {
  sender: string;
  snippet: string;
};

// Pulls the last N messages in the same Gmail thread that preceded the
// current item. We first read from our own inbox_items table — cheaper
// than a Gmail API round-trip. If the local copy returns fewer than
// `limit` messages (e.g. predecessors landed in `bucket='ignore'` and got
// pruned, or fell outside the 24h ingest window), we fall back to
// Gmail's `users.threads.get` with `format='metadata'` to fetch the
// headers + snippet lean — no body content, to save tokens.
export async function fetchRecentThreadMessages(args: {
  userId: string;
  threadExternalId: string | null;
  beforeReceivedAt: Date;
  limit?: number;
}): Promise<ThreadMessage[]> {
  if (!args.threadExternalId) return [];
  const limit = args.limit ?? 2;

  const local = await loadFromInboxItems(args);
  if (local.length >= limit) return local;

  // Need to backfill via Gmail. Bound the API pull to `limit` predecessors
  // max so we don't spend tokens on deep threads.
  const remote = await loadFromGmailApi({
    userId: args.userId,
    threadExternalId: args.threadExternalId,
    beforeReceivedAt: args.beforeReceivedAt,
    limit,
  });

  // Merge by sender+snippet uniqueness to avoid double-counting if the
  // same message is in both sources. Keep chronological order.
  const seen = new Set<string>();
  const combined: ThreadMessage[] = [];
  for (const m of [...local, ...remote]) {
    const key = `${m.sender}|${m.snippet.slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(m);
  }
  return combined.slice(-limit);
}

async function loadFromInboxItems(args: {
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

  return rows.reverse().map((r) => ({
    sender: r.senderName ? `${r.senderName} <${r.senderEmail}>` : r.senderEmail,
    snippet: (r.snippet ?? r.subject ?? "").slice(0, 500),
  }));
}

async function loadFromGmailApi(args: {
  userId: string;
  threadExternalId: string;
  beforeReceivedAt: Date;
  limit: number;
}): Promise<ThreadMessage[]> {
  return Sentry.startSpan(
    {
      name: "gmail.threads.get",
      op: "http.client",
      attributes: {
        "steadii.user_id": args.userId,
        "gmail.thread_id": args.threadExternalId,
      },
    },
    async () => {
      try {
        const gmail = await getGmailForUser(args.userId);
        const res = await gmail.users.threads.get({
          userId: "me",
          id: args.threadExternalId,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const msgs = res.data.messages ?? [];
        const collected: ThreadMessage[] = [];
        for (const m of msgs) {
          const internalMs = Number(m.internalDate ?? 0);
          if (
            Number.isFinite(internalMs) &&
            internalMs > 0 &&
            internalMs >= args.beforeReceivedAt.getTime()
          ) {
            continue; // this or later than the current item
          }
          const fromRaw = getHeader(m, "From") ?? "";
          const snippet = (m.snippet ?? "").slice(0, 500);
          if (!fromRaw && !snippet) continue;
          collected.push({ sender: fromRaw || "(unknown)", snippet });
        }
        return collected.slice(-args.limit);
      } catch (err) {
        if (err instanceof GmailNotConnectedError) return [];
        // Don't fail the whole pipeline for a thread-fetch miss.
        Sentry.captureException(err, {
          tags: { integration: "gmail", op: "threads.get" },
          user: { id: args.userId },
        });
        return [];
      }
    }
  );
}
