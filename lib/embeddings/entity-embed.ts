import "server-only";
import { db } from "@/lib/db/client";
import {
  mistakeNoteChunks,
  syllabusChunks,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { embedText } from "@/lib/agent/email/embeddings";
import { chunkText } from "./chunk";

// Replaces the chunk rows for a mistake note in a single transaction. We
// delete-then-insert rather than upserting per row because chunk identity
// (chunkIndex) is positional — if a body edit changes chunk boundaries,
// stale chunks would otherwise linger. Embedding cost is negligible at
// dogfood volume per scoping doc §7.5.
export async function refreshMistakeEmbeddings(args: {
  userId: string;
  mistakeId: string;
  text: string;
}): Promise<{ count: number }> {
  const chunks = chunkText(args.text);
  await db
    .delete(mistakeNoteChunks)
    .where(eq(mistakeNoteChunks.mistakeId, args.mistakeId));
  if (chunks.length === 0) return { count: 0 };

  for (const chunk of chunks) {
    const result = await embedText({
      userId: args.userId,
      text: chunk.text,
    });
    await db.insert(mistakeNoteChunks).values({
      userId: args.userId,
      mistakeId: args.mistakeId,
      chunkIndex: chunk.index,
      chunkText: chunk.text,
      embedding: result.embedding,
      model: result.model,
      tokenCount: result.tokenCount,
    });
  }
  return { count: chunks.length };
}

export async function refreshSyllabusEmbeddings(args: {
  userId: string;
  syllabusId: string;
  text: string;
}): Promise<{ count: number }> {
  const chunks = chunkText(args.text);
  await db
    .delete(syllabusChunks)
    .where(eq(syllabusChunks.syllabusId, args.syllabusId));
  if (chunks.length === 0) return { count: 0 };

  for (const chunk of chunks) {
    const result = await embedText({
      userId: args.userId,
      text: chunk.text,
    });
    await db.insert(syllabusChunks).values({
      userId: args.userId,
      syllabusId: args.syllabusId,
      chunkIndex: chunk.index,
      chunkText: chunk.text,
      embedding: result.embedding,
      model: result.model,
      tokenCount: result.tokenCount,
    });
  }
  return { count: chunks.length };
}
