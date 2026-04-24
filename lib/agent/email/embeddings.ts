import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { emailEmbeddings } from "@/lib/db/schema";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";

// Subject+body input for embedding is clamped so a runaway email body can't
// send a 200k-token block to OpenAI. 2k chars covers ~500 tokens of average
// email content — plenty to differentiate threads for cosine retrieval.
const EMBED_INPUT_MAX_CHARS = 2000;

export type EmbedResult = {
  embedding: number[];
  tokenCount: number;
  model: string;
};

export function buildEmbedInput(
  subject: string | null | undefined,
  body: string | null | undefined
): string {
  const subj = (subject ?? "").trim();
  const b = (body ?? "").trim();
  const joined = subj && b ? `${subj}\n\n${b}` : subj || b;
  return joined.slice(0, EMBED_INPUT_MAX_CHARS);
}

// Core OpenAI embedding helper. Records usage under the `email_embed` task
// type so credits account correctly. Caller handles idempotency — this
// function always issues a fresh API call.
export async function embedText(args: {
  userId: string;
  text: string;
}): Promise<EmbedResult> {
  return Sentry.startSpan(
    {
      name: "openai.embeddings.create",
      op: "gen_ai.embed",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.task_type": "email_embed",
      },
    },
    async () => {
      const model = selectModel("email_embed");
      const resp = await openai().embeddings.create({
        model,
        input: args.text,
      });
      const row = resp.data[0];
      if (!row) throw new Error("OpenAI returned no embedding row.");
      const tokenCount = resp.usage?.prompt_tokens ?? 0;
      await recordUsage({
        userId: args.userId,
        model,
        taskType: "email_embed",
        inputTokens: tokenCount,
        outputTokens: 0,
        cachedTokens: 0,
      });
      return { embedding: row.embedding, tokenCount, model };
    }
  );
}

// Idempotent embed-and-insert for a single inbox_item. Returns `null` when a
// row already exists for this inbox_item_id (per the unique constraint) or
// when the input is empty; returns the new row id otherwise.
export async function embedAndStoreInboxItem(args: {
  userId: string;
  inboxItemId: string;
  subject: string | null;
  body: string | null;
}): Promise<{ id: string } | null> {
  const existing = await db
    .select({ id: emailEmbeddings.id })
    .from(emailEmbeddings)
    .where(
      and(
        eq(emailEmbeddings.inboxItemId, args.inboxItemId),
        eq(emailEmbeddings.userId, args.userId)
      )
    )
    .limit(1);
  if (existing.length > 0) return null;

  const input = buildEmbedInput(args.subject, args.body);
  if (!input) return null;

  const result = await embedText({ userId: args.userId, text: input });

  const inserted = await db
    .insert(emailEmbeddings)
    .values({
      userId: args.userId,
      inboxItemId: args.inboxItemId,
      embedding: result.embedding,
      model: result.model,
      tokenCount: result.tokenCount,
    })
    .onConflictDoNothing({ target: emailEmbeddings.inboxItemId })
    .returning({ id: emailEmbeddings.id });

  return inserted[0] ?? null;
}
