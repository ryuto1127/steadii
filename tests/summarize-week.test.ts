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
  mistakeRows: Array<{ title: string; classId: string | null }>;
  syllabusRows: Array<{ id: string }>;
  openAIResponse: string;
  openAIThrows: boolean;
} = {
  chatRows: [],
  mistakeRows: [],
  syllabusRows: [],
  openAIResponse: "自由落下で3回詰まりました",
  openAIThrows: false,
};

// Drizzle chainable that branches on which table .from() targets. The
// summarize-week tool runs three select-from-X queries: a chat-count
// (count() shape), a mistake_notes scan, and a syllabi scan. Track the
// last `.from()` target so each branch resolves with the right shape.
vi.mock("@/lib/db/client", async () => {
  const { mistakeNotes, syllabi } = await import("@/lib/db/schema");
  const chainable = (shape?: Record<string, unknown>) => {
    let target: object | null = null;
    const isCountQuery =
      shape !== undefined && Object.prototype.hasOwnProperty.call(shape, "count");
    const make = () => ({
      from(t: object) {
        target = t;
        return chain;
      },
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      groupBy: () => chain,
      limit: () => chain,
      then(...a: Parameters<Promise<unknown>["then"]>) {
        const value = isCountQuery
          ? [{ count: state.chatRows.length }]
          : target === mistakeNotes
            ? state.mistakeRows
            : target === syllabi
              ? state.syllabusRows
              : state.chatRows;
        return Promise.resolve(value).then(...a);
      },
      catch(...a: Parameters<Promise<unknown>["catch"]>) {
        return Promise.resolve([]).catch(...a);
      },
      finally(...a: Parameters<Promise<unknown>["finally"]>) {
        return Promise.resolve([]).finally(...a);
      },
    });
    const chain: ReturnType<typeof make> = make();
    return chain;
  };
  return {
    db: {
      select: (shape?: Record<string, unknown>) => chainable(shape),
      insert: () => ({ values: async () => {} }),
    },
  };
});

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

describe("summarize_week tool", () => {
  beforeEach(() => {
    clearSummarizeWeekCache();
    state.chatRows = [];
    state.mistakeRows = [];
    state.syllabusRows = [];
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
    state.mistakeRows = [
      { title: "自由落下", classId: "class-a" },
      { title: "運動方程式", classId: "class-a" },
      { title: "積分", classId: "class-b" },
      { title: "SQL join", classId: "class-c" },
    ];
    state.syllabusRows = [{ id: "syl-1" }];

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
    state.mistakeRows = [
      { title: "a", classId: null },
      { title: "b", classId: null },
    ];
    const first = await computeWeekSummary("u1");

    state.chatRows = [];
    state.mistakeRows = [];
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
    expect(delta).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(delta).toBeLessThan(8 * 24 * 60 * 60 * 1000);
  });

  it("zero academic rows is fine — chat-only week", async () => {
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
    state.mistakeRows = [{ title: "fall", classId: null }];
    state.openAIThrows = true;
    const r = await computeWeekSummary("u1");
    expect(r.pattern).toBe("");
    expect(r.empty).toBe(false);
  });
});
