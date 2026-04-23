import "server-only";
import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { embedText } from "./embeddings";

// Hardcoded per memory: top-20 similar emails for deep-pass context.
// Not a user-facing setting — exposed as a constant so callers reason about
// the ceiling without guessing.
export const DEEP_PASS_TOP_K = 20;

export type SimilarEmail = {
  inboxItemId: string;
  similarity: number; // 0..1 where 1 is identical
  subject: string | null;
  snippet: string | null;
  receivedAt: Date;
  senderEmail: string;
};

// Cosine similarity via pgvector's `<=>` cosine-distance operator. Distance
// is in `[0, 2]`; we convert to a conventional similarity `1 - distance/2`
// so "similarity" rises as messages match. `WHERE user_id = $1` is the
// hard privacy boundary — retrieval is strictly per-user.
export async function searchSimilarEmails(args: {
  userId: string;
  queryText: string;
  topK?: number;
  // Pass the current item's id to exclude it from its own retrieval. Memory:
  // "the 20 retrieved similar emails exclude the in-progress inbox_item_id".
  excludeInboxItemId?: string;
}): Promise<{
  results: SimilarEmail[];
  totalCandidates: number;
}> {
  const topK = args.topK ?? DEEP_PASS_TOP_K;
  return Sentry.startSpan(
    {
      name: "email.retrieval.searchSimilar",
      op: "db.query",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.top_k": topK,
      },
    },
    async () => {
      const { embedding } = await embedText({
        userId: args.userId,
        text: args.queryText,
      });
      const vec = `[${embedding.join(",")}]`;
      const excludeId = args.excludeInboxItemId ?? null;

      // Two queries, both scoped to the user: (1) top-K by cosine distance,
      // (2) the corpus size so provenance can record it. Single round-trip
      // would be nicer but Drizzle raw `sql` chunks don't trivially compose
      // two result sets.
      const candRows = await db.execute<{ total: number }>(sql`
        SELECT COUNT(*)::int AS total
        FROM email_embeddings
        WHERE user_id = ${args.userId}
      `);
      const totalCandidates = Number(
        (candRows as unknown as { rows: Array<{ total: number }> }).rows?.[0]
          ?.total ?? 0
      );

      const rowsRes = await db.execute<{
        inbox_item_id: string;
        distance: number;
        subject: string | null;
        snippet: string | null;
        received_at: Date;
        sender_email: string;
      }>(sql`
        SELECT
          ii.id AS inbox_item_id,
          (ee.embedding <=> ${vec}::vector(1536)) AS distance,
          ii.subject AS subject,
          ii.snippet AS snippet,
          ii.received_at AS received_at,
          ii.sender_email AS sender_email
        FROM email_embeddings ee
        JOIN inbox_items ii ON ii.id = ee.inbox_item_id
        WHERE ee.user_id = ${args.userId}
          AND ii.deleted_at IS NULL
          AND (${excludeId}::uuid IS NULL OR ee.inbox_item_id <> ${excludeId}::uuid)
        ORDER BY ee.embedding <=> ${vec}::vector(1536)
        LIMIT ${topK}
      `);

      const raw = (rowsRes as unknown as {
        rows: Array<{
          inbox_item_id: string;
          distance: number;
          subject: string | null;
          snippet: string | null;
          received_at: Date | string;
          sender_email: string;
        }>;
      }).rows ?? [];

      const results: SimilarEmail[] = raw.map((r) => ({
        inboxItemId: r.inbox_item_id,
        similarity: distanceToSimilarity(Number(r.distance)),
        subject: r.subject,
        snippet: r.snippet,
        receivedAt:
          r.received_at instanceof Date
            ? r.received_at
            : new Date(r.received_at),
        senderEmail: r.sender_email,
      }));

      return { results, totalCandidates };
    }
  );
}

// pgvector `<=>` returns cosine *distance* in [0, 2]. Convert to similarity
// in [0, 1] by `1 - distance/2`. Clamped for floating-point noise so callers
// don't see -0.0000001 or 1.0000001 in provenance payloads.
export function distanceToSimilarity(distance: number): number {
  const sim = 1 - distance / 2;
  if (!Number.isFinite(sim)) return 0;
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
}
