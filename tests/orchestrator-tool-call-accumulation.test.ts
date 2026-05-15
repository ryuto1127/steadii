// engineer-63 — regression test for sparring PR #260's fix. Before #260
// the orchestrator overwrote `messages.tool_calls` on each iteration of
// its inner loop, so the UI rehydrate (page.tsx initial render +
// chat-view's rehydrateFromPoll) only ever saw the LAST iteration's
// tool calls. Engineer-63's draft-action reply-target resolution
// (lib/chat/draft-detect.ts → extractReplyTargetInboxItemId) depends on
// the FULL assistant-turn tool history being queryable from
// `messages.tool_calls`, so a regression here would silently break the
// Send button.
//
// The test mocks the orchestrator's inner loop with 3 tool-call iterations
// (5 distinct tool calls total) followed by a plain-text terminating
// iteration, then asserts the final messages.tool_calls JSON contains
// all 5 calls in order.

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
    // Queue of openai().chat.completions.create() return values. Each
    // call to create() consumes one. Tests must enqueue enough streams
    // for every iteration the orchestrator will run.
    streamQueue: [] as Array<() => AsyncIterable<unknown>>,
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
          // tool-response inserts — track for completeness (not asserted on
          // here, but the orchestrator writes one per executed call).
          if ((item as { role?: string }).role === "tool") {
            state.messages.push({
              id: `tool-${state.messages.length}`,
              chatId: (item as { chatId: string }).chatId,
              role: "tool",
              content: (item as { content?: string }).content ?? "",
              deletedAt: null,
              createdAt: new Date(),
              toolCalls: null,
              toolCallId: (item as { toolCallId?: string }).toolCallId ?? null,
              model: null,
              status: "done",
            });
            return { returning: () => [] };
          }
        }
        return { returning: () => [] };
      },
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
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
  // None of the 5 tools the test fires are destructive — all read-only.
  requiresConfirmation: () => false,
}));
vi.mock("@/lib/agent/entity-graph/resolver", () => ({
  resolveEntitiesInBackground: () => undefined,
}));
vi.mock("@/lib/agent/tool-registry", () => ({
  // Read-only stub for every tool the test invokes. Returns a trivial
  // success payload so the orchestrator's execute branch proceeds without
  // exception.
  getToolByName: () => ({
    schema: { mutability: "read" },
    execute: async () => ({ ok: true }),
  }),
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
          const factory = hoist.state.streamQueue.shift();
          if (!factory)
            throw new Error(
              "test ran out of queued streams — orchestrator iterated more than expected"
            );
          return factory();
        },
      },
    },
  }),
}));

import { streamChatResponse } from "@/lib/agent/orchestrator";

type ToolCallChunk = {
  index: number;
  id: string;
  name: string;
  args: string;
};

// Build an async-iterable that emits a single chunk containing one or more
// streamed tool_calls. Mirrors what OpenAI's chat-completions stream produces
// for a tool-only iteration.
function batchToolCallStream(
  calls: ToolCallChunk[]
): () => AsyncIterable<unknown> {
  return async function* () {
    yield {
      choices: [
        {
          delta: {
            tool_calls: calls.map((c) => ({
              index: c.index,
              id: c.id,
              function: { name: c.name, arguments: c.args },
            })),
          },
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };
  };
}

function plainTextStream(text: string): () => AsyncIterable<unknown> {
  return async function* () {
    yield {
      choices: [{ delta: { content: text } }],
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
      content: "look up the latest email and convert times",
      deletedAt: null,
      createdAt: new Date(Date.now() - 1000),
      toolCalls: null,
      toolCallId: null,
      model: null,
      status: "done",
    },
  ];
  hoist.state.assistantSeq = 0;
  hoist.state.streamQueue = [];
});

describe("orchestrator tool_calls cross-iteration accumulation", () => {
  it("persists ALL tool_calls across 3+ iterations in messages.tool_calls (PR #260 regression gate)", async () => {
    // Iteration 1: single tool — lookup_entity
    hoist.state.streamQueue.push(
      batchToolCallStream([
        { index: 0, id: "call-1", name: "lookup_entity", args: '{"q":"X"}' },
      ])
    );
    // Iteration 2: batch of two — email_search + email_get_body
    hoist.state.streamQueue.push(
      batchToolCallStream([
        { index: 0, id: "call-2", name: "email_search", args: '{"q":"foo"}' },
        {
          index: 1,
          id: "call-3",
          name: "email_get_body",
          args: '{"inboxItemId":"abc"}',
        },
      ])
    );
    // Iteration 3: batch of two — two convert_timezone calls
    hoist.state.streamQueue.push(
      batchToolCallStream([
        {
          index: 0,
          id: "call-4",
          name: "convert_timezone",
          args: '{"slot":"2026-05-20T10:00"}',
        },
        {
          index: 1,
          id: "call-5",
          name: "convert_timezone",
          args: '{"slot":"2026-05-20T11:00"}',
        },
      ])
    );
    // Iteration 4: terminating plain-text response (long enough to skip the
    // forced-final-pass safety net).
    hoist.state.streamQueue.push(
      plainTextStream(
        "Sure — here is the draft reply that respects the converted times. " +
          "It includes all the slots in the user's timezone with the sender's " +
          "local equivalents below."
      )
    );

    for await (const ev of streamChatResponse({ userId: "u", chatId: "c1" })) {
      void ev;
    }

    const assistantRow = hoist.state.messages.find(
      (m) => m.role === "assistant"
    );
    expect(assistantRow).toBeDefined();
    const persisted = assistantRow!.toolCalls;
    expect(Array.isArray(persisted)).toBe(true);
    const arr = persisted as Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;

    // The fix: every call from every iteration is in the final array, in
    // arrival order. Pre-fix this would have been just iteration 3's two
    // calls (the last batch).
    expect(arr).toHaveLength(5);
    expect(arr.map((c) => c.function.name)).toEqual([
      "lookup_entity",
      "email_search",
      "email_get_body",
      "convert_timezone",
      "convert_timezone",
    ]);
    expect(arr.map((c) => c.id)).toEqual([
      "call-1",
      "call-2",
      "call-3",
      "call-4",
      "call-5",
    ]);

    // Sanity: the email body fetch — the call engineer-63's reply-target
    // resolver keys off — is present with its inboxItemId arg intact.
    const bodyCall = arr.find(
      (c) => c.function.name === "email_get_body"
    );
    expect(bodyCall).toBeDefined();
    expect(JSON.parse(bodyCall!.function.arguments)).toEqual({
      inboxItemId: "abc",
    });
  });
});
