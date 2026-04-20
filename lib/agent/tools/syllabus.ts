import "server-only";
import { z } from "zod";
import type { ToolExecutor } from "./types";
import { getNotionClientForUser } from "@/lib/integrations/notion/client";

async function getClient(userId: string) {
  const c = await getNotionClientForUser(userId);
  if (!c) throw new Error("Notion is not connected for this user.");
  return c;
}

const FULL_SOURCE_LABEL = "Full source content";

const args = z.object({
  syllabusPageId: z.string().min(1),
});

export const readSyllabusFullText: ToolExecutor<
  z.infer<typeof args>,
  {
    syllabusPageId: string;
    found: boolean;
    fullText: string;
    truncated: boolean;
  }
> = {
  schema: {
    name: "read_syllabus_full_text",
    description:
      "Fetch the verbatim 'Full source content' preserved when a syllabus was saved (the original PDF text with page markers, cleaned URL content, or Vision transcription). Use this to answer questions that aren't covered by the structured syllabus properties — grading rubric wording, exact attendance rules, specific dates from the schedule, etc.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: { syllabusPageId: { type: "string" } },
      required: ["syllabusPageId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    const fullText = await extractFullSourceToggleText(client, parsed.syllabusPageId);
    const MAX_CHARS = 60_000;
    const truncated = fullText.length > MAX_CHARS;
    return {
      syllabusPageId: parsed.syllabusPageId,
      found: fullText.length > 0,
      fullText: truncated ? fullText.slice(0, MAX_CHARS) : fullText,
      truncated,
    };
  },
};

type NotionClient = Awaited<ReturnType<typeof getNotionClientForUser>> extends { client: infer C } | null
  ? C
  : never;

async function extractFullSourceToggleText(
  client: NonNullable<NotionClient>,
  pageId: string
): Promise<string> {
  const parts: string[] = [];
  let cursor: string | undefined;
  do {
    const resp = await client.blocks.children.list({
      block_id: pageId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const block of resp.results) {
      if (!("type" in block)) continue;
      if (block.type === "toggle") {
        const label = block.toggle.rich_text
          .map((t: { plain_text?: string }) => t.plain_text ?? "")
          .join("");
        if (label.trim() === FULL_SOURCE_LABEL) {
          await collectChildText(client, block.id, parts);
        }
      }
    }
    cursor = resp.next_cursor ?? undefined;
  } while (cursor);
  return parts.join("\n\n").trim();
}

async function collectChildText(
  client: NonNullable<NotionClient>,
  blockId: string,
  out: string[]
): Promise<void> {
  let cursor: string | undefined;
  do {
    const resp = await client.blocks.children.list({
      block_id: blockId,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const child of resp.results) {
      if (!("type" in child)) continue;
      if (child.type === "paragraph" && "paragraph" in child) {
        const text = child.paragraph.rich_text
          .map((t: { plain_text?: string }) => t.plain_text ?? "")
          .join("");
        if (text) out.push(text);
      }
    }
    cursor = resp.next_cursor ?? undefined;
  } while (cursor);
}

export const SYLLABUS_TOOLS = [readSyllabusFullText];
