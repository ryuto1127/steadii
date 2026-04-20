import "server-only";
import { z } from "zod";
import { getNotionClientForUser } from "@/lib/integrations/notion/client";
import { resolveDataSourceId } from "@/lib/integrations/notion/data-source";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import type { ToolExecutor } from "./types";

async function getClient(userId: string) {
  const c = await getNotionClientForUser(userId);
  if (!c) throw new NotionNotConnectedError();
  return c;
}

export class NotionNotConnectedError extends Error {
  code = "NOTION_NOT_CONNECTED" as const;
  constructor() {
    super("Notion is not connected for this user.");
  }
}

async function logAudit(args: {
  userId: string;
  action: string;
  toolName: string;
  resourceId?: string | null;
  resourceType?: string | null;
  result: "success" | "failure";
  detail?: Record<string, unknown>;
}) {
  await db.insert(auditLog).values({
    userId: args.userId,
    action: args.action,
    toolName: args.toolName,
    resourceType: args.resourceType ?? null,
    resourceId: args.resourceId ?? null,
    result: args.result,
    detail: args.detail ?? null,
  });
}

// ---------- notion_search_pages ----------
const searchArgsSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional(),
});

export const notionSearchPages: ToolExecutor<
  z.infer<typeof searchArgsSchema>,
  { results: Array<{ id: string; title: string | null; url: string; object: string }> }
> = {
  schema: {
    name: "notion_search_pages",
    description:
      "Search the user's registered Notion pages/databases by a free-text query.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search" },
        limit: { type: "integer", minimum: 1, maximum: 50 },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = searchArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    const resp = await client.search({
      query: args.query,
      page_size: args.limit ?? 10,
    });
    const results = resp.results.map((r) => {
      const obj = r as unknown as {
        id: string;
        object: string;
        url?: string;
        properties?: { title?: { title?: Array<{ plain_text?: string }> } };
      };
      const title = obj.properties?.title?.title?.[0]?.plain_text ?? null;
      return {
        id: obj.id,
        title,
        url: obj.url ?? "",
        object: obj.object,
      };
    });
    return { results };
  },
};

// ---------- notion_get_page ----------
const getPageArgsSchema = z.object({ pageId: z.string().min(1) });

export const notionGetPage: ToolExecutor<
  z.infer<typeof getPageArgsSchema>,
  { page: unknown; blocks: unknown[] }
> = {
  schema: {
    name: "notion_get_page",
    description: "Fetch a Notion page's metadata and top-level block content.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = getPageArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    const [page, blocks] = await Promise.all([
      client.pages.retrieve({ page_id: args.pageId }),
      client.blocks.children.list({ block_id: args.pageId, page_size: 100 }),
    ]);
    return { page, blocks: blocks.results };
  },
};

// ---------- notion_create_page ----------
const createPageArgsSchema = z.object({
  parentPageId: z.string().min(1),
  title: z.string().min(1),
  content: z.string().optional(),
});

export const notionCreatePage: ToolExecutor<
  z.infer<typeof createPageArgsSchema>,
  { pageId: string; url: string | null }
> = {
  schema: {
    name: "notion_create_page",
    description:
      "Create a new Notion page under the given parent page. The title is required. Body paragraphs (content) are optional.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        parentPageId: { type: "string" },
        title: { type: "string" },
        content: { type: "string" },
      },
      required: ["parentPageId", "title"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = createPageArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    try {
      const page = await client.pages.create({
        parent: { type: "page_id", page_id: args.parentPageId },
        properties: {
          title: {
            title: [{ type: "text", text: { content: args.title } }],
          },
        },
        children: args.content
          ? [
              {
                object: "block",
                type: "paragraph",
                paragraph: {
                  rich_text: [{ type: "text", text: { content: args.content } }],
                },
              },
            ]
          : undefined,
      });
      const urlHolder = page as unknown as { url?: string };
      await logAudit({
        userId: ctx.userId,
        action: "notion.page.create",
        toolName: "notion_create_page",
        resourceType: "notion_page",
        resourceId: page.id,
        result: "success",
        detail: { title: args.title, parent: args.parentPageId },
      });
      return { pageId: page.id, url: urlHolder.url ?? null };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "notion.page.create",
        toolName: "notion_create_page",
        resourceType: "notion_page",
        result: "failure",
        detail: {
          message: err instanceof Error ? err.message : String(err),
          parent: args.parentPageId,
        },
      });
      throw err;
    }
  },
};

// ---------- notion_update_page ----------
const updatePageArgsSchema = z.object({
  pageId: z.string().min(1),
  appendParagraph: z.string().optional(),
  archived: z.boolean().optional(),
});

export const notionUpdatePage: ToolExecutor<
  z.infer<typeof updatePageArgsSchema>,
  { pageId: string }
> = {
  schema: {
    name: "notion_update_page",
    description:
      "Append a paragraph to a Notion page, or toggle its archived flag. For deleting, use notion_delete_page.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        appendParagraph: { type: "string" },
        archived: { type: "boolean" },
      },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = updatePageArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    try {
      if (args.appendParagraph) {
        await client.blocks.children.append({
          block_id: args.pageId,
          children: [
            {
              object: "block",
              type: "paragraph",
              paragraph: {
                rich_text: [
                  { type: "text", text: { content: args.appendParagraph } },
                ],
              },
            },
          ],
        });
      }
      if (typeof args.archived === "boolean") {
        await client.pages.update({ page_id: args.pageId, archived: args.archived });
      }
      await logAudit({
        userId: ctx.userId,
        action: "notion.page.update",
        toolName: "notion_update_page",
        resourceType: "notion_page",
        resourceId: args.pageId,
        result: "success",
        detail: { appended: !!args.appendParagraph, archived: args.archived },
      });
      return { pageId: args.pageId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "notion.page.update",
        toolName: "notion_update_page",
        resourceType: "notion_page",
        resourceId: args.pageId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

// ---------- notion_delete_page ----------
const deletePageArgsSchema = z.object({ pageId: z.string().min(1) });

export const notionDeletePage: ToolExecutor<
  z.infer<typeof deletePageArgsSchema>,
  { pageId: string }
> = {
  schema: {
    name: "notion_delete_page",
    description:
      "Archive (delete) a Notion page. DESTRUCTIVE: requires user confirmation.",
    mutability: "destructive",
    parameters: {
      type: "object",
      properties: { pageId: { type: "string" } },
      required: ["pageId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = deletePageArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    try {
      await client.pages.update({ page_id: args.pageId, archived: true });
      await logAudit({
        userId: ctx.userId,
        action: "notion.page.delete",
        toolName: "notion_delete_page",
        resourceType: "notion_page",
        resourceId: args.pageId,
        result: "success",
      });
      return { pageId: args.pageId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "notion.page.delete",
        toolName: "notion_delete_page",
        resourceType: "notion_page",
        resourceId: args.pageId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

// ---------- notion_query_database ----------
const queryDbArgsSchema = z.object({
  databaseId: z.string().min(1),
  limit: z.number().int().positive().max(100).optional(),
  filter: z.unknown().optional(),
  sorts: z.unknown().optional(),
});

export const notionQueryDatabase: ToolExecutor<
  z.infer<typeof queryDbArgsSchema>,
  { results: unknown[]; has_more: boolean }
> = {
  schema: {
    name: "notion_query_database",
    description:
      "Query a Notion database. Optional `filter` and `sorts` must match Notion's query API shape.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        databaseId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        filter: { type: "object" },
        sorts: { type: "array", items: { type: "object" } },
      },
      required: ["databaseId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = queryDbArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    const dsId = await resolveDataSourceId(client, args.databaseId);
    const resp = await client.dataSources.query({
      data_source_id: dsId,
      page_size: args.limit ?? 25,
      filter: args.filter as Parameters<typeof client.dataSources.query>[0]["filter"],
      sorts: args.sorts as Parameters<typeof client.dataSources.query>[0]["sorts"],
    });
    return { results: resp.results, has_more: resp.has_more };
  },
};

// ---------- notion_create_row ----------
const createRowArgsSchema = z.object({
  databaseId: z.string().min(1),
  properties: z.record(z.string(), z.unknown()),
});

export const notionCreateRow: ToolExecutor<
  z.infer<typeof createRowArgsSchema>,
  { pageId: string }
> = {
  schema: {
    name: "notion_create_row",
    description:
      "Create a new row in a Notion database. `properties` must match the database schema — see AGENTS.md §4.1 for the 4 Steadii DBs.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        databaseId: { type: "string" },
        properties: { type: "object" },
      },
      required: ["databaseId", "properties"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = createRowArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    try {
      const row = await client.pages.create({
        parent: { type: "database_id", database_id: args.databaseId },
        properties: args.properties as Parameters<typeof client.pages.create>[0]["properties"],
      });
      await logAudit({
        userId: ctx.userId,
        action: "notion.row.create",
        toolName: "notion_create_row",
        resourceType: "notion_database",
        resourceId: args.databaseId,
        result: "success",
        detail: { pageId: row.id },
      });
      return { pageId: row.id };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "notion.row.create",
        toolName: "notion_create_row",
        resourceType: "notion_database",
        resourceId: args.databaseId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

// ---------- notion_update_row ----------
const updateRowArgsSchema = z.object({
  pageId: z.string().min(1),
  properties: z.record(z.string(), z.unknown()),
});

export const notionUpdateRow: ToolExecutor<
  z.infer<typeof updateRowArgsSchema>,
  { pageId: string }
> = {
  schema: {
    name: "notion_update_row",
    description: "Update properties on an existing database row (page).",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        pageId: { type: "string" },
        properties: { type: "object" },
      },
      required: ["pageId", "properties"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = updateRowArgsSchema.parse(rawArgs);
    const { client } = await getClient(ctx.userId);
    try {
      await client.pages.update({
        page_id: args.pageId,
        properties: args.properties as Parameters<typeof client.pages.update>[0]["properties"],
      });
      await logAudit({
        userId: ctx.userId,
        action: "notion.row.update",
        toolName: "notion_update_row",
        resourceType: "notion_page",
        resourceId: args.pageId,
        result: "success",
      });
      return { pageId: args.pageId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "notion.row.update",
        toolName: "notion_update_row",
        resourceType: "notion_page",
        resourceId: args.pageId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

export const NOTION_TOOLS = [
  notionSearchPages,
  notionGetPage,
  notionCreatePage,
  notionUpdatePage,
  notionDeletePage,
  notionQueryDatabase,
  notionCreateRow,
  notionUpdateRow,
];
