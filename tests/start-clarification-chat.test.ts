import { describe, it, expect, beforeEach, vi } from "vitest";

// engineer-46 — startClarificationChatAction. Drives the server action
// through a stubbed db + auth and asserts:
//   * unsupported card kinds (group_detect, etc.) reject
//   * missing or non-ask_clarifying drafts reject
//   * happy path inserts a chats row with clarifyingDraftId AND a seeded
//     assistant message rendering the original card's question
//   * the action returns the new chatId

vi.mock("server-only", () => ({}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

vi.mock("drizzle-orm", () => ({
  eq: (a: unknown, b: unknown) => ({ op: "eq", a, b }),
  and: (...parts: unknown[]) => ({ op: "and", parts }),
}));

vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/db/schema", () => ({
  agentConfirmations: {},
  agentContactPersonas: {},
  agentDrafts: {
    id: "agent_drafts.id",
    userId: "agent_drafts.user_id",
    inboxItemId: "agent_drafts.inbox_item_id",
  },
  agentProposals: {},
  chats: { id: "chats.id" },
  eventPreBriefs: {},
  groupProjects: {},
  inboxItems: { id: "inbox_items.id" },
  messages: {},
  officeHoursRequests: {},
}));

vi.mock("@/lib/agent/email/draft-actions", () => ({
  dismissAgentDraftAction: async () => {},
  snoozeAgentDraftAction: async () => {},
}));

vi.mock("@/lib/agent/email/l2", () => ({
  processL2: async () => {},
}));

vi.mock("@/lib/agent/proactive/feedback-bias", () => ({
  recordProactiveFeedback: async () => {},
}));

vi.mock("@/lib/agent/proactive/action-executor", () => ({
  executeProactiveAction: async () => ({}),
}));

const auditCalls: unknown[] = [];
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async (args: unknown) => {
    auditCalls.push(args);
  },
}));

vi.mock("@/lib/agent/groups/detect-actions", () => ({
  resolveGroupDetectClarification: async () => {},
}));

vi.mock("@/lib/agent/office-hours/actions", () => ({
  pickOfficeHoursSlot: async () => {},
  sendOfficeHoursDraft: async () => {},
}));

vi.mock("@/lib/agent/queue/confirmation-fact-merge", () => ({
  applyUserConfirmedFact: () => ({}),
  normalizeStructuredFactKey: () => "timezone",
}));

type DraftRow = {
  id: string;
  userId: string;
  inboxItemId: string;
  action: "ask_clarifying" | "draft_reply";
  status: "pending" | "dismissed";
  reasoning: string | null;
  draftBody: string | null;
};

type InboxRow = {
  id: string;
  senderName: string | null;
  senderEmail: string;
  subject: string | null;
};

type DbState = {
  joined: { draft: DraftRow; inbox: InboxRow } | null;
  insertedChat: Record<string, unknown> | null;
  insertedMessage: Record<string, unknown> | null;
  nextChatId: string;
};

const state: DbState = {
  joined: null,
  insertedChat: null,
  insertedMessage: null,
  nextChatId: "chat-uuid-123",
};

vi.mock("@/lib/db/client", () => {
  // The action issues:  db.select(...).from(...).innerJoin(...).where(...).limit(...)
  // — every link in the chain must return the right shape.
  function fromChain(rows: unknown[]) {
    const whereChain = {
      limit: async () => rows,
    };
    return {
      innerJoin: () => ({ where: () => whereChain }),
      where: () => whereChain,
    };
  }
  const db = {
    select: () => ({
      from: () => fromChain(state.joined ? [state.joined] : []),
    }),
    insert: (table: { id?: string }) => ({
      values: (v: Record<string, unknown>) => {
        if (table.id === "chats.id") {
          state.insertedChat = v;
          return {
            returning: async () => [{ id: state.nextChatId }],
          };
        }
        // messages table
        state.insertedMessage = v;
        return { returning: async () => [{ id: "msg-uuid-1" }] };
      },
    }),
    update: () => ({
      set: () => ({ where: async () => {} }),
    }),
  };
  return { db };
});

import { startClarificationChatAction } from "@/app/app/queue-actions";

const CARD_ID_DRAFT = "draft:11111111-1111-1111-1111-111111111111";
const CARD_ID_PROPOSAL = "proposal:22222222-2222-2222-2222-222222222222";

function freshJoined(
  overrides: { draft?: Partial<DraftRow>; inbox?: Partial<InboxRow> } = {}
): { draft: DraftRow; inbox: InboxRow } {
  return {
    draft: {
      id: "11111111-1111-1111-1111-111111111111",
      userId: "user-1",
      inboxItemId: "33333333-3333-3333-3333-333333333333",
      action: "ask_clarifying",
      status: "pending",
      reasoning:
        "Two candidate interview windows; needed to know which the student prefers.",
      draftBody: null,
      ...overrides.draft,
    },
    inbox: {
      id: "33333333-3333-3333-3333-333333333333",
      senderName: "Acme Travel Recruiting",
      senderEmail: "recruiter@acme-travel.example.co.jp",
      subject: "Interview scheduling — 2 candidate days",
      ...overrides.inbox,
    },
  };
}

beforeEach(() => {
  state.joined = freshJoined();
  state.insertedChat = null;
  state.insertedMessage = null;
  state.nextChatId = "chat-uuid-123";
  auditCalls.length = 0;
});

describe("startClarificationChatAction", () => {
  it("happy path inserts a chats row with clarifyingDraftId + a seeded assistant message and returns chatId", async () => {
    const out = await startClarificationChatAction(CARD_ID_DRAFT);
    expect(out).toEqual({ chatId: "chat-uuid-123" });
    expect(state.insertedChat).toMatchObject({
      userId: "user-1",
      clarifyingDraftId: "11111111-1111-1111-1111-111111111111",
    });
    expect(typeof state.insertedChat?.title).toBe("string");
    // Assistant seed message rendered from the draft's reasoning.
    expect(state.insertedMessage).toMatchObject({
      chatId: "chat-uuid-123",
      role: "assistant",
    });
    expect(state.insertedMessage?.content).toContain("interview");
    // Audit: clarification_chat_opened sub-action.
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0]).toMatchObject({
      action: "email_l2_completed",
      result: "success",
      detail: { subAction: "clarification_chat_opened" },
    });
  });

  it("falls back to a generic seed when neither reasoning nor draftBody is set", async () => {
    state.joined = freshJoined({
      draft: { reasoning: null, draftBody: null },
    });
    await startClarificationChatAction(CARD_ID_DRAFT);
    expect(state.insertedMessage?.content).toBeTruthy();
    expect((state.insertedMessage?.content as string).length).toBeGreaterThan(
      0
    );
  });

  it("rejects non-draft card kinds", async () => {
    await expect(
      startClarificationChatAction(CARD_ID_PROPOSAL)
    ).rejects.toThrow(/not a clarifying draft/);
  });

  it("rejects when no draft is found", async () => {
    state.joined = null;
    await expect(
      startClarificationChatAction(CARD_ID_DRAFT)
    ).rejects.toThrow(/Draft not found/);
  });

  it("rejects when the draft action is not ask_clarifying", async () => {
    state.joined = freshJoined({ draft: { action: "draft_reply" } });
    await expect(
      startClarificationChatAction(CARD_ID_DRAFT)
    ).rejects.toThrow(/not a clarifying-input/);
  });

  it("rejects when the draft is no longer pending", async () => {
    state.joined = freshJoined({ draft: { status: "dismissed" } });
    await expect(
      startClarificationChatAction(CARD_ID_DRAFT)
    ).rejects.toThrow(/no longer pending/);
  });
});
