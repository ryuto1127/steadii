import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock env before any module under test loads it.
vi.mock("@/lib/env", () => ({
  env: () => ({
    AUTH_GOOGLE_ID: "id",
    AUTH_GOOGLE_SECRET: "sec",
    OPENAI_API_KEY: "sk-test",
  }),
}));

// Captured DB rows — mutated by individual tests.
const state: {
  chatRows: Array<{ id: string; userId: string; updatedAt: Date; deletedAt: Date | null }>;
  mistakePages: Array<Record<string, unknown>>;
  syllabusPages: Array<Record<string, unknown>>;
  notionConnected: boolean;
  openAIResponse: string;
  openAIThrows: boolean;
} = {
  chatRows: [],
  mistakePages: [],
  syllabusPages: [],
  notionConnected: true,
  openAIResponse: "自由落下で3回詰まりました",
  openAIThrows: false,
};

// Minimal drizzle chainable. Each call returns a fluent object that also
// resolves as a promise — matching `await db.select()...` patterns.
// When the select shape includes a `count` field, we resolve to an
// aggregate row instead of the raw chat rows — that matches how the
// tool-call-filtered study-session count query is shaped.
vi.mock("@/lib/db/client", () => {
  const chainable = (shape?: Record<string, unknown>) => {
    const isCountQuery =
      shape !== undefined && Object.prototype.hasOwnProperty.call(shape, "count");
    const resolved = Promise.resolve(
      isCountQuery ? [{ count: state.chatRows.length }] : state.chatRows
    );
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: resolved.then.bind(resolved),
      catch: resolved.catch.bind(resolved),
      finally: resolved.finally.bind(resolved),
    };
    return chain;
  };
  return {
    db: {
      select: (shape?: Record<string, unknown>) => chainable(shape),
      insert: () => ({ values: async () => {} }),
    },
  };
});

vi.mock("@/lib/integrations/notion/data-source", () => ({
  resolveDataSourceId: async (_c: unknown, id: string) => id,
}));

vi.mock("@/lib/integrations/notion/client", () => ({
  getNotionClientForUser: async () => {
    if (!state.notionConnected) return null;
    return {
      connection: {
        mistakesDbId: "mistakes-db",
        syllabiDbId: "syllabi-db",
      },
      client: {
        dataSources: {
          query: async ({ data_source_id }: { data_source_id: string }) => {
            if (data_source_id === "mistakes-db") {
              return { results: state.mistakePages, has_more: false };
            }
            return { results: state.syllabusPages, has_more: false };
          },
        },
      },
    };
  },
}));

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    responses: {
      create: async () => {
        if (state.openAIThrows) throw new Error("openai down");
        return { output_text: state.openAIResponse };
      },
    },
  }),
}));

import {
  clearSummarizeWeekCache,
  computeWeekSummary,
  summarizeWeekTool,
} from "@/lib/agent/tools/summarize-week";

function mistake(title: string, classId?: string) {
  return {
    properties: {
      Title: {
        type: "title",
        title: [{ plain_text: title }],
      },
      ...(classId
        ? { Class: { type: "relation", relation: [{ id: classId }] } }
        : {}),
    },
  };
}

describe("summarize_week tool", () => {
  beforeEach(() => {
    clearSummarizeWeekCache();
    state.chatRows = [];
    state.mistakePages = [];
    state.syllabusPages = [];
    state.notionConnected = true;
    state.openAIResponse = "自由落下で3回詰まりました";
    state.openAIThrows = false;
  });

  it("tool schema advertises read mutability and empty params", () => {
    expect(summarizeWeekTool.schema.name).toBe("summarize_week");
    expect(summarizeWeekTool.schema.mutability).toBe("read");
    expect(summarizeWeekTool.schema.parameters).toMatchObject({
      type: "object",
      properties: {},
    });
  });

  it("returns empty=true when under 3 total activity items", async () => {
    state.chatRows = [
      { id: "c1", userId: "u1", updatedAt: new Date(), deletedAt: null },
    ];
    const r = await computeWeekSummary("u1");
    expect(r.empty).toBe(true);
    expect(r.counts.chats).toBe(1);
    expect(r.counts.mistakes).toBe(0);
    expect(r.pattern).toBe("");
  });

  it("aggregates counts and picks top-2 classes by activity", async () => {
    state.chatRows = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      userId: "u1",
      updatedAt: new Date(),
      deletedAt: null,
    }));
    state.mistakePages = [
      mistake("自由落下", "class-a"),
      mistake("運動方程式", "class-a"),
      mistake("積分", "class-b"),
      mistake("SQL join", "class-c"),
    ];
    state.syllabusPages = [mistake("CSC108 syllabus")];

    const r = await computeWeekSummary("u1");
    expect(r.counts.chats).toBe(4);
    expect(r.counts.mistakes).toBe(4);
    expect(r.counts.syllabi).toBe(1);
    expect(r.focus).toEqual(["class-a", expect.any(String)]);
    expect(r.focus.length).toBe(2);
    expect(r.empty).toBe(false);
    expect(r.pattern).toBe("自由落下で3回詰まりました");
  });

  it("caches per-user for 6 hours", async () => {
    state.chatRows = Array.from({ length: 5 }, (_, i) => ({
      id: `c${i}`,
      userId: "u1",
      updatedAt: new Date(),
      deletedAt: null,
    }));
    state.mistakePages = [mistake("a"), mistake("b")];
    const first = await computeWeekSummary("u1");

    // Mutate state — a cache hit must not re-read.
    state.chatRows = [];
    state.mistakePages = [];
    const second = await computeWeekSummary("u1");
    expect(second).toEqual(first);

    clearSummarizeWeekCache("u1");
    const third = await computeWeekSummary("u1");
    expect(third.counts.chats).toBe(0);
    expect(third.counts.mistakes).toBe(0);
  });

  it("returns a sane window covering the last 7 days", async () => {
    const r = await computeWeekSummary("u1");
    const start = new Date(r.window.start);
    const end = new Date(r.window.end);
    const delta = end.getTime() - start.getTime();
    // 7 ± 1 day tolerance for timezone rounding.
    expect(delta).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(delta).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it("gracefully degrades when Notion is not connected", async () => {
    state.notionConnected = false;
    state.chatRows = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      userId: "u1",
      updatedAt: new Date(),
      deletedAt: null,
    }));
    const r = await computeWeekSummary("u1");
    expect(r.counts.mistakes).toBe(0);
    expect(r.counts.syllabi).toBe(0);
    expect(r.counts.chats).toBe(4);
  });

  it("survives an OpenAI failure by returning empty pattern", async () => {
    state.chatRows = Array.from({ length: 4 }, (_, i) => ({
      id: `c${i}`,
      userId: "u1",
      updatedAt: new Date(),
      deletedAt: null,
    }));
    state.mistakePages = [mistake("fall")];
    state.openAIThrows = true;
    const r = await computeWeekSummary("u1");
    expect(r.pattern).toBe("");
    expect(r.empty).toBe(false);
  });
});
