// engineer-58 — covers the messages.status state machine the orchestrator
// drives for tab-close resilience. The polling UI on the client side
// reads this column to decide whether to keep showing the in-progress
// chip; any regression of the transitions here breaks the resume flow.
//
// Three transition cases:
//   1. processing → done   (natural completion, no tool calls)
//   2. processing → error  (OPENAI_FAILED — model throws)
//   3. processing → done   (paused for confirmation — agent's turn is
//                            fully written, awaiting user input)

import { describe, expect, it, vi, beforeEach } from "vitest";

const hoist = vi.hoisted(() => {
  type Msg = {
    id: string;
    chatId: string;
    role: string;
    content: string;
    deletedAt: Date | null;
    createdAt: Date;
    toolCalls: unknown;
    toolCallId: string | null;
    model: string | null;
    status: string;
  };
  const state = {
    messages: [] as Msg[],
    assistantSeq: 0,
    // Inject the next OpenAI stream the test wants to return. The
    // helper inside each test sets this and the mock pulls one chunk
    // sequence per call.
    nextStream: null as null | (() => AsyncIterable<unknown>),
  };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => state.messages,
          limit: () => state.messages,
          then: (resolve: (val: unknown) => unknown) => resolve([]),
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
              status: (item as { status?: string }).status ?? "done",
            });
            return { returning: () => [{ id }] };
          }
          // pendingToolCalls insert path used by the pause-for-confirmation
          // case. Return a fake row so the orchestrator can yield the
          // pending event with a pendingId.
          if ("toolName" in (item as object)) {
            return { returning: () => [{ id: "pending-1" }] };
          }
        }
        return { returning: () => [] };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          // Apply the patch to the most recent assistant message —
          // sufficient for these tests where there's exactly one
          // assistant row per scenario.
          const last = [...state.messages].reverse().find(
            (m) => m.role === "assistant"
          );
          if (last) Object.assign(last, patch);
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
  agentDrafts: {},
  inboxItems: {},
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
  inArray: () => ({}),
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
    userFacts: [],
  }),
  serializeContextForPrompt: () => "",
}));
vi.mock("@/lib/agent/preferences", () => ({
  getUserConfirmationMode: async () => "destructive_only",
}));
vi.mock("@/lib/agent/user-facts", () => ({
  markUserFactsUsed: async () => undefined,
}));
vi.mock("@/lib/agent/confirmation", () => ({
  requiresConfirmation: (_mode: string, mutability: string) =>
    mutability === "write" || mutability === "destructive",
}));
vi.mock("@/lib/agent/entity-graph/resolver", () => ({
  resolveEntitiesInBackground: () => undefined,
}));
vi.mock("@/lib/agent/tool-registry", () => ({
  getToolByName: (name: string) => {
    if (name === "delete_event") {
      return {
        schema: { mutability: "destructive" },
        execute: async () => ({ ok: true }),
      };
    }
    return undefined;
  },
  openAIToolDefs: () => [],
  openAIToolDefsReadOnly: () => [],
}));
vi.mock("@/lib/agent/usage", () => ({ recordUsage: async () => ({}) }));
vi.mock("@/lib/agent/self-critique", () => ({
  detectPlaceholderLeak: () => ({ hasLeak: false, matched: [] }),
  buildPlaceholderLeakCorrection: () => "",
}));

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async () => {
          const factory = hoist.state.nextStream;
          if (!factory) throw new Error("test forgot to set nextStream");
          return factory();
        },
      },
    },
  }),
}));

import { streamChatResponse } from "@/lib/agent/orchestrator";

function plainTextStream(text: string): () => AsyncIterable<unknown> {
  return async function* () {
    yield {
      choices: [{ delta: { content: text } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  };
}

function toolCallStream(
  toolName: string,
  args: string
): () => AsyncIterable<unknown> {
  return async function* () {
    yield {
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call-1",
                function: { name: toolName, arguments: args },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  };
}

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
      status: "done",
    },
  ];
  hoist.state.assistantSeq = 0;
  hoist.state.nextStream = null;
});

describe("orchestrator messages.status state machine", () => {
  it("inserts assistant row with status='processing' and flips to 'done' on natural completion", async () => {
    hoist.state.nextStream = plainTextStream(
      "Sure — here is a long-enough reply for the orchestrator to be satisfied without invoking the forced-final-pass safety net path."
    );

    // Snapshot status the moment after the row is inserted but before
    // the orchestrator finishes — done by intercepting the first event.
    let statusAtMessageStart: string | null = null;

    for await (const ev of streamChatResponse({ userId: "u", chatId: "c1" })) {
      if (ev.type === "message_start") {
        const row = hoist.state.messages.find((m) => m.id === ev.assistantMessageId);
        statusAtMessageStart = row?.status ?? null;
      }
    }

    expect(statusAtMessageStart).toBe("processing");
    const finalRow = hoist.state.messages.find((m) => m.role === "assistant");
    expect(finalRow?.status).toBe("done");
  });

  it("flips status to 'error' when the model throws (OPENAI_FAILED path)", async () => {
    hoist.state.nextStream = () => {
      throw new Error("Model gpt-5.4-mini is not available on this account.");
    };

    for await (const ev of streamChatResponse({ userId: "u", chatId: "c1" })) {
      void ev;
    }

    const finalRow = hoist.state.messages.find((m) => m.role === "assistant");
    expect(finalRow?.status).toBe("error");
    expect(finalRow?.content).toMatch(/error/);
  });

  it("flips status to 'done' when paused for user confirmation on a destructive tool", async () => {
    hoist.state.nextStream = toolCallStream("delete_event", '{"id":"evt-1"}');

    const events: Array<Record<string, unknown>> = [];
    for await (const ev of streamChatResponse({ userId: "u", chatId: "c1" })) {
      events.push(ev as unknown as Record<string, unknown>);
    }

    // Sanity: we actually hit the pending path.
    const pending = events.find((e) => e.type === "tool_call_pending");
    expect(pending).toBeDefined();

    // The assistant message is fully written from the polling UI's
    // perspective — the agent is waiting on the user. status='done' so
    // the resume-poll doesn't keep spinning.
    const finalRow = hoist.state.messages.find((m) => m.role === "assistant");
    expect(finalRow?.status).toBe("done");
  });
});
