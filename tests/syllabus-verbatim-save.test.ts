import { describe, expect, it, beforeEach, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const calls: Array<{ method: string; args: unknown }> = [];
  const dbMock = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => [
            {
              id: "conn-1",
              userId: "u",
              syllabiDbId: "db-syllabi",
              accessTokenEncrypted: "tok",
            },
          ],
        }),
      }),
    }),
    insert: () => ({ values: async () => {} }),
  };
  const notionClient = {
    pages: {
      create: vi.fn(async (args: unknown) => {
        calls.push({ method: "pages.create", args });
        return { id: "page-1", url: "https://notion.so/page-1" };
      }),
    },
  };
  return { calls, dbMock, notionClient };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.dbMock }));
vi.mock("@/lib/db/schema", () => ({
  notionConnections: {},
  registeredResources: {},
  auditLog: {},
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));
vi.mock("@/lib/utils/crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/integrations/notion/client", () => ({
  notionClientFromToken: () => hoist.notionClient,
}));

import {
  saveSyllabusToNotion,
  buildSyllabusBody,
  paragraphsFromLongText,
} from "@/lib/syllabus/save";

beforeEach(() => {
  hoist.calls.length = 0;
});

describe("saveSyllabusToNotion — universal verbatim preservation", () => {
  it("writes an Original file block + Full source content toggle for a PDF", async () => {
    await saveSyllabusToNotion({
      userId: "u",
      classNotionPageId: null,
      syllabus: {
        courseName: "Intro",
        courseCode: "CS101",
        term: "Fall",
        instructor: null,
        officeHours: null,
        grading: null,
        attendance: null,
        textbooks: null,
        schedule: [],
        sourceUrl: null,
        raw: null,
      },
      verbatim: {
        fullText: "=== Page 1 ===\nFull PDF content here",
        sourceKind: "pdf",
        blob: {
          blobAssetId: "ba-1",
          url: "https://blob.example/syllabus.pdf",
          filename: "syllabus.pdf",
          mimeType: "application/pdf",
          sizeBytes: 100,
        },
      },
    });

    const call = hoist.calls.find((c) => c.method === "pages.create")!;
    const children = (call.args as { children: Array<Record<string, unknown>> })
      .children;
    const types = children.map((c) => c.type);
    expect(types).toContain("file");
    expect(types).toContain("toggle");
    const toggle = children.find((c) => c.type === "toggle") as unknown as {
      toggle: {
        rich_text: Array<{ text: { content: string } }>;
        children: Array<{ type: string }>;
      };
    };
    expect(toggle.toggle.rich_text[0].text.content).toBe("Full source content");
    expect(toggle.toggle.children.length).toBeGreaterThan(0);
  });

  it("writes a URL bookmark + toggle (no blob) for a URL source", async () => {
    await saveSyllabusToNotion({
      userId: "u",
      classNotionPageId: null,
      syllabus: {
        courseName: "URL Syllabus",
        courseCode: null,
        term: null,
        instructor: null,
        officeHours: null,
        grading: null,
        attendance: null,
        textbooks: null,
        schedule: [],
        sourceUrl: "https://example.edu/syllabus",
        raw: null,
      },
      verbatim: {
        fullText: "Cleaned body text.",
        sourceKind: "url",
      },
    });

    const call = hoist.calls.find((c) => c.method === "pages.create")!;
    const children = (call.args as { children: Array<Record<string, unknown>> })
      .children;
    const types = children.map((c) => c.type);
    expect(types).toContain("bookmark");
    expect(types).toContain("toggle");
    expect(types).not.toContain("file");
  });
});

describe("buildSyllabusBody / paragraphsFromLongText", () => {
  it("splits long text across paragraphs within Notion's 2000-char cap", () => {
    const paragraphs = paragraphsFromLongText("x".repeat(5000));
    for (const p of paragraphs) {
      const rt = (p as { paragraph: { rich_text: Array<{ text: { content: string } }> } })
        .paragraph.rich_text;
      for (const t of rt) {
        expect(t.text.content.length).toBeLessThanOrEqual(1900);
      }
    }
  });

  it("generates a schedule bullet list when schedule entries exist", () => {
    const body = buildSyllabusBody(
      {
        courseName: "x",
        courseCode: null,
        term: null,
        instructor: null,
        officeHours: null,
        grading: null,
        attendance: null,
        textbooks: null,
        schedule: [{ date: "2026-09-01", topic: "Intro" }],
        sourceUrl: null,
        raw: null,
      },
      { fullText: "", sourceKind: "url" }
    ) as Array<Record<string, unknown>>;
    const types = body.map((b) => b.type);
    expect(types).toContain("bulleted_list_item");
  });
});
