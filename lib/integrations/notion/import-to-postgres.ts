import "server-only";
import { db } from "@/lib/db/client";
import {
  assignments as assignmentsTable,
  auditLog,
  classes as classesTable,
  mistakeNotes,
  syllabi,
} from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import type { Client } from "@notionhq/client";
import { getNotionClientForUser } from "./client";
import { resolveDataSourceId } from "./data-source";
import { refreshMistakeEmbeddings, refreshSyllabusEmbeddings } from "@/lib/embeddings/entity-embed";
import type { ClassColorEnum } from "@/lib/db/schema";

export type ImportSummary = {
  classes: { inserted: number; updated: number; skipped: number };
  assignments: { inserted: number; updated: number; skipped: number };
  mistakes: { inserted: number; updated: number; skipped: number };
  syllabi: { inserted: number; updated: number; skipped: number };
  durationMs: number;
};

const COLOR_VALUES: ClassColorEnum[] = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "gray",
  "brown",
  "pink",
];
function normalizeColor(value: string | null): ClassColorEnum | null {
  if (!value) return null;
  const lower = value.toLowerCase() as ClassColorEnum;
  return COLOR_VALUES.includes(lower) ? lower : null;
}

function blank(): ImportSummary[keyof Pick<
  ImportSummary,
  "classes"
>] {
  return { inserted: 0, updated: 0, skipped: 0 };
}

// Idempotent. Walks Classes → Assignments → Mistakes → Syllabi in order so
// FK references resolve. (user_id, notion_page_id) unique indexes back the
// upsert behavior; embedding population is fire-and-forget per entity.
export async function importNotionWorkspace(args: {
  userId: string;
  dryRun?: boolean;
  onProgress?: (msg: string) => void;
}): Promise<ImportSummary> {
  const start = Date.now();
  const { userId, dryRun = false } = args;
  const log = args.onProgress ?? (() => {});

  const summary: ImportSummary = {
    classes: blank(),
    assignments: blank(),
    mistakes: blank(),
    syllabi: blank(),
    durationMs: 0,
  };

  const conn = await getNotionClientForUser(userId);
  if (!conn) {
    throw new Error("No Notion connection on this user");
  }
  const { client, connection } = conn;

  const classMap = new Map<string, string>();

  if (connection.classesDbId) {
    log("Importing classes…");
    const rows = await fetchAllPages(client, connection.classesDbId);
    for (const page of rows) {
      const props = pageProps(page);
      const name = extractTitle(props);
      if (!name) {
        summary.classes.skipped += 1;
        continue;
      }
      const code = getRichText(props, "Code");
      const term = getSelectName(props, "Term");
      const professor = getRichText(props, "Professor");
      const colorRaw = getSelectName(props, "Color");
      const color = normalizeColor(colorRaw);
      const status =
        getSelectName(props, "Status") === "archived" ? "archived" : "active";

      if (dryRun) {
        summary.classes.inserted += 1;
        continue;
      }

      const existing = await db
        .select({ id: classesTable.id })
        .from(classesTable)
        .where(
          and(
            eq(classesTable.userId, userId),
            eq(classesTable.notionPageId, page.id)
          )
        )
        .limit(1);

      if (existing.length) {
        await db
          .update(classesTable)
          .set({
            name,
            code,
            term,
            professor,
            color,
            status,
            updatedAt: new Date(),
          })
          .where(eq(classesTable.id, existing[0].id));
        classMap.set(page.id, existing[0].id);
        summary.classes.updated += 1;
      } else {
        const [inserted] = await db
          .insert(classesTable)
          .values({
            userId,
            name,
            code,
            term,
            professor,
            color,
            status,
            notionPageId: page.id,
          })
          .returning({ id: classesTable.id });
        classMap.set(page.id, inserted.id);
        summary.classes.inserted += 1;
      }
    }
  }

  if (connection.assignmentsDbId) {
    log("Importing assignments…");
    const rows = await fetchAllPages(client, connection.assignmentsDbId);
    for (const page of rows) {
      const props = pageProps(page);
      const title = extractTitle(props);
      if (!title) {
        summary.assignments.skipped += 1;
        continue;
      }
      const dueIso =
        (props["Due"] as { date?: { start?: string } } | undefined)?.date
          ?.start ?? null;
      const status = mapAssignmentStatus(getSelectName(props, "Status"));
      const priority = mapPriority(getSelectName(props, "Priority"));
      const notes = getRichText(props, "Notes");
      const classRel = getRelationIds(props, "Class")[0] ?? null;
      const classId = classRel ? classMap.get(classRel) ?? null : null;

      if (dryRun) {
        summary.assignments.inserted += 1;
        continue;
      }

      const existing = await db
        .select({ id: assignmentsTable.id })
        .from(assignmentsTable)
        .where(
          and(
            eq(assignmentsTable.userId, userId),
            eq(assignmentsTable.notionPageId, page.id)
          )
        )
        .limit(1);

      if (existing.length) {
        await db
          .update(assignmentsTable)
          .set({
            title,
            dueAt: dueIso ? new Date(dueIso) : null,
            status,
            priority,
            notes,
            classId,
            updatedAt: new Date(),
          })
          .where(eq(assignmentsTable.id, existing[0].id));
        summary.assignments.updated += 1;
      } else {
        await db.insert(assignmentsTable).values({
          userId,
          title,
          dueAt: dueIso ? new Date(dueIso) : null,
          status,
          priority,
          notes,
          source: "manual",
          classId,
          notionPageId: page.id,
        });
        summary.assignments.inserted += 1;
      }
    }
  }

  if (connection.mistakesDbId) {
    log("Importing mistake notes…");
    const rows = await fetchAllPages(client, connection.mistakesDbId);
    for (const page of rows) {
      const props = pageProps(page);
      const title = extractTitle(props);
      if (!title) {
        summary.mistakes.skipped += 1;
        continue;
      }
      const unit = getRichText(props, "Unit");
      const difficulty = mapDifficulty(getSelectName(props, "Difficulty"));
      const tags = getMultiSelectNames(props, "Tags");
      const classRel = getRelationIds(props, "Class")[0] ?? null;
      const classId = classRel ? classMap.get(classRel) ?? null : null;

      // Pull the body blocks and stitch them into markdown for verbatim
      // preservation. Mirrors what the chat-side save built originally.
      const blocks = await fetchPageBlocks(client, page.id);
      const bodyMarkdown = blocksToMarkdown(blocks);

      if (dryRun) {
        summary.mistakes.inserted += 1;
        continue;
      }

      const existing = await db
        .select({ id: mistakeNotes.id })
        .from(mistakeNotes)
        .where(
          and(
            eq(mistakeNotes.userId, userId),
            eq(mistakeNotes.notionPageId, page.id)
          )
        )
        .limit(1);

      let mistakeId: string;
      if (existing.length) {
        await db
          .update(mistakeNotes)
          .set({
            title,
            unit,
            difficulty,
            tags,
            classId,
            bodyMarkdown,
            bodyFormat: "markdown",
            updatedAt: new Date(),
          })
          .where(eq(mistakeNotes.id, existing[0].id));
        mistakeId = existing[0].id;
        summary.mistakes.updated += 1;
      } else {
        const [row] = await db
          .insert(mistakeNotes)
          .values({
            userId,
            title,
            unit,
            difficulty,
            tags,
            classId,
            bodyFormat: "markdown",
            bodyMarkdown,
            notionPageId: page.id,
          })
          .returning({ id: mistakeNotes.id });
        mistakeId = row.id;
        summary.mistakes.inserted += 1;
      }

      try {
        await refreshMistakeEmbeddings({
          userId,
          mistakeId,
          text: bodyMarkdown,
        });
      } catch (err) {
        log(`embedding failed for mistake ${mistakeId}: ${err}`);
      }
    }
  }

  if (connection.syllabiDbId) {
    log("Importing syllabi…");
    const rows = await fetchAllPages(client, connection.syllabiDbId);
    for (const page of rows) {
      const props = pageProps(page);
      const title = extractTitle(props) ?? "Untitled syllabus";
      const term = getRichText(props, "Term");
      const grading = getRichText(props, "Grading");
      const attendance = getRichText(props, "Attendance");
      const textbooks = getRichText(props, "Textbooks");
      const officeHours = getRichText(props, "OfficeHours");
      const sourceUrl = (
        props["SourceURL"] as { url?: string } | undefined
      )?.url ?? null;
      const classRel = getRelationIds(props, "Class")[0] ?? null;
      const classId = classRel ? classMap.get(classRel) ?? null : null;

      const blocks = await fetchPageBlocks(client, page.id);
      const fullText = extractFullSourceText(blocks);

      if (dryRun) {
        summary.syllabi.inserted += 1;
        continue;
      }

      const existing = await db
        .select({ id: syllabi.id })
        .from(syllabi)
        .where(
          and(
            eq(syllabi.userId, userId),
            eq(syllabi.notionPageId, page.id)
          )
        )
        .limit(1);

      let syllabusId: string;
      if (existing.length) {
        await db
          .update(syllabi)
          .set({
            title,
            term,
            grading,
            attendance,
            textbooks,
            officeHours,
            sourceUrl,
            sourceKind: sourceUrl ? "url" : "pdf",
            fullText,
            classId,
            updatedAt: new Date(),
          })
          .where(eq(syllabi.id, existing[0].id));
        syllabusId = existing[0].id;
        summary.syllabi.updated += 1;
      } else {
        const [row] = await db
          .insert(syllabi)
          .values({
            userId,
            title,
            term,
            grading,
            attendance,
            textbooks,
            officeHours,
            sourceUrl,
            sourceKind: sourceUrl ? "url" : "pdf",
            fullText,
            classId,
            notionPageId: page.id,
          })
          .returning({ id: syllabi.id });
        syllabusId = row.id;
        summary.syllabi.inserted += 1;
      }

      if (fullText) {
        try {
          await refreshSyllabusEmbeddings({
            userId,
            syllabusId,
            text: fullText,
          });
        } catch (err) {
          log(`embedding failed for syllabus ${syllabusId}: ${err}`);
        }
      }
    }
  }

  summary.durationMs = Date.now() - start;

  if (!dryRun) {
    await db.insert(auditLog).values({
      userId,
      action: "notion.import",
      resourceType: "notion_workspace",
      result: "success",
      detail: summary as unknown as Record<string, unknown>,
    });
  }
  return summary;
}

async function fetchAllPages(
  client: Client,
  databaseId: string
): Promise<Array<{ id: string; properties?: Record<string, unknown> }>> {
  const dsId = await resolveDataSourceId(client, databaseId);
  const out: Array<{ id: string; properties?: Record<string, unknown> }> = [];
  let cursor: string | undefined;
  do {
    const resp = (await client.dataSources.query({
      data_source_id: dsId,
      page_size: 100,
      start_cursor: cursor,
    })) as unknown as {
      results: Array<{ id: string; properties?: Record<string, unknown> }>;
      next_cursor?: string;
      has_more?: boolean;
    };
    out.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return out;
}

async function fetchPageBlocks(
  client: Client,
  pageId: string
): Promise<Array<Record<string, unknown>>> {
  const all: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  do {
    const resp = (await client.blocks.children.list({
      block_id: pageId,
      page_size: 100,
      start_cursor: cursor,
    })) as unknown as {
      results: Array<Record<string, unknown>>;
      next_cursor?: string;
      has_more?: boolean;
    };
    all.push(...resp.results);
    cursor = resp.has_more ? resp.next_cursor : undefined;
  } while (cursor);
  return all;
}

function pageProps(
  page: { id: string; properties?: Record<string, unknown> }
): Record<string, unknown> {
  return page.properties ?? {};
}

function extractTitle(props: Record<string, unknown>): string | null {
  for (const value of Object.values(props)) {
    const v = value as {
      type?: string;
      title?: Array<{ plain_text?: string }>;
    };
    if (v?.type === "title" && Array.isArray(v.title) && v.title.length) {
      return (
        v.title
          .map((t) => t.plain_text ?? "")
          .join("")
          .trim() || null
      );
    }
  }
  return null;
}

function getRichText(
  props: Record<string, unknown>,
  key: string
): string | null {
  const v = props[key] as
    | { rich_text?: Array<{ plain_text?: string }> }
    | undefined;
  if (!v?.rich_text?.length) return null;
  return (
    v.rich_text
      .map((t) => t.plain_text ?? "")
      .join("")
      .trim() || null
  );
}

function getSelectName(
  props: Record<string, unknown>,
  key: string
): string | null {
  const v = props[key] as { select?: { name?: string } | null } | undefined;
  return v?.select?.name ?? null;
}

function getMultiSelectNames(
  props: Record<string, unknown>,
  key: string
): string[] {
  const v = props[key] as
    | { multi_select?: Array<{ name?: string }> }
    | undefined;
  return (
    v?.multi_select
      ?.map((m) => m.name ?? "")
      .filter((s): s is string => Boolean(s)) ?? []
  );
}

function getRelationIds(
  props: Record<string, unknown>,
  key: string
): string[] {
  const v = props[key] as
    | { relation?: Array<{ id?: string }> }
    | undefined;
  return (
    v?.relation
      ?.map((r) => r.id)
      .filter((id): id is string => Boolean(id)) ?? []
  );
}

function mapAssignmentStatus(
  raw: string | null
): "not_started" | "in_progress" | "done" {
  const v = (raw ?? "").toLowerCase().replace(/\s+/g, "_");
  if (v === "done" || v === "complete" || v === "completed") return "done";
  if (v === "in_progress" || v === "doing") return "in_progress";
  return "not_started";
}

function mapPriority(raw: string | null): "low" | "medium" | "high" | null {
  const v = (raw ?? "").toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v as "low" | "medium" | "high";
  return null;
}

function mapDifficulty(raw: string | null): "easy" | "medium" | "hard" | null {
  const v = (raw ?? "").toLowerCase();
  if (v === "easy" || v === "medium" || v === "hard") return v;
  return null;
}

// Stitches the visible content of a Notion page back into markdown. Covers
// the block types our own writers produce — heading_2 / paragraph / image
// / bulleted_list_item / numbered_list_item — plus a best-effort fall-through.
function blocksToMarkdown(blocks: Array<Record<string, unknown>>): string {
  const out: string[] = [];
  for (const raw of blocks) {
    const b = raw as { type?: string };
    const type = b.type ?? "";
    const inner = (raw as Record<string, unknown>)[type] as
      | { rich_text?: Array<{ plain_text?: string }> }
      | undefined;
    const text = inner?.rich_text?.map((t) => t.plain_text ?? "").join("") ?? "";
    switch (type) {
      case "heading_1":
        out.push(`# ${text}`);
        break;
      case "heading_2":
        out.push(`## ${text}`);
        break;
      case "heading_3":
        out.push(`### ${text}`);
        break;
      case "paragraph":
        if (text.trim()) out.push(text);
        break;
      case "bulleted_list_item":
        out.push(`- ${text}`);
        break;
      case "numbered_list_item":
        out.push(`1. ${text}`);
        break;
      case "code":
        out.push(`\n\`\`\`\n${text}\n\`\`\`\n`);
        break;
      case "image": {
        const img = (raw as Record<string, unknown>).image as
          | {
              type?: string;
              external?: { url?: string };
              file?: { url?: string };
            }
          | undefined;
        const url = img?.external?.url ?? img?.file?.url;
        if (url) out.push(`![](${url})`);
        break;
      }
      case "quote":
        if (text.trim()) out.push(`> ${text}`);
        break;
      default:
        if (text.trim()) out.push(text);
    }
  }
  return out.join("\n\n");
}

// The "Full source content" toggle is a single block with children that
// hold the verbatim syllabus text. Walk it back out for the import.
function extractFullSourceText(
  blocks: Array<Record<string, unknown>>
): string | null {
  for (const raw of blocks) {
    const b = raw as { type?: string };
    if (b.type !== "toggle") continue;
    const toggle = (raw as Record<string, unknown>).toggle as
      | { rich_text?: Array<{ plain_text?: string }> }
      | undefined;
    const label = toggle?.rich_text?.map((t) => t.plain_text ?? "").join("") ?? "";
    if (!label.toLowerCase().includes("full source")) continue;
    const children = (raw as Record<string, unknown>).children as
      | Array<Record<string, unknown>>
      | undefined;
    if (!children) {
      // Fallback: the SDK may not expand children inline; signal that the
      // body is present but unreadable from the listing call. Caller can
      // re-fetch with blocks.children.list({ block_id: toggleId }) if needed.
      return null;
    }
    return blocksToMarkdown(children);
  }
  // No verbatim toggle — stitch every paragraph block as a fallback so
  // we still ingest some text rather than empty.
  return blocksToMarkdown(blocks).trim() || null;
}
