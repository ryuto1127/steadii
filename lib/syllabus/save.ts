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

export async function saveSyllabusToNotion(args: {
  userId: string;
  classNotionPageId?: string | null;
  syllabus: Syllabus;
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
  const { syllabus, classNotionPageId } = args;

  const title =
    syllabus.courseName ??
    syllabus.courseCode ??
    "Untitled Syllabus";

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
    children: scheduleAsBlocks(syllabus),
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
    detail: { title, class: classNotionPageId ?? null },
  });

  return { pageId: page.id, url: urlHolder.url ?? null };
}

function scheduleAsBlocks(syllabus: Syllabus): Parameters<
  ReturnType<typeof notionClientFromToken>["pages"]["create"]
>[0]["children"] {
  const blocks: Array<Record<string, unknown>> = [];
  if (syllabus.schedule && syllabus.schedule.length > 0) {
    blocks.push({
      object: "block",
      type: "heading_2",
      heading_2: {
        rich_text: [{ type: "text", text: { content: "Schedule" } }],
      },
    });
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
  return blocks as Parameters<
    ReturnType<typeof notionClientFromToken>["pages"]["create"]
  >[0]["children"];
}
