import { describe, expect, it, beforeEach, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    AUTH_GOOGLE_ID: "id",
    AUTH_GOOGLE_SECRET: "sec",
    OPENAI_API_KEY: "sk-test",
  }),
}));

type MockToolCall = { id: string; type: "function"; function: { name: string; arguments?: string } };
type MockMessage = {
  chatId: string;
  role: "user" | "assistant" | "system" | "tool";
  toolCalls: MockToolCall[] | null;
  createdAt: Date;
};
type MockChat = {
  id: string;
  userId: string;
  deletedAt: Date | null;
};

const state: {
  chats: MockChat[];
  messages: MockMessage[];
  academicNames: ReadonlyArray<string>;
} = {
  chats: [],
  messages: [],
  academicNames: [],
};

// The mock simulates the SQL filter in countChatsThisWeek: count distinct
// chats where at least one joined message has a tool_call whose
// function.name is in the academic allowlist. The allowlist is sourced
// from the module under test (state.academicNames is set in beforeEach
// via the real export) so the test stays in sync with implementation.
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
        let value: unknown;
        if (isCountQuery) {
          const matchingChatIds = new Set<string>();
          for (const chat of state.chats) {
            if (chat.deletedAt) continue;
            const hasAcademicCall = state.messages.some((m) => {
              if (m.chatId !== chat.id) return false;
              if (!m.toolCalls) return false;
              return m.toolCalls.some(
                (tc) => tc.function && state.academicNames.includes(tc.function.name)
              );
            });
            if (hasAcademicCall) matchingChatIds.add(chat.id);
          }
          value = [{ count: matchingChatIds.size }];
        } else if (target === mistakeNotes) {
          value = [];
        } else if (target === syllabi) {
          value = [];
        } else {
          value = [];
        }
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
      create: async () => ({ output_text: "" }),
    },
  }),
}));

import {
  ACADEMIC_TOOL_NAMES,
  clearSummarizeWeekCache,
  computeWeekSummary,
} from "@/lib/agent/tools/summarize-week";

describe("countChatsThisWeek — academic allowlist", () => {
  beforeEach(() => {
    clearSummarizeWeekCache();
    state.chats = [];
    state.messages = [];
    state.academicNames = ACADEMIC_TOOL_NAMES;
  });

  it("ACADEMIC_TOOL_NAMES includes academic tools and excludes utility tools", () => {
    expect(ACADEMIC_TOOL_NAMES).toContain("summarize_week");
    expect(ACADEMIC_TOOL_NAMES).toContain("read_syllabus_full_text");
    expect(ACADEMIC_TOOL_NAMES).toContain("classroom_list_courses");
    expect(ACADEMIC_TOOL_NAMES).toContain("classroom_list_coursework");
    expect(ACADEMIC_TOOL_NAMES).toContain("classroom_list_announcements");
    expect(ACADEMIC_TOOL_NAMES).toContain("notion_search_pages");
    expect(ACADEMIC_TOOL_NAMES).toContain("notion_create_page");

    for (const name of ACADEMIC_TOOL_NAMES) {
      expect(name.startsWith("gmail_")).toBe(false);
      expect(name.startsWith("calendar_")).toBe(false);
      expect(name.startsWith("tasks_")).toBe(false);
    }
  });

  it("counts only chats with academic tool calls (excludes gmail-only chat)", async () => {
    const now = new Date();
    state.chats = [
      { id: "chat-A", userId: "u1", deletedAt: null },
      { id: "chat-B", userId: "u1", deletedAt: null },
      { id: "chat-C", userId: "u1", deletedAt: null },
    ];
    state.messages = [
      {
        chatId: "chat-A",
        role: "assistant",
        toolCalls: [
          { id: "1", type: "function", function: { name: "gmail_drafts_create" } },
        ],
        createdAt: now,
      },
      {
        chatId: "chat-B",
        role: "assistant",
        toolCalls: [
          { id: "2", type: "function", function: { name: "summarize_week" } },
        ],
        createdAt: now,
      },
      {
        chatId: "chat-C",
        role: "assistant",
        toolCalls: [
          { id: "3", type: "function", function: { name: "notion_search_pages" } },
        ],
        createdAt: now,
      },
    ];

    const r = await computeWeekSummary("u1");
    expect(r.counts.chats).toBe(2);
  });

  it("a chat with no tool calls is not counted", async () => {
    state.chats = [{ id: "chat-X", userId: "u1", deletedAt: null }];
    state.messages = [
      {
        chatId: "chat-X",
        role: "assistant",
        toolCalls: null,
        createdAt: new Date(),
      },
      {
        chatId: "chat-X",
        role: "user",
        toolCalls: null,
        createdAt: new Date(),
      },
    ];

    const r = await computeWeekSummary("u1");
    expect(r.counts.chats).toBe(0);
  });

  it("a chat with mixed academic + utility tool calls is counted once", async () => {
    const now = new Date();
    state.chats = [{ id: "chat-mixed", userId: "u1", deletedAt: null }];
    state.messages = [
      {
        chatId: "chat-mixed",
        role: "assistant",
        toolCalls: [
          { id: "1", type: "function", function: { name: "gmail_drafts_create" } },
        ],
        createdAt: now,
      },
      {
        chatId: "chat-mixed",
        role: "assistant",
        toolCalls: [
          { id: "2", type: "function", function: { name: "calendar_list_events" } },
        ],
        createdAt: now,
      },
      {
        chatId: "chat-mixed",
        role: "assistant",
        toolCalls: [
          { id: "3", type: "function", function: { name: "notion_search_pages" } },
          { id: "4", type: "function", function: { name: "summarize_week" } },
        ],
        createdAt: now,
      },
    ];

    const r = await computeWeekSummary("u1");
    expect(r.counts.chats).toBe(1);
  });

  it("a chat with only role:tool reply rows (no assistant tool_calls) is not counted", async () => {
    state.chats = [{ id: "chat-orphan", userId: "u1", deletedAt: null }];
    state.messages = [
      {
        chatId: "chat-orphan",
        role: "tool",
        toolCalls: null,
        createdAt: new Date(),
      },
    ];

    const r = await computeWeekSummary("u1");
    expect(r.counts.chats).toBe(0);
  });
});
