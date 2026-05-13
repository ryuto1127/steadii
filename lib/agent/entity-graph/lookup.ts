import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  entities,
  entityLinks,
  type EntityKind,
  type EntityLinkSourceKind,
} from "@/lib/db/schema";
import { embedEntityText } from "./embedding";

// engineer-51 — read-side utilities for the entity graph. Used by the
// `lookup_entity` chat tool, the entities list / detail pages, and the
// proactive rules that need "all source rows linked to this entity."
//
// Splits cleanly from resolver.ts so a chat tool can call these without
// pulling in the LLM extractor + reranker dependencies.

export type EntityCandidateSummary = {
  id: string;
  kind: EntityKind;
  displayName: string;
  aliases: string[];
  description: string | null;
  primaryEmail: string | null;
  primaryClassId: string | null;
  lastSeenAt: Date;
  matchScore: number;
  matchMethod: "exact" | "alias" | "embedding";
};

export type EntityLinkSummary = {
  id: string;
  entityId: string;
  sourceKind: EntityLinkSourceKind;
  sourceId: string;
  confidence: number;
  createdAt: Date;
};

// Fuzzy lookup by name + optional kind. Returns up to topK canonical
// (non-merged) entities, ranked by match quality:
//   1. exact case-insensitive display_name match
//   2. alias match
//   3. embedding cosine similarity (only if topK not satisfied by 1+2)
export async function findEntitiesByQuery(args: {
  userId: string;
  query: string;
  kind?: EntityKind;
  topK?: number;
}): Promise<EntityCandidateSummary[]> {
  const topK = args.topK ?? 3;
  const trimmed = args.query.trim();
  if (!trimmed) return [];

  return Sentry.startSpan(
    {
      name: "entity_graph.lookup",
      op: "db.query",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.query_len": trimmed.length,
      },
    },
    async () => runLookup(args.userId, trimmed, args.kind, topK)
  );
}

async function runLookup(
  userId: string,
  query: string,
  kind: EntityKind | undefined,
  topK: number
): Promise<EntityCandidateSummary[]> {
  const collected = new Map<string, EntityCandidateSummary>();

  // Phase 1: exact + alias matches via SQL.
  const conditions = [
    ilike(entities.displayName, query),
    sql`lower(${entities.displayName}) = lower(${query})`,
    sql`${entities.aliases} && ARRAY[${sql.raw(`'${query.replace(/'/g, "''")}'`)}]::text[]`,
  ];
  const exactWhere = and(
    eq(entities.userId, userId),
    isNull(entities.mergedIntoEntityId),
    kind ? eq(entities.kind, kind) : undefined,
    or(...conditions)
  );

  const exactRows = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      displayName: entities.displayName,
      aliases: entities.aliases,
      description: entities.description,
      primaryEmail: entities.primaryEmail,
      primaryClassId: entities.primaryClassId,
      lastSeenAt: entities.lastSeenAt,
    })
    .from(entities)
    .where(exactWhere)
    .limit(topK * 2);

  const queryLower = query.toLowerCase();
  for (const r of exactRows) {
    const aliases = r.aliases ?? [];
    const isExact = r.displayName.toLowerCase() === queryLower;
    collected.set(r.id, {
      id: r.id,
      kind: r.kind,
      displayName: r.displayName,
      aliases,
      description: r.description,
      primaryEmail: r.primaryEmail,
      primaryClassId: r.primaryClassId,
      lastSeenAt: r.lastSeenAt,
      matchScore: isExact ? 1.0 : 0.95,
      matchMethod: isExact ? "exact" : "alias",
    });
  }

  // Phase 2: substring ILIKE — picks up "令和" when the canonical is
  // "令和トラベル". Cheaper than embedding for short queries.
  if (collected.size < topK) {
    const substringRows = await db
      .select({
        id: entities.id,
        kind: entities.kind,
        displayName: entities.displayName,
        aliases: entities.aliases,
        description: entities.description,
        primaryEmail: entities.primaryEmail,
        primaryClassId: entities.primaryClassId,
        lastSeenAt: entities.lastSeenAt,
      })
      .from(entities)
      .where(
        and(
          eq(entities.userId, userId),
          isNull(entities.mergedIntoEntityId),
          kind ? eq(entities.kind, kind) : undefined,
          ilike(entities.displayName, `%${query}%`)
        )
      )
      .limit(topK * 2);
    for (const r of substringRows) {
      if (collected.has(r.id)) continue;
      collected.set(r.id, {
        id: r.id,
        kind: r.kind,
        displayName: r.displayName,
        aliases: r.aliases ?? [],
        description: r.description,
        primaryEmail: r.primaryEmail,
        primaryClassId: r.primaryClassId,
        lastSeenAt: r.lastSeenAt,
        matchScore: 0.8,
        matchMethod: "alias",
      });
    }
  }

  // Phase 3: embedding cosine if we still don't have enough hits.
  if (collected.size < topK) {
    try {
      const { embedding } = await embedEntityText({ userId, text: query });
      const vec = `[${embedding.join(",")}]`;
      const rowsRes = await db.execute<{
        id: string;
        kind: EntityKind;
        display_name: string;
        aliases: string[] | null;
        description: string | null;
        primary_email: string | null;
        primary_class_id: string | null;
        last_seen_at: Date | string;
        distance: number;
      }>(sql`
        SELECT
          e.id,
          e.kind,
          e.display_name,
          e.aliases,
          e.description,
          e.primary_email,
          e.primary_class_id,
          e.last_seen_at,
          (e.embedding <=> ${vec}::vector(1536)) AS distance
        FROM entities e
        WHERE e.user_id = ${userId}
          AND e.merged_into_entity_id IS NULL
          AND e.embedding IS NOT NULL
          ${kind ? sql`AND e.kind = ${kind}` : sql``}
        ORDER BY e.embedding <=> ${vec}::vector(1536)
        LIMIT ${topK * 2}
      `);
      const raw = (
        rowsRes as unknown as {
          rows: Array<{
            id: string;
            kind: EntityKind;
            display_name: string;
            aliases: string[] | null;
            description: string | null;
            primary_email: string | null;
            primary_class_id: string | null;
            last_seen_at: Date | string;
            distance: number;
          }>;
        }
      ).rows ?? [];
      for (const r of raw) {
        if (collected.has(r.id)) continue;
        const dist = Number(r.distance);
        const sim = 1 - dist / 2;
        if (sim < 0.5) continue;
        collected.set(r.id, {
          id: r.id,
          kind: r.kind,
          displayName: r.display_name,
          aliases: r.aliases ?? [],
          description: r.description,
          primaryEmail: r.primary_email,
          primaryClassId: r.primary_class_id,
          lastSeenAt:
            r.last_seen_at instanceof Date
              ? r.last_seen_at
              : new Date(r.last_seen_at),
          matchScore: sim,
          matchMethod: "embedding",
        });
      }
    } catch (err) {
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "entity_graph", phase: "lookup_embed" },
        user: { id: userId },
      });
    }
  }

  // Sort by score desc, take topK.
  return [...collected.values()]
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, topK);
}

export async function getLinksForEntity(args: {
  userId: string;
  entityId: string;
  limit?: number;
}): Promise<EntityLinkSummary[]> {
  const limit = args.limit ?? 20;
  const rows = await db
    .select({
      id: entityLinks.id,
      entityId: entityLinks.entityId,
      sourceKind: entityLinks.sourceKind,
      sourceId: entityLinks.sourceId,
      confidence: entityLinks.confidence,
      createdAt: entityLinks.createdAt,
    })
    .from(entityLinks)
    .where(
      and(
        eq(entityLinks.userId, args.userId),
        eq(entityLinks.entityId, args.entityId)
      )
    )
    .orderBy(desc(entityLinks.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    entityId: r.entityId,
    sourceKind: r.sourceKind,
    sourceId: r.sourceId,
    confidence: r.confidence,
    createdAt: r.createdAt,
  }));
}

export async function getEntityById(args: {
  userId: string;
  entityId: string;
}): Promise<EntityCandidateSummary | null> {
  const [row] = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      displayName: entities.displayName,
      aliases: entities.aliases,
      description: entities.description,
      primaryEmail: entities.primaryEmail,
      primaryClassId: entities.primaryClassId,
      lastSeenAt: entities.lastSeenAt,
      mergedIntoEntityId: entities.mergedIntoEntityId,
    })
    .from(entities)
    .where(
      and(eq(entities.userId, args.userId), eq(entities.id, args.entityId))
    )
    .limit(1);
  if (!row || row.mergedIntoEntityId) return null;
  return {
    id: row.id,
    kind: row.kind,
    displayName: row.displayName,
    aliases: row.aliases ?? [],
    description: row.description,
    primaryEmail: row.primaryEmail,
    primaryClassId: row.primaryClassId,
    lastSeenAt: row.lastSeenAt,
    matchScore: 1.0,
    matchMethod: "exact",
  };
}

export async function listEntitiesForUser(args: {
  userId: string;
  kind?: EntityKind;
  limit?: number;
}): Promise<EntityCandidateSummary[]> {
  const limit = args.limit ?? 100;
  const rows = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      displayName: entities.displayName,
      aliases: entities.aliases,
      description: entities.description,
      primaryEmail: entities.primaryEmail,
      primaryClassId: entities.primaryClassId,
      lastSeenAt: entities.lastSeenAt,
    })
    .from(entities)
    .where(
      and(
        eq(entities.userId, args.userId),
        isNull(entities.mergedIntoEntityId),
        args.kind ? eq(entities.kind, args.kind) : undefined
      )
    )
    .orderBy(desc(entities.lastSeenAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    displayName: r.displayName,
    aliases: r.aliases ?? [],
    description: r.description,
    primaryEmail: r.primaryEmail,
    primaryClassId: r.primaryClassId,
    lastSeenAt: r.lastSeenAt,
    matchScore: 1.0,
    matchMethod: "exact",
  }));
}

// Fetch human-readable labels for a set of links. Resolves each
// (sourceKind, sourceId) to a short label by joining against the
// originating table. Used by the lookup tool to give the LLM concrete
// strings instead of raw UUIDs.
export type ResolvedLinkLabel = {
  sourceKind: EntityLinkSourceKind;
  sourceId: string;
  label: string;
  // When known, a deep-link path inside /app/* for the UI.
  href: string | null;
  // ISO datetime of the underlying source row (received_at, due_at,
  // starts_at, created_at) for human "last touched" sorting.
  occurredAt: Date | null;
};

export async function resolveLinkLabels(args: {
  userId: string;
  links: EntityLinkSummary[];
}): Promise<ResolvedLinkLabel[]> {
  if (args.links.length === 0) return [];

  // Bucket by sourceKind so each lookup is one batched query.
  const byKind = new Map<EntityLinkSourceKind, string[]>();
  for (const l of args.links) {
    const arr = byKind.get(l.sourceKind) ?? [];
    arr.push(l.sourceId);
    byKind.set(l.sourceKind, arr);
  }

  const out = new Map<string, ResolvedLinkLabel>();
  const key = (kind: EntityLinkSourceKind, id: string) => `${kind}:${id}`;

  // Inbox items.
  const inboxIds = byKind.get("inbox_item");
  if (inboxIds && inboxIds.length > 0) {
    const { inboxItems } = await import("@/lib/db/schema");
    const rows = await db
      .select({
        id: inboxItems.id,
        subject: inboxItems.subject,
        receivedAt: inboxItems.receivedAt,
      })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, args.userId),
          inArray(inboxItems.id, inboxIds)
        )
      );
    for (const r of rows) {
      out.set(key("inbox_item", r.id), {
        sourceKind: "inbox_item",
        sourceId: r.id,
        label: r.subject ?? "(no subject)",
        href: `/app/inbox/${r.id}`,
        occurredAt: r.receivedAt ?? null,
      });
    }
  }

  // Agent drafts.
  const draftIds = byKind.get("agent_draft");
  if (draftIds && draftIds.length > 0) {
    const { agentDrafts } = await import("@/lib/db/schema");
    const rows = await db
      .select({
        id: agentDrafts.id,
        inboxItemId: agentDrafts.inboxItemId,
        draftSubject: agentDrafts.draftSubject,
        createdAt: agentDrafts.createdAt,
      })
      .from(agentDrafts)
      .where(
        and(
          eq(agentDrafts.userId, args.userId),
          inArray(agentDrafts.id, draftIds)
        )
      );
    for (const r of rows) {
      out.set(key("agent_draft", r.id), {
        sourceKind: "agent_draft",
        sourceId: r.id,
        label: r.draftSubject ?? "(draft)",
        href: r.inboxItemId ? `/app/inbox/${r.inboxItemId}` : null,
        occurredAt: r.createdAt ?? null,
      });
    }
  }

  // Events.
  const eventIds = byKind.get("event");
  if (eventIds && eventIds.length > 0) {
    const { events } = await import("@/lib/db/schema");
    const rows = await db
      .select({
        id: events.id,
        title: events.title,
        startsAt: events.startsAt,
      })
      .from(events)
      .where(
        and(eq(events.userId, args.userId), inArray(events.id, eventIds))
      );
    for (const r of rows) {
      out.set(key("event", r.id), {
        sourceKind: "event",
        sourceId: r.id,
        label: r.title ?? "(event)",
        href: `/app/calendar`,
        occurredAt: r.startsAt ?? null,
      });
    }
  }

  // Assignments.
  const assignmentIds = byKind.get("assignment");
  if (assignmentIds && assignmentIds.length > 0) {
    const { assignments } = await import("@/lib/db/schema");
    const rows = await db
      .select({
        id: assignments.id,
        title: assignments.title,
        dueAt: assignments.dueAt,
      })
      .from(assignments)
      .where(
        and(
          eq(assignments.userId, args.userId),
          inArray(assignments.id, assignmentIds)
        )
      );
    for (const r of rows) {
      out.set(key("assignment", r.id), {
        sourceKind: "assignment",
        sourceId: r.id,
        label: r.title ?? "(assignment)",
        href: `/app/tasks`,
        occurredAt: r.dueAt ?? null,
      });
    }
  }

  // Chat messages.
  const chatMessageIds = byKind.get("chat_message");
  if (chatMessageIds && chatMessageIds.length > 0) {
    const { messages, chats } = await import("@/lib/db/schema");
    const rows = await db
      .select({
        id: messages.id,
        chatId: messages.chatId,
        content: messages.content,
        createdAt: messages.createdAt,
        chatTitle: chats.title,
      })
      .from(messages)
      .innerJoin(chats, eq(messages.chatId, chats.id))
      .where(
        and(
          eq(chats.userId, args.userId),
          inArray(messages.id, chatMessageIds)
        )
      );
    for (const r of rows) {
      const snippet = (r.content ?? "").slice(0, 80);
      out.set(key("chat_message", r.id), {
        sourceKind: "chat_message",
        sourceId: r.id,
        label: r.chatTitle ?? snippet ?? "(chat)",
        href: `/app/chat/${r.chatId}`,
        occurredAt: r.createdAt ?? null,
      });
    }
  }

  // Agent contact personas.
  const personaIds = byKind.get("agent_contact_persona");
  if (personaIds && personaIds.length > 0) {
    const { agentContactPersonas } = await import("@/lib/db/schema");
    const rows = await db
      .select({
        id: agentContactPersonas.id,
        contactName: agentContactPersonas.contactName,
        contactEmail: agentContactPersonas.contactEmail,
        lastExtractedAt: agentContactPersonas.lastExtractedAt,
      })
      .from(agentContactPersonas)
      .where(
        and(
          eq(agentContactPersonas.userId, args.userId),
          inArray(agentContactPersonas.id, personaIds)
        )
      );
    for (const r of rows) {
      out.set(key("agent_contact_persona", r.id), {
        sourceKind: "agent_contact_persona",
        sourceId: r.id,
        label: r.contactName ?? r.contactEmail,
        href: null,
        occurredAt: r.lastExtractedAt ?? null,
      });
    }
  }

  // Return in the same order as the input links (most-recent first).
  return args.links
    .map((l) => out.get(key(l.sourceKind, l.sourceId)))
    .filter((x): x is ResolvedLinkLabel => x != null);
}
