import "server-only";
import { db } from "@/lib/db/client";
import {
  notionConnections,
  registeredResources,
  auditLog,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { decrypt } from "@/lib/utils/crypto";
import { notionClientFromToken } from "@/lib/integrations/notion/client";
import type { Syllabus } from "./schema";

export type SyllabusVerbatim = {
  fullText: string;
  sourceKind: "pdf" | "image" | "url";
  blob?: {
    blobAssetId: string;
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
};

export const FULL_SOURCE_TOGGLE_LABEL = "Full source content";

export async function saveSyllabusToNotion(args: {
  userId: string;
  classNotionPageId?: string | null;
  syllabus: Syllabus;
  verbatim: SyllabusVerbatim;
}): Promise<{ pageId: string; url: string | null }> {
  const [conn] = await db
    .select()
    .from(notionConnections)
    .where(eq(notionConnections.userId, args.userId))
    .limit(1);
  if (!conn || !conn.syllabiDbId) {
    throw new Error("Syllabi database not set up for this user.");
  }

  const client = notionClientFromToken(decrypt(conn.accessTokenEncrypted));
  const { syllabus, classNotionPageId, verbatim } = args;

  const title = syllabus.courseName ?? syllabus.courseCode ?? "Untitled Syllabus";

  const properties: Record<string, unknown> = {
    Title: { title: [{ type: "text", text: { content: title } }] },
    Term: syllabus.term
      ? { rich_text: [{ type: "text", text: { content: syllabus.term } }] }
      : undefined,
    Grading: syllabus.grading
      ? { rich_text: [{ type: "text", text: { content: syllabus.grading } }] }
      : undefined,
    Attendance: syllabus.attendance
      ? { rich_text: [{ type: "text", text: { content: syllabus.attendance } }] }
      : undefined,
    Textbooks: syllabus.textbooks
      ? { rich_text: [{ type: "text", text: { content: syllabus.textbooks } }] }
      : undefined,
    OfficeHours: syllabus.officeHours
      ? {
          rich_text: [{ type: "text", text: { content: syllabus.officeHours } }],
        }
      : undefined,
    SourceURL: syllabus.sourceUrl ? { url: syllabus.sourceUrl } : undefined,
    Class: classNotionPageId
      ? { relation: [{ id: classNotionPageId }] }
      : undefined,
  };
  for (const k of Object.keys(properties)) {
    if (properties[k] === undefined) delete properties[k];
  }

  const page = await client.pages.create({
    parent: { type: "database_id", database_id: conn.syllabiDbId },
    properties: properties as Parameters<typeof client.pages.create>[0]["properties"],
    children: buildSyllabusBody(syllabus, verbatim),
  });

  const urlHolder = page as unknown as { url?: string };

  await db.insert(registeredResources).values({
    userId: args.userId,
    connectionId: conn.id,
    resourceType: "page",
    notionId: page.id,
    title,
    parentNotionId: conn.syllabiDbId,
    autoRegistered: 1,
  });

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "syllabus.save",
    toolName: null,
    resourceType: "notion_page",
    resourceId: page.id,
    result: "success",
    detail: {
      title,
      class: classNotionPageId ?? null,
      sourceKind: verbatim.sourceKind,
      blobUrl: verbatim.blob?.url ?? null,
    },
  });

  return { pageId: page.id, url: urlHolder.url ?? null };
}

export function buildSyllabusBody(
  syllabus: Syllabus,
  verbatim: SyllabusVerbatim
): Parameters<
  ReturnType<typeof notionClientFromToken>["pages"]["create"]
>[0]["children"] {
  const blocks: Array<Record<string, unknown>> = [];

  if (verbatim.blob) {
    blocks.push(h2("Original file"));
    blocks.push({
      object: "block",
      type: "file",
      file: {
        type: "external",
        external: { url: verbatim.blob.url },
        caption: [
          {
            type: "text",
            text: {
              content: `${verbatim.blob.filename} (${verbatim.blob.mimeType})`,
            },
          },
        ],
      },
    });
  } else if (verbatim.sourceKind === "url" && syllabus.sourceUrl) {
    blocks.push(h2("Original URL"));
    blocks.push({
      object: "block",
      type: "bookmark",
      bookmark: { url: syllabus.sourceUrl },
    });
  }

  if (syllabus.schedule && syllabus.schedule.length > 0) {
    blocks.push(h2("Schedule"));
    for (const s of syllabus.schedule) {
      const label = [s.date, s.topic].filter(Boolean).join(" — ");
      if (!label) continue;
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: label } }],
        },
      });
    }
  }

  if (verbatim.fullText && verbatim.fullText.trim().length > 0) {
    blocks.push({
      object: "block",
      type: "toggle",
      toggle: {
        rich_text: [
          { type: "text", text: { content: FULL_SOURCE_TOGGLE_LABEL } },
        ],
        children: paragraphsFromLongText(verbatim.fullText),
      },
    });
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

// Notion's per-rich-text cap is 2000 chars; per-block array cap is 100 blocks.
// We split the full text into paragraphs of up to ~1900 chars each.
export function paragraphsFromLongText(text: string): Array<Record<string, unknown>> {
  const MAX = 1900;
  const out: Array<Record<string, unknown>> = [];
  const lines = text.split(/\n\n+/);
  let buf = "";
  const flush = () => {
    if (!buf.trim()) return;
    out.push({
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: chunkToRichText(buf),
      },
    });
    buf = "";
  };
  for (const line of lines) {
    if (buf.length + line.length + 2 > MAX) {
      flush();
    }
    buf = buf ? `${buf}\n\n${line}` : line;
  }
  flush();
  // Hard-cap to avoid exceeding Notion's block limits on very long docs.
  return out.slice(0, 95);
}

function chunkToRichText(text: string): Array<{ type: "text"; text: { content: string } }> {
  const MAX = 1900;
  if (text.length <= MAX) return [{ type: "text", text: { content: text } }];
  const out: Array<{ type: "text"; text: { content: string } }> = [];
  for (let i = 0; i < text.length; i += MAX) {
    out.push({ type: "text", text: { content: text.slice(i, i + MAX) } });
  }
  return out;
}
