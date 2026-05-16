import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";

// engineer-51 — entity-side embedding helper. Same text-embedding-3-small
// model as the email side so the vectors live in a shared semantic space
// (an email "アクメトラベル" and an entity "アクメトラベル" land near each
// other). Distinct from lib/agent/email/embeddings.ts because the input
// shape is different — entities embed display_name + aliases +
// description, not subject + body.

const EMBED_INPUT_MAX_CHARS = 800;

export type EntityEmbedResult = {
  embedding: number[];
  tokenCount: number;
  model: string;
};

export function buildEntityEmbedInput(args: {
  displayName: string;
  aliases?: string[];
  description?: string | null;
}): string {
  const parts: string[] = [args.displayName.trim()];
  if (args.aliases && args.aliases.length > 0) {
    parts.push(args.aliases.filter((a) => a.trim().length > 0).join(" "));
  }
  if (args.description && args.description.trim().length > 0) {
    parts.push(args.description.trim());
  }
  return parts.join("\n").slice(0, EMBED_INPUT_MAX_CHARS);
}

export async function embedEntityText(args: {
  userId: string;
  text: string;
}): Promise<EntityEmbedResult> {
  return Sentry.startSpan(
    {
      name: "openai.embeddings.create",
      op: "gen_ai.embed",
      attributes: {
        "steadii.user_id": args.userId,
        "steadii.task_type": "entity_embed",
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
