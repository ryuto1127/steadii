import "server-only";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  registeredResources,
  auditLog,
  messages as messagesTable,
  messageAttachments,
} from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "@/lib/integrations/notion/client";
import { assertCreditsAvailable } from "@/lib/billing/credits";
import { z } from "zod";

export const mistakeSaveSchema = z.object({
  chatId: z.string().uuid(),
  assistantMessageId: z.string().uuid(),
  title: z.string().min(1),
  classNotionPageId: z.string().optional().nullable(),
  unit: z.string().optional().nullable(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  tags: z.array(z.string()).optional(),
});

export type MistakeSaveInput = z.infer<typeof mistakeSaveSchema>;

export async function saveMistakeNote(args: {
  userId: string;
  input: MistakeSaveInput;
}): Promise<{ pageId: string; url: string | null }> {
  // C6 resolution: metered features (incl. mistake save) pause on credit
  // exhaustion. Memory: "Mistake-explain / syllabus-extract also pause
  // until top-up or reset." The save step itself is not LLM-metered but
  // the prompt explicitly names this callsite as part of the gate.
  await assertCreditsAvailable(args.userId);

  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, args.userId))
    .limit(1);
  if (!conn || !conn.mistakesDbId) {
    throw new Error("Mistake Notes database not set up for this user.");
  }

  // Fetch the assistant message + the prior user message (+ its attachments)
  const [assistantRow] = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.id, args.input.assistantMessageId),
        eq(messagesTable.chatId, args.input.chatId)
      )
    )
    .limit(1);
  if (!assistantRow) throw new Error("Assistant message not found");

  const preceding = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.chatId, args.input.chatId));

  const user = preceding
    .filter(
      (m) =>
        m.role === "user" &&
        m.createdAt.getTime() < assistantRow.createdAt.getTime()
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];

  const userMessageIds = user ? [user.id] : [];
  const attachments = userMessageIds.length
    ? await db
        .select()
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, userMessageIds))
    : [];
  const imageUrls = attachments.filter((a) => a.kind === "image").map((a) => a.url);

  const client = notionClientFromToken(decrypt(conn.accessTokenEncrypted));
  const { input } = args;

  const properties: Record<string, unknown> = {
    Title: { title: [{ type: "text", text: { content: input.title } }] },
    Date: { date: { start: new Date().toISOString().slice(0, 10) } },
    Unit: input.unit
      ? { rich_text: [{ type: "text", text: { content: input.unit } }] }
      : undefined,
    Difficulty: input.difficulty
      ? { select: { name: input.difficulty } }
      : undefined,
    Tags:
      input.tags && input.tags.length
        ? { multi_select: input.tags.map((t) => ({ name: t })) }
        : undefined,
    Class: input.classNotionPageId
      ? { relation: [{ id: input.classNotionPageId }] }
      : undefined,
    Image:
      imageUrls.length > 0
        ? {
            files: imageUrls.map((url, i) => ({
              name: `image-${i + 1}`,
              type: "external",
              external: { url },
            })),
          }
        : undefined,
  };
  for (const k of Object.keys(properties)) {
    if (properties[k] === undefined) delete properties[k];
  }

  const children = buildMistakeBody({
    userQuestion: user?.content ?? "",
    assistantExplanation: assistantRow.content ?? "",
    imageUrls,
  });

  const page = await client.pages.create({
    parent: { type: "database_id", database_id: conn.mistakesDbId },
    properties: properties as Parameters<typeof client.pages.create>[0]["properties"],
    children,
  });
  const urlHolder = page as unknown as { url?: string };

  await db.insert(registeredResources).values({
    userId: args.userId,
    connectionId: conn.id,
    resourceType: "page",
    notionId: page.id,
    title: input.title,
    parentNotionId: conn.mistakesDbId,
    autoRegistered: 1,
  });

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "mistake.save",
    toolName: null,
    resourceType: "notion_page",
    resourceId: page.id,
    result: "success",
    detail: { title: input.title, class: input.classNotionPageId ?? null },
  });

  return { pageId: page.id, url: urlHolder.url ?? null };
}

export function buildMistakeBody(args: {
  userQuestion: string;
  assistantExplanation: string;
  imageUrls: string[];
}) {
  const blocks: Array<Record<string, unknown>> = [];

  for (const url of args.imageUrls) {
    blocks.push({
      object: "block",
      type: "image",
      image: { type: "external", external: { url } },
    });
  }

  if (args.userQuestion.trim()) {
    blocks.push(h2("The problem"));
    blocks.push(paragraph(args.userQuestion));
  }

  if (args.assistantExplanation.trim()) {
    blocks.push(h2("Step-by-step explanation"));
    for (const chunk of splitIntoParagraphs(args.assistantExplanation)) {
      blocks.push(paragraph(chunk));
    }
  }

  return blocks as Parameters<
    ReturnType<typeof notionClientFromToken>["pages"]["create"]
  >[0]["children"];
}

function h2(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "heading_2",
    heading_2: { rich_text: [{ type: "text", text: { content: text } }] },
  };
}

function paragraph(text: string): Record<string, unknown> {
  return {
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: chunkForNotion(text).map((c) => ({
        type: "text",
        text: { content: c },
      })),
    },
  };
}

function splitIntoParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

function chunkForNotion(text: string): string[] {
  // Notion's per-rich-text content cap is 2000 chars
  const MAX = 1900;
  if (text.length <= MAX) return [text];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += MAX) {
    out.push(text.slice(i, i + MAX));
  }
  return out;
}
