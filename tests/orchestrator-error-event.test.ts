import { describe, expect, it, vi, beforeEach } from "vitest";

const hoist = vi.hoisted(() => {
  const state = {
    messages: [] as Array<{
      id: string;
      chatId: string;
      role: string;
      content: string;
      deletedAt: Date | null;
      createdAt: Date;
      toolCalls: unknown;
      toolCallId: string | null;
      model: string | null;
    }>,
    assistantSeq: 0,
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => state.messages,
          limit: () => state.messages,
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(v) ? v : [v];
        for (const item of arr) {
          if ((item as { role?: string }).role === "assistant") {
            state.assistantSeq += 1;
            const id = `assist-${state.assistantSeq}`;
            state.messages.push({
              id,
              chatId: (item as { chatId: string }).chatId,
              role: "assistant",
              content: (item as { content?: string }).content ?? "",
              deletedAt: null,
              createdAt: new Date(),
              toolCalls: null,
              toolCallId: null,
              model: (item as { model?: string }).model ?? null,
            });
            return { returning: () => [{ id }] };
          }
        }
        return { returning: () => [] };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          if (state.messages.length) {
            Object.assign(
              state.messages[state.messages.length - 1],
              patch as Record<string, unknown>
            );
          }
        },
      }),
    }),
  };
  return { state, db };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.db }));
vi.mock("@/lib/db/schema", () => ({
  messages: {},
  chats: {},
  messageAttachments: {},
  pendingToolCalls: {},
  notionConnections: {},
  registeredResources: {},
  accounts: {},
  users: {},
  usageEvents: {},
  auditLog: {},
  blobAssets: {},
}));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  asc: () => ({}),
  isNull: () => ({}),
  gte: () => ({}),
  sum: () => ({}),
}));

vi.mock("@/lib/billing/credits", () => ({
  assertCreditsAvailable: async () => ({
    plan: "free",
    used: 0,
    limit: 250,
    remaining: 250,
    windowStart: new Date(),
    windowEnd: new Date(),
    exceeded: false,
    nearLimit: false,
  }),
  BillingQuotaExceededError: class extends Error {
    code = "BILLING_QUOTA_EXCEEDED" as const;
    balance: unknown;
    constructor(b: unknown) {
      super("quota");
      this.balance = b;
    }
  },
}));
vi.mock("@/lib/integrations/notion/discovery", () => ({
  discoverResources: async () => ({}),
}));
vi.mock("@/lib/agent/context", () => ({
  buildUserContext: async () => ({
    notion: {
      connected: false,
      parentPageId: null,
      classesDbId: null,
      mistakesDbId: null,
      assignmentsDbId: null,
      syllabiDbId: null,
    },
    registeredResources: [],
  }),
  serializeContextForPrompt: () => "",
}));
vi.mock("@/lib/agent/preferences", () => ({
  getUserConfirmationMode: async () => "destructive_only",
}));
vi.mock("@/lib/agent/tool-registry", () => ({
  getToolByName: () => undefined,
  openAIToolDefs: () => [],
}));
vi.mock("@/lib/agent/usage", () => ({ recordUsage: async () => ({}) }));

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async () => {
          throw new Error("Model gpt-5.4-mini is not available on this account.");
        },
      },
    },
  }),
}));

import { streamChatResponse } from "@/lib/agent/orchestrator";

beforeEach(() => {
  hoist.state.messages = [
    {
      id: "u1",
      chatId: "c1",
      role: "user",
      content: "hello",
      deletedAt: null,
      createdAt: new Date(Date.now() - 1000),
      toolCalls: null,
      toolCallId: null,
      model: null,
    },
  ];
  hoist.state.assistantSeq = 0;
});

describe("orchestrator emits error events when OpenAI throws", () => {
  it("yields an OPENAI_FAILED error event the client can surface", async () => {
    const events: Array<Record<string, unknown>> = [];
    for await (const ev of streamChatResponse({
      userId: "u",
      chatId: "c1",
    })) {
      events.push(ev as unknown as Record<string, unknown>);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("error");
    const err = events.find((e) => e.type === "error")!;
    expect(err.code).toBe("OPENAI_FAILED");
    expect(String(err.message)).toMatch(/gpt-5\.4-mini/);
  });
});
