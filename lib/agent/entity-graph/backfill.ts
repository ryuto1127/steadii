import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, isNotNull, notExists, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentDrafts,
  assignments,
  chats,
  entityLinks,
  inboxItems,
  messages,
} from "@/lib/db/schema";
import { resolveEntitiesForSource } from "./resolver";

// engineer-51 — entity-graph backfill cron. Picks up source rows that
// existed before the resolver landed and don't yet have entity_links
// rows. Bounded per invocation so a long-running tick can't burn the
// QStash request budget — daily cadence + 50 rows / tick.

// Total ceiling per tick. Bumped to spread cost across many users
// without dominating a single user's daily budget.
const PER_TICK_ROW_LIMIT = 50;

// Per-user ceiling within a single tick. Prevents any one user with
// huge legacy backlog from monopolizing the slot.
const PER_USER_ROW_LIMIT = 10;

export type BackfillResult = {
  processed: number;
  perUser: Record<string, number>;
  bySource: Record<string, number>;
};

export async function runEntityBackfill(): Promise<BackfillResult> {
  return Sentry.startSpan(
    { name: "cron.entity_backfill.tick", op: "cron" },
    async () => runBackfill()
  );
}

async function runBackfill(): Promise<BackfillResult> {
  const perUser: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let processed = 0;

  // Process source kinds in priority order. Inbox + agent_drafts are
  // the highest-signal historical surfaces; assignments + chat are
  // secondary. We stop early when the per-tick cap is hit.
  for (const source of [
    "inbox_item",
    "agent_draft",
    "assignment",
    "chat_message",
  ] as const) {
    if (processed >= PER_TICK_ROW_LIMIT) break;
    const remaining = PER_TICK_ROW_LIMIT - processed;
    const rows = await fetchUnlinkedRows(source, remaining);
    for (const r of rows) {
      if (processed >= PER_TICK_ROW_LIMIT) break;
      const userCount = perUser[r.userId] ?? 0;
      if (userCount >= PER_USER_ROW_LIMIT) continue;
      try {
        await resolveEntitiesForSource({
          userId: r.userId,
          sourceKind: source,
          sourceId: r.id,
          contentText: r.text,
          knownContext: {
            senderEmail: r.senderEmail ?? null,
            classId: r.classId ?? null,
            sourceHint: `backfill (${source})`,
          },
        });
      } catch (err) {
        Sentry.captureException(err, {
          tags: { feature: "entity_graph", phase: "backfill_row" },
        });
        continue;
      }
      processed++;
      perUser[r.userId] = userCount + 1;
      bySource[source] = (bySource[source] ?? 0) + 1;
    }
  }

  return { processed, perUser, bySource };
}

type UnlinkedRow = {
  id: string;
  userId: string;
  text: string;
  senderEmail?: string | null;
  classId?: string | null;
};

async function fetchUnlinkedRows(
  source:
    | "inbox_item"
    | "agent_draft"
    | "assignment"
    | "chat_message",
  limit: number
): Promise<UnlinkedRow[]> {
  // NOT EXISTS guards re-runs: once a row has any entity_link, we skip
  // it (even if the link is to a different entity, the row has been
  // processed at least once).
  switch (source) {
    case "inbox_item": {
      const rows = await db
        .select({
          id: inboxItems.id,
          userId: inboxItems.userId,
          subject: inboxItems.subject,
          snippet: inboxItems.snippet,
          senderEmail: inboxItems.senderEmail,
          classId: inboxItems.classId,
        })
        .from(inboxItems)
        .where(
          and(
            // Only live rows.
            sql`${inboxItems.deletedAt} IS NULL`,
            notExists(
              db
                .select({ x: sql`1` })
                .from(entityLinks)
                .where(
                  and(
                    eq(entityLinks.userId, inboxItems.userId),
                    eq(entityLinks.sourceKind, "inbox_item"),
                    eq(entityLinks.sourceId, inboxItems.id)
                  )
                )
            )
          )
        )
        .orderBy(asc(inboxItems.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        text: [r.subject ?? "", r.snippet ?? ""].filter(Boolean).join("\n\n"),
        senderEmail: r.senderEmail,
        classId: r.classId,
      }));
    }
    case "agent_draft": {
      const rows = await db
        .select({
          id: agentDrafts.id,
          userId: agentDrafts.userId,
          inboxItemId: agentDrafts.inboxItemId,
          subject: agentDrafts.draftSubject,
          body: agentDrafts.draftBody,
        })
        .from(agentDrafts)
        .where(
          notExists(
            db
              .select({ x: sql`1` })
              .from(entityLinks)
              .where(
                and(
                  eq(entityLinks.userId, agentDrafts.userId),
                  eq(entityLinks.sourceKind, "agent_draft"),
                  eq(entityLinks.sourceId, agentDrafts.id)
                )
              )
          )
        )
        .orderBy(asc(agentDrafts.createdAt))
        .limit(limit);
      return rows
        .filter((r) => (r.body ?? "").trim().length > 0)
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          text: [r.subject ?? "", r.body ?? ""].filter(Boolean).join("\n\n"),
        }));
    }
    case "assignment": {
      const rows = await db
        .select({
          id: assignments.id,
          userId: assignments.userId,
          title: assignments.title,
          notes: assignments.notes,
          classId: assignments.classId,
        })
        .from(assignments)
        .where(
          and(
            sql`${assignments.deletedAt} IS NULL`,
            notExists(
              db
                .select({ x: sql`1` })
                .from(entityLinks)
                .where(
                  and(
                    eq(entityLinks.userId, assignments.userId),
                    eq(entityLinks.sourceKind, "assignment"),
                    eq(entityLinks.sourceId, assignments.id)
                  )
                )
            )
          )
        )
        .orderBy(asc(assignments.createdAt))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        text: [r.title ?? "", r.notes ?? ""].filter(Boolean).join("\n\n"),
        classId: r.classId,
      }));
    }
    case "chat_message": {
      // Chat messages need a chats-join for userId; messages table has
      // chatId, not userId directly. Skip system / tool rows — only
      // user + assistant turns carry meaningful entity surface.
      const rows = await db
        .select({
          id: messages.id,
          userId: chats.userId,
          content: messages.content,
        })
        .from(messages)
        .innerJoin(chats, eq(messages.chatId, chats.id))
        .where(
          and(
            isNotNull(messages.content),
            sql`${messages.role} IN ('user', 'assistant')`,
            sql`${chats.deletedAt} IS NULL`,
            notExists(
              db
                .select({ x: sql`1` })
                .from(entityLinks)
                .where(
                  and(
                    eq(entityLinks.userId, chats.userId),
                    eq(entityLinks.sourceKind, "chat_message"),
                    eq(entityLinks.sourceId, messages.id)
                  )
                )
            )
          )
        )
        .orderBy(asc(messages.createdAt))
        .limit(limit);
      return rows
        .filter((r) => (r.content ?? "").trim().length > 5)
        .map((r) => ({
          id: r.id,
          userId: r.userId,
          text: r.content ?? "",
        }));
    }
  }
}

// Exported for tests — count how many rows remain unlinked across all
// supported source kinds. Useful for monitoring backfill completion.
export async function countUnlinkedRows(): Promise<Record<string, number>> {
  const inboxCount = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inboxItems)
    .where(
      and(
        sql`${inboxItems.deletedAt} IS NULL`,
        notExists(
          db
            .select({ x: sql`1` })
            .from(entityLinks)
            .where(
              and(
                eq(entityLinks.userId, inboxItems.userId),
                eq(entityLinks.sourceKind, "inbox_item"),
                eq(entityLinks.sourceId, inboxItems.id)
              )
            )
        )
      )
    );
  return {
    inbox_item: inboxCount[0]?.count ?? 0,
  };
}
