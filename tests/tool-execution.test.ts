import { describe, expect, it, vi, beforeEach } from "vitest";

const hoist = vi.hoisted(() => {
  const auditRows: Array<Record<string, unknown>> = [];
  const notionCalls: Array<{ method: string; args: unknown }> = [];

  const dbMock = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => [] }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: async (v: Record<string, unknown>) => {
        auditRows.push(v);
      },
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };

  const notionClient = {
    pages: {
      create: vi.fn(async (args: unknown) => {
        notionCalls.push({ method: "pages.create", args });
        return { id: "new-page-id", url: "https://notion.so/new-page-id" };
      }),
      update: vi.fn(async (args: unknown) => {
        notionCalls.push({ method: "pages.update", args });
        return { id: "page-id" };
      }),
      retrieve: vi.fn(async () => ({ id: "x" })),
    },
    blocks: {
      children: {
        list: vi.fn(async () => ({ results: [] })),
        append: vi.fn(async (args: unknown) => {
          notionCalls.push({ method: "blocks.children.append", args });
          return {};
        }),
      },
    },
    search: vi.fn(async () => ({ results: [] })),
    databases: {
      query: vi.fn(async () => ({ results: [], has_more: false })),
    },
  };

  return { auditRows, notionCalls, dbMock, notionClient };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.dbMock }));
vi.mock("@/lib/db/schema", () => ({
  auditLog: { __name: "audit" },
}));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
}));
vi.mock("@/lib/integrations/notion/client", () => ({
  getNotionClientForUser: async () => ({
    client: hoist.notionClient,
    connection: { id: "conn-1" },
  }),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    AUTH_GOOGLE_ID: "id",
    AUTH_GOOGLE_SECRET: "sec",
  }),
}));
vi.mock("@/lib/integrations/google/calendar", () => ({
  getCalendarForUser: async () => ({}),
}));

import {
  notionCreatePage,
  notionDeletePage,
  notionUpdatePage,
  NotionNotConnectedError,
} from "@/lib/agent/tools/notion";

beforeEach(() => {
  hoist.auditRows.length = 0;
  hoist.notionCalls.length = 0;
});

describe("notion_create_page execution", () => {
  it("creates a page under the given parent and writes a success audit row", async () => {
    const result = await notionCreatePage.execute(
      { userId: "u1" },
      { parentPageId: "parent-id", title: "Physics Week 5", content: "Hello" }
    );
    expect(result.pageId).toBe("new-page-id");

    const createCall = hoist.notionCalls.find((c) => c.method === "pages.create");
    expect(createCall).toBeDefined();
    const args = createCall!.args as {
      parent: { type: string; page_id: string };
      // v5 wraps the title rich-text array inside a `{ title: [...] }` object.
      properties: { title: { title: Array<{ text: { content: string } }> } };
      children?: unknown[];
    };
    expect(args.parent.type).toBe("page_id");
    expect(args.parent.page_id).toBe("parent-id");
    expect(args.properties.title.title[0].text.content).toBe("Physics Week 5");
    expect(args.children).toHaveLength(1);

    expect(hoist.auditRows).toHaveLength(1);
    expect(hoist.auditRows[0].action).toBe("notion.page.create");
    expect(hoist.auditRows[0].result).toBe("success");
  });

  it("writes a failure audit row when Notion throws", async () => {
    hoist.notionClient.pages.create.mockRejectedValueOnce(new Error("boom"));
    await expect(
      notionCreatePage.execute(
        { userId: "u1" },
        { parentPageId: "parent-id", title: "x" }
      )
    ).rejects.toThrow("boom");
    expect(hoist.auditRows[0].result).toBe("failure");
  });
});

describe("notion_delete_page execution", () => {
  it("archives the page and logs destructive action", async () => {
    await notionDeletePage.execute({ userId: "u1" }, { pageId: "page-1" });
    const update = hoist.notionCalls.find((c) => c.method === "pages.update");
    expect(update).toBeDefined();
    expect((update!.args as { archived: boolean }).archived).toBe(true);
    expect(hoist.auditRows[0].action).toBe("notion.page.delete");
    expect(hoist.auditRows[0].result).toBe("success");
  });
});

describe("notion_update_page execution", () => {
  it("appends a paragraph when appendParagraph is provided", async () => {
    await notionUpdatePage.execute(
      { userId: "u1" },
      { pageId: "p1", appendParagraph: "more" }
    );
    const append = hoist.notionCalls.find(
      (c) => c.method === "blocks.children.append"
    );
    expect(append).toBeDefined();
    const text = (
      append!.args as {
        children: Array<{
          paragraph: { rich_text: Array<{ text: { content: string } }> };
        }>;
      }
    ).children[0].paragraph.rich_text[0].text.content;
    expect(text).toBe("more");
  });
});

describe("NotionNotConnectedError", () => {
  it("is a typed error with a stable code", () => {
    const e = new NotionNotConnectedError();
    expect(e.code).toBe("NOTION_NOT_CONNECTED");
  });
});
