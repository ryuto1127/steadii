// engineer-58 — covers /api/chat/messages/[id]/status, the polling
// endpoint the chat UI calls while an assistant row is still in
// status='processing'. The shape returned here drives the rehydrate
// path; auth gating + stale-row safety net are the other two
// invariants worth pinning.

import { describe, expect, it, vi, beforeEach } from "vitest";

let currentSession: { user: { id: string } } | null = { user: { id: "u1" } };
vi.mock("@/lib/auth/config", () => ({
  auth: async () => currentSession,
}));

vi.mock("@/lib/db/schema", () => ({
  chats: {},
  messages: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  asc: () => ({}),
}));

type FakeMessageRow = {
  id: string;
  chatId: string;
  ownerUserId: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCalls: unknown;
  toolCallId: string | null;
  status: "pending" | "processing" | "done" | "error" | "cancelled";
  createdAt: Date;
};

const state = {
  rows: [] as FakeMessageRow[],
  updates: [] as Array<{ id: string; status: string }>,
  // Toggle which "table" the next select targets. The endpoint runs two
  // selects: first the message+chat join (returns 1 row max), then the
  // tool-results scan (returns N rows). We discriminate by call ordinal
  // since both go through the same mock.
  selectCallCount: 0,
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: (_proj?: unknown) => {
      const callIndex = state.selectCallCount++;
      return {
        from: () => {
          // Default chainable that resolves to an empty array when
          // awaited without further filtering.
          const chain: Record<string, unknown> = {};
          const buildChain = () => {
            chain.innerJoin = () => chain;
            chain.where = () => chain;
            chain.orderBy = () => {
              // Second select call = tool results scan, ordered by
              // createdAt asc. Return tool rows for the current chat.
              if (callIndex === 1) {
                return Promise.resolve(
                  state.rows
                    .filter((r) => r.role === "tool")
                    .map((r) => ({
                      toolCallId: r.toolCallId,
                      content: r.content,
                      createdAt: r.createdAt,
                    }))
                );
              }
              return Promise.resolve([]);
            };
            chain.limit = () => {
              // First select call = message+chat join, returns the row
              // owned by the caller (or none).
              if (callIndex === 0) {
                const target = state.rows.find(
                  (r) =>
                    r.role === "assistant" &&
                    r.ownerUserId === (currentSession?.user.id ?? "")
                );
                return Promise.resolve(target ? [target] : []);
              }
              return Promise.resolve([]);
            };
            return chain;
          };
          return buildChain();
        },
      };
    },
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          const last = state.rows.find((r) => r.role === "assistant");
          if (last) {
            state.updates.push({ id: last.id, status: String(patch.status) });
            last.status = patch.status as FakeMessageRow["status"];
          }
        },
      }),
    }),
  },
}));

import { GET } from "@/app/api/chat/messages/[id]/status/route";

function buildRequest(): Parameters<typeof GET>[0] {
  return new Request("http://localhost/api/chat/messages/m1/status") as Parameters<
    typeof GET
  >[0];
}

beforeEach(() => {
  state.rows = [];
  state.updates = [];
  state.selectCallCount = 0;
  currentSession = { user: { id: "u1" } };
});

describe("/api/chat/messages/[id]/status", () => {
  it("returns processing + content snapshot while the orchestrator is mid-loop", async () => {
    state.rows = [
      {
        id: "m1",
        chatId: "c1",
        ownerUserId: "u1",
        role: "assistant",
        content: "thinking...",
        toolCalls: [
          {
            id: "call-a",
            type: "function",
            function: { name: "email_search", arguments: "{}" },
          },
        ],
        toolCallId: null,
        status: "processing",
        createdAt: new Date(),
      },
    ];

    const res = await GET(buildRequest(), {
      params: Promise.resolve({ id: "m1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("processing");
    expect(body.content).toBe("thinking...");
    expect(body.toolCalls).toHaveLength(1);
    expect(body.toolResults).toEqual([]);
  });

  it("includes tool results for the assistant row's tool_call_ids", async () => {
    const now = new Date();
    state.rows = [
      {
        id: "m1",
        chatId: "c1",
        ownerUserId: "u1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call-a",
            type: "function",
            function: { name: "email_search", arguments: "{}" },
          },
          {
            id: "call-b",
            type: "function",
            function: { name: "email_get_body", arguments: "{}" },
          },
        ],
        toolCallId: null,
        status: "processing",
        createdAt: now,
      },
      {
        id: "t1",
        chatId: "c1",
        ownerUserId: "u1",
        role: "tool",
        content: '{"hits":[]}',
        toolCalls: null,
        toolCallId: "call-a",
        status: "done",
        createdAt: now,
      },
      {
        id: "t2",
        chatId: "c1",
        ownerUserId: "u1",
        role: "tool",
        content: '{"body":"hi"}',
        toolCalls: null,
        toolCallId: "call-orphan",
        status: "done",
        createdAt: now,
      },
    ];

    const res = await GET(buildRequest(), {
      params: Promise.resolve({ id: "m1" }),
    });
    const body = await res.json();
    // call-a should be included; call-orphan must be filtered out
    // because it's not one of this assistant row's tool_call_ids.
    expect(body.toolResults).toHaveLength(1);
    expect(body.toolResults[0].toolCallId).toBe("call-a");
  });

  it("auto-flips stale 'processing' rows to 'error' past the maxDuration window", async () => {
    const oldDate = new Date(Date.now() - 7 * 60 * 1000); // 7 minutes ago, > 6 min threshold
    state.rows = [
      {
        id: "m1",
        chatId: "c1",
        ownerUserId: "u1",
        role: "assistant",
        content: "",
        toolCalls: null,
        toolCallId: null,
        status: "processing",
        createdAt: oldDate,
      },
    ];

    const res = await GET(buildRequest(), {
      params: Promise.resolve({ id: "m1" }),
    });
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(state.updates).toContainEqual({ id: "m1", status: "error" });
  });

  it("returns 401 when unauthenticated", async () => {
    currentSession = null;
    const res = await GET(buildRequest(), {
      params: Promise.resolve({ id: "m1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the message is owned by a different user", async () => {
    state.rows = [
      {
        id: "m1",
        chatId: "c1",
        ownerUserId: "different-user",
        role: "assistant",
        content: "",
        toolCalls: null,
        toolCallId: null,
        status: "processing",
        createdAt: new Date(),
      },
    ];

    const res = await GET(buildRequest(), {
      params: Promise.resolve({ id: "m1" }),
    });
    expect(res.status).toBe(404);
  });
});
