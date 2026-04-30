import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for the /api/voice/agent route. Auth + rate-limit + plan + DB +
// orchestrator are the boundaries we don't want to cross in unit tests —
// the route's own logic (operation vs chat shape, summary formatting,
// soft-delete behavior) is what we're verifying.

let currentSession: { user: { id: string } } | null = { user: { id: "u1" } };
vi.mock("@/lib/auth/config", () => ({
  auth: async () => currentSession,
}));

vi.mock("@/lib/utils/rate-limit", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/utils/rate-limit")
  >("@/lib/utils/rate-limit");
  return {
    ...actual,
    enforceRateLimit: () => {},
    enforceChatLimits: () => {},
  };
});

vi.mock("@/lib/billing/effective-plan", () => ({
  getEffectivePlan: async () => ({ plan: "free" }),
}));

vi.mock("@/lib/db/schema", () => ({ chats: {}, messages: {} }));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

const dbCalls = {
  inserts: [] as Array<{ table: unknown; values: unknown }>,
  updates: [] as Array<{ table: unknown; set: unknown; where: unknown }>,
};
const fakeChatId = "chat-1";

vi.mock("@/lib/db/client", () => ({
  db: {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        dbCalls.inserts.push({ table, values });
        const builder = {
          returning: () => Promise.resolve([{ id: fakeChatId }]),
          then: (
            resolve: (v: unknown) => unknown,
            reject: (e: unknown) => unknown
          ) => Promise.resolve(undefined).then(resolve, reject),
        };
        return builder;
      },
    }),
    update: (table: unknown) => ({
      set: (set: unknown) => ({
        where: (where: unknown) => {
          dbCalls.updates.push({ table, set, where });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

type OrchEvent =
  | { type: "tool_call_started"; toolCallId: string; args: unknown }
  | {
      type: "tool_call_result";
      toolName: string;
      toolCallId: string;
      ok: boolean;
      result: unknown;
    }
  | { type: "tool_call_pending" }
  | { type: "message_end"; text: string };

let orchestratorEvents: OrchEvent[] = [];
let orchestratorThrows: Error | null = null;
let titleGenCalls = 0;

vi.mock("@/lib/agent/orchestrator", () => ({
  streamChatResponse: async function* () {
    if (orchestratorThrows) throw orchestratorThrows;
    for (const ev of orchestratorEvents) yield ev;
  },
  generateChatTitle: async () => {
    titleGenCalls += 1;
  },
}));

beforeEach(() => {
  currentSession = { user: { id: "u1" } };
  dbCalls.inserts.length = 0;
  dbCalls.updates.length = 0;
  orchestratorEvents = [];
  orchestratorThrows = null;
  titleGenCalls = 0;
});

afterEach(() => {
  vi.resetModules();
});

async function postAgent(content: unknown): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const { POST } = await import("@/app/api/voice/agent/route");
  const req = new Request("http://localhost/api/voice/agent", {
    method: "POST",
    body: JSON.stringify(content === undefined ? {} : { content }),
    headers: { "content-type": "application/json" },
  });
  const res = await POST(req as unknown as Parameters<typeof POST>[0]);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("/api/voice/agent — Phase 3 routing", () => {
  describe("auth + body validation", () => {
    it("returns 401 when no session", async () => {
      currentSession = null;
      const { status, body } = await postAgent("hi");
      expect(status).toBe(401);
      expect(body.error).toBe("unauthenticated");
    });

    it("returns 400 when content is missing", async () => {
      const { status } = await postAgent(undefined);
      expect(status).toBe(400);
    });

    it("returns 400 when content is an empty string", async () => {
      const { status } = await postAgent("");
      expect(status).toBe(400);
    });
  });

  describe("operation mode (tools ran cleanly)", () => {
    it("returns kind:operation when a tool runs with no pending confirmation", async () => {
      orchestratorEvents = [
        { type: "tool_call_started", toolCallId: "c1", args: { name: "MAT223" } },
        {
          type: "tool_call_result",
          toolName: "classes_add",
          toolCallId: "c1",
          ok: true,
          result: { id: "x" },
        },
        { type: "message_end", text: "Done" },
      ];
      const { status, body } = await postAgent("add MAT223");
      expect(status).toBe(200);
      expect(body.kind).toBe("operation");
      expect(body.executed).toEqual([{ tool: "classes_add", ok: true }]);
      expect(body.summary).toBe("Done");
    });

    it("soft-deletes the chat row in operation mode", async () => {
      orchestratorEvents = [
        { type: "tool_call_started", toolCallId: "c1", args: {} },
        {
          type: "tool_call_result",
          toolName: "classes_add",
          toolCallId: "c1",
          ok: true,
          result: {},
        },
        { type: "message_end", text: "" },
      ];
      await postAgent("add a class");
      expect(dbCalls.updates).toHaveLength(1);
      expect(
        (dbCalls.updates[0].set as Record<string, unknown>).deletedAt
      ).toBeInstanceOf(Date);
    });

    it("uses the agent's text reply as summary when short", async () => {
      orchestratorEvents = [
        { type: "tool_call_started", toolCallId: "c1", args: {} },
        {
          type: "tool_call_result",
          toolName: "tasks_add",
          toolCallId: "c1",
          ok: true,
          result: {},
        },
        { type: "message_end", text: "Added task: review chapter 3" },
      ];
      const { body } = await postAgent("add a task");
      expect(body.summary).toBe("Added task: review chapter 3");
    });

    it("falls back to a humanised single-tool label when text is empty", async () => {
      orchestratorEvents = [
        { type: "tool_call_started", toolCallId: "c1", args: {} },
        {
          type: "tool_call_result",
          toolName: "tasks_add",
          toolCallId: "c1",
          ok: true,
          result: {},
        },
        { type: "message_end", text: "" },
      ];
      const { body } = await postAgent("add a task");
      expect(body.summary).toBe("Task added — done");
    });

    it("falls back to N-actions summary when multiple tools ran with empty text", async () => {
      orchestratorEvents = [
        { type: "tool_call_started", toolCallId: "c1", args: {} },
        {
          type: "tool_call_result",
          toolName: "classes_add",
          toolCallId: "c1",
          ok: true,
          result: {},
        },
        { type: "tool_call_started", toolCallId: "c2", args: {} },
        {
          type: "tool_call_result",
          toolName: "classes_add",
          toolCallId: "c2",
          ok: true,
          result: {},
        },
        { type: "message_end", text: "" },
      ];
      const { body } = await postAgent("add 2 classes");
      expect(body.summary).toBe("2 actions completed");
    });

    it("truncates long agent-text summaries to 200 chars with ellipsis", async () => {
      const longText = "x".repeat(220);
      orchestratorEvents = [
        { type: "tool_call_started", toolCallId: "c1", args: {} },
        {
          type: "tool_call_result",
          toolName: "tasks_add",
          toolCallId: "c1",
          ok: true,
          result: {},
        },
        { type: "message_end", text: longText },
      ];
      const { body } = await postAgent("foo");
      const summary = body.summary as string;
      expect(summary.length).toBe(198);
      expect(summary.endsWith("…")).toBe(true);
    });

    it("does NOT generate a chat title in operation mode (chat is soft-deleted)", async () => {
      orchestratorEvents = [
        { type: "tool_call_started", toolCallId: "c1", args: {} },
        {
          type: "tool_call_result",
          toolName: "classes_add",
          toolCallId: "c1",
          ok: true,
          result: {},
        },
        { type: "message_end", text: "Done" },
      ];
      await postAgent("add a class");
      expect(titleGenCalls).toBe(0);
    });
  });

  describe("chat mode (text-only OR confirmation needed)", () => {
    it("returns kind:chat when only a text response is emitted", async () => {
      orchestratorEvents = [
        {
          type: "message_end",
          text: "Linear algebra deals with vectors and matrices.",
        },
      ];
      const { status, body } = await postAgent("explain linear algebra");
      expect(status).toBe(200);
      expect(body.kind).toBe("chat");
      expect(body.chatId).toBe(fakeChatId);
      expect(body.userMessage).toBe("explain linear algebra");
      expect(body.assistantMessage).toBe(
        "Linear algebra deals with vectors and matrices."
      );
      expect(body.needsConfirmation).toBe(false);
    });

    it("returns kind:chat with needsConfirmation when a tool is pending", async () => {
      orchestratorEvents = [
        { type: "tool_call_pending" },
        {
          type: "message_end",
          text: "About to send the email — confirm?",
        },
      ];
      const { body } = await postAgent("send an email to Prof Smith");
      expect(body.kind).toBe("chat");
      expect(body.needsConfirmation).toBe(true);
    });

    it("does NOT soft-delete the chat in chat mode", async () => {
      orchestratorEvents = [{ type: "message_end", text: "hello" }];
      await postAgent("hi");
      expect(dbCalls.updates).toHaveLength(0);
    });

    it("attempts title generation when assistantText is non-empty", async () => {
      orchestratorEvents = [{ type: "message_end", text: "an answer" }];
      await postAgent("a question");
      expect(titleGenCalls).toBe(1);
    });

    it("skips title generation when assistantText is empty", async () => {
      orchestratorEvents = [{ type: "message_end", text: "" }];
      await postAgent("a question");
      expect(titleGenCalls).toBe(0);
    });
  });

  describe("DB writes", () => {
    it("persists the user message into the messages table", async () => {
      orchestratorEvents = [{ type: "message_end", text: "hi back" }];
      await postAgent("hello there");
      const messageInserts = dbCalls.inserts.filter((c) => {
        const v = c.values as Record<string, unknown>;
        return v.role === "user";
      });
      expect(messageInserts).toHaveLength(1);
      expect(
        (messageInserts[0].values as Record<string, unknown>).content
      ).toBe("hello there");
      expect(
        (messageInserts[0].values as Record<string, unknown>).chatId
      ).toBe(fakeChatId);
    });

    it("creates exactly one chat row", async () => {
      orchestratorEvents = [{ type: "message_end", text: "ok" }];
      await postAgent("hi");
      const chatInserts = dbCalls.inserts.filter((c) => {
        const v = c.values as Record<string, unknown>;
        return "userId" in v && !("role" in v);
      });
      expect(chatInserts).toHaveLength(1);
      expect((chatInserts[0].values as Record<string, unknown>).userId).toBe(
        "u1"
      );
    });
  });

  describe("error paths", () => {
    it("returns 502 when the orchestrator throws", async () => {
      orchestratorThrows = new Error("orchestrator boom");
      const { status, body } = await postAgent("hi");
      expect(status).toBe(502);
      expect(body.error).toBe("agent failed");
      expect(body.message).toBe("orchestrator boom");
    });
  });
});
