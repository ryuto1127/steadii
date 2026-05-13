import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  entities,
  entityLinks,
  type EntityKind,
  type EntityLinkMethod,
  type EntityLinkSourceKind,
} from "@/lib/db/schema";
import { rerank } from "@/lib/agent/email/reranker";
import { extractEntityCandidates, type EntityCandidate } from "./extractor";
import { buildEntityEmbedInput, embedEntityText } from "./embedding";

// engineer-51 — main entity resolver. For one source row (email,
// assignment, event, chat_message), extract candidates with the LLM,
// match each one to existing entities (exact / embedding+rerank), and
// either link or create new.
//
// Public surface:
//   resolveEntitiesForSource(args) → { linkedEntityIds, createdEntityIds }
//
// Called fire-and-forget from each ingest pipeline. Failures land in
// Sentry and never propagate up to the caller. Idempotent — re-running
// on the same source row is a no-op once the unique link index applies.

const EXACT_MATCH_CONFIDENCE = 0.95;
const NEW_ENTITY_CONFIDENCE = 0.9;
const EMBEDDING_NEIGHBORS_TOP_K = 5;
const RERANKER_ACCEPT_THRESHOLD = 0.7;

export type ResolveResult = {
  linkedEntityIds: string[];
  createdEntityIds: string[];
};

export type ResolveSourceArgs = {
  userId: string;
  sourceKind: EntityLinkSourceKind;
  sourceId: string;
  contentText: string;
  knownContext?: {
    senderEmail?: string | null;
    classId?: string | null;
    sourceHint?: string;
  };
};

export async function resolveEntitiesForSource(
  args: ResolveSourceArgs
): Promise<ResolveResult> {
  return Sentry.startSpan(
    {
      name: "entity_graph.resolve",
      op: "agent.entity_resolve",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.source_kind": args.sourceKind,
        "steadii.source_id": args.sourceId,
      },
    },
    async () => runResolve(args)
  );
}

async function runResolve(args: ResolveSourceArgs): Promise<ResolveResult> {
  const linkedEntityIds: string[] = [];
  const createdEntityIds: string[] = [];

  // 1. Extract candidates from the source text.
  const candidates = await extractEntityCandidates({
    userId: args.userId,
    text: args.contentText,
    sourceHint: args.knownContext?.sourceHint,
  });

  if (candidates.length === 0) {
    return { linkedEntityIds, createdEntityIds };
  }

  // 2. For each candidate, match or create.
  for (const cand of candidates) {
    try {
      const match = await matchOrCreateEntity(args.userId, cand, {
        senderEmail: args.knownContext?.senderEmail ?? null,
        classId: args.knownContext?.classId ?? null,
      });
      if (match.created) createdEntityIds.push(match.entityId);
      const linked = await linkSource({
        userId: args.userId,
        entityId: match.entityId,
        sourceKind: args.sourceKind,
        sourceId: args.sourceId,
        confidence: match.confidence,
        method: match.method,
      });
      if (linked) linkedEntityIds.push(match.entityId);
    } catch (err) {
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "entity_graph", phase: "per_candidate" },
        user: { id: args.userId },
      });
    }
  }

  // 3. Stamp lastSeenAt on every linked entity.
  if (linkedEntityIds.length > 0) {
    await db
      .update(entities)
      .set({ lastSeenAt: new Date() })
      .where(
        and(
          eq(entities.userId, args.userId),
          inArray(entities.id, linkedEntityIds)
        )
      );
  }

  return { linkedEntityIds, createdEntityIds };
}

type MatchResult = {
  entityId: string;
  confidence: number;
  method: EntityLinkMethod;
  created: boolean;
};

async function matchOrCreateEntity(
  userId: string,
  candidate: EntityCandidate,
  context: { senderEmail: string | null; classId: string | null }
): Promise<MatchResult> {
  // (a) exact match on display_name or aliases, scoped to user + kind +
  //     live (non-merged) entities. Case-insensitive — Steadii users
  //     freely mix capitalization in mid-thread.
  const exact = await findExactMatch(userId, candidate);
  if (exact) {
    return {
      entityId: exact.id,
      confidence: EXACT_MATCH_CONFIDENCE,
      method: "exact_match",
      created: false,
    };
  }

  // (b) embedding similarity + reranker.
  const embeddingInput = buildEntityEmbedInput({
    displayName: candidate.displayName,
    aliases: candidate.aliases,
  });

  let candidateEmbedding: number[] | null = null;
  try {
    const emb = await embedEntityText({ userId, text: embeddingInput });
    candidateEmbedding = emb.embedding;
  } catch (err) {
    Sentry.captureException(err, {
      level: "warning",
      tags: { feature: "entity_graph", phase: "embed_candidate" },
      user: { id: userId },
    });
  }

  if (candidateEmbedding) {
    const neighbors = await findEmbeddingNeighbors(
      userId,
      candidate.kind,
      candidateEmbedding,
      EMBEDDING_NEIGHBORS_TOP_K
    );

    if (neighbors.length > 0) {
      const reranked = await rerank({
        userId,
        query: `${candidate.displayName}\n${(candidate.aliases ?? []).join(" ")}`,
        candidates: neighbors.map((n) => ({
          id: n.id,
          text: `${n.displayName} | aliases: ${(n.aliases ?? []).join(", ")} | ${
            n.description ?? ""
          }`,
          sourceType: "other" as const,
        })),
        topK: 1,
      });

      const best = reranked.ranked[0];
      if (best && best.score !== null && best.score >= RERANKER_ACCEPT_THRESHOLD) {
        // Optional alias enrichment — if the candidate brought a new
        // spelling, push it onto the matched entity. Bounded by the
        // candidate's own aliases + the original displayName.
        await maybeEnrichAliases(userId, best.id, candidate.displayName);
        return {
          entityId: best.id,
          confidence: best.score,
          method: "embedding_similar",
          created: false,
        };
      }
    }
  }

  // (c) create new.
  const created = await createEntity(userId, candidate, {
    senderEmail: context.senderEmail,
    classId: context.classId,
    embedding: candidateEmbedding,
  });
  return {
    entityId: created.id,
    confidence: NEW_ENTITY_CONFIDENCE,
    method: "llm_extract",
    created: true,
  };
}

async function findExactMatch(
  userId: string,
  candidate: EntityCandidate
): Promise<{ id: string } | null> {
  const trimmedName = candidate.displayName.trim();
  if (!trimmedName) return null;

  const aliases = (candidate.aliases ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

  const conditions = [
    ilike(entities.displayName, trimmedName),
    sql`lower(${entities.displayName}) = any(${sql.raw(
      `ARRAY[${[trimmedName, ...aliases]
        .map((a) => `'${a.toLowerCase().replace(/'/g, "''")}'`)
        .join(",")}]::text[]`
    )})`,
    // Match if any of our candidate's name/aliases overlap the stored
    // aliases column (text[] array intersection).
    sql`${entities.aliases} && ${sql.raw(
      `ARRAY[${[trimmedName, ...aliases]
        .map((a) => `'${a.replace(/'/g, "''")}'`)
        .join(",")}]::text[]`
    )}`,
  ];

  const rows = await db
    .select({ id: entities.id })
    .from(entities)
    .where(
      and(
        eq(entities.userId, userId),
        eq(entities.kind, candidate.kind),
        isNull(entities.mergedIntoEntityId),
        or(...conditions)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

type NeighborRow = {
  id: string;
  displayName: string;
  aliases: string[] | null;
  description: string | null;
  distance: number;
};

async function findEmbeddingNeighbors(
  userId: string,
  kind: EntityKind,
  embedding: number[],
  topK: number
): Promise<NeighborRow[]> {
  const vec = `[${embedding.join(",")}]`;
  const rowsRes = await db.execute<{
    id: string;
    display_name: string;
    aliases: string[] | null;
    description: string | null;
    distance: number;
  }>(sql`
    SELECT
      e.id,
      e.display_name,
      e.aliases,
      e.description,
      (e.embedding <=> ${vec}::vector(1536)) AS distance
    FROM entities e
    WHERE e.user_id = ${userId}
      AND e.kind = ${kind}
      AND e.merged_into_entity_id IS NULL
      AND e.embedding IS NOT NULL
    ORDER BY e.embedding <=> ${vec}::vector(1536)
    LIMIT ${topK}
  `);
  const raw = (
    rowsRes as unknown as {
      rows: Array<{
        id: string;
        display_name: string;
        aliases: string[] | null;
        description: string | null;
        distance: number;
      }>;
    }
  ).rows ?? [];
  return raw.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    aliases: r.aliases,
    description: r.description,
    distance: Number(r.distance),
  }));
}

async function createEntity(
  userId: string,
  candidate: EntityCandidate,
  ctx: {
    senderEmail: string | null;
    classId: string | null;
    embedding: number[] | null;
  }
): Promise<{ id: string }> {
  const aliases = (candidate.aliases ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && a !== candidate.displayName);

  const isPerson = candidate.kind === "person";
  const inserted = await db
    .insert(entities)
    .values({
      userId,
      kind: candidate.kind,
      displayName: candidate.displayName,
      aliases,
      description: null,
      primaryEmail: isPerson ? ctx.senderEmail ?? null : null,
      primaryClassId:
        candidate.kind === "course" || isPerson ? ctx.classId ?? null : null,
      embedding: ctx.embedding ?? null,
    })
    .returning({ id: entities.id });
  return inserted[0];
}

async function maybeEnrichAliases(
  userId: string,
  entityId: string,
  candidateName: string
): Promise<void> {
  if (!candidateName.trim()) return;
  // Only enrich when the new spelling is meaningfully different — skip
  // exact-case dupes since they're already covered by the exact-match
  // path. We treat anything case-insensitively equal to displayName or
  // an existing alias as "already known".
  const [row] = await db
    .select({
      displayName: entities.displayName,
      aliases: entities.aliases,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), eq(entities.id, entityId)))
    .limit(1);
  if (!row) return;
  const lower = candidateName.trim().toLowerCase();
  if (row.displayName.toLowerCase() === lower) return;
  if ((row.aliases ?? []).some((a) => a.toLowerCase() === lower)) return;
  await db
    .update(entities)
    .set({
      aliases: [...(row.aliases ?? []), candidateName.trim()],
    })
    .where(eq(entities.id, entityId));
}

// Returns true if a new row was inserted, false if the unique index
// rejected the link (already exists for this user / sourceKind /
// sourceId / entityId combo — idempotent re-runs).
async function linkSource(args: {
  userId: string;
  entityId: string;
  sourceKind: EntityLinkSourceKind;
  sourceId: string;
  confidence: number;
  method: EntityLinkMethod;
}): Promise<boolean> {
  const inserted = await db
    .insert(entityLinks)
    .values({
      userId: args.userId,
      entityId: args.entityId,
      sourceKind: args.sourceKind,
      sourceId: args.sourceId,
      confidence: args.confidence,
      method: args.method,
    })
    .onConflictDoNothing({
      target: [
        entityLinks.userId,
        entityLinks.sourceKind,
        entityLinks.sourceId,
        entityLinks.entityId,
      ],
    })
    .returning({ id: entityLinks.id });
  return inserted.length > 0;
}

// Background variant — never throws. Used by ingest hooks where the
// primary write (inbox_items, agent_drafts, etc.) has already committed
// and we don't want a resolver failure to surface to the user.
export function resolveEntitiesInBackground(args: ResolveSourceArgs): void {
  resolveEntitiesForSource(args).catch((err) => {
    Sentry.captureException(err, {
      tags: { feature: "entity_graph", phase: "background" },
      user: { id: args.userId },
    });
  });
}
