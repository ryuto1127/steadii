import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the post-α #6 cancel path. Verifies QStash messages.delete
// is called with the persisted messageId, transient delete failures are
// swallowed (race with already-fired publish), and the agent_draft row
// flips to status='pending' with the QStash + Gmail pointers cleared.

const messagesDeleteMock = vi.fn();
vi.mock("@/lib/integrations/qstash/client", () => ({
  qstash: () => ({ messages: { delete: messagesDeleteMock } }),
}));

vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { id: "user-1" } }),
}));

const deleteGmailDraftMock = vi.fn();
vi.mock("@/lib/agent/tools/gmail", () => ({
  deleteGmailDraft: (...args: unknown[]) => deleteGmailDraftMock(...args),
}));

const logAuditMock = vi.fn();
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: (...args: unknown[]) => logAuditMock(...args),
}));

vi.mock("@/lib/agent/email/feedback", () => ({
  recordSenderFeedback: vi.fn(),
}));

vi.mock("@/lib/agent/email/send-enqueue", () => ({
  enqueueSendForDraft: vi.fn(),
}));

vi.mock("@/lib/classes/save", () => ({
  createClass: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

type FakeDraft = {
  id: string;
  userId: string;
  status: "sent_pending" | "pending" | "sent" | "cancelled";
  qstashMessageId: string | null;
  gmailDraftId: string | null;
  inboxItemId: string;
  action: "draft_reply";
};

type FakeInbox = {
  id: string;
  senderEmail: string;
  senderDomain: string;
  classId: string | null;
};

const fixture = {
  draftAndInbox: null as { draft: FakeDraft; inbox: FakeInbox } | null,
};

const updateCalls: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              return fixture.draftAndInbox ? [fixture.draftAndInbox] : [];
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updateCalls.push(values);
          return undefined;
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agentDrafts: { id: {}, userId: {}, inboxItemId: {} },
  inboxItems: { id: {} },
  agentRules: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
}));

beforeEach(() => {
  messagesDeleteMock.mockReset();
  messagesDeleteMock.mockResolvedValue(undefined);
  deleteGmailDraftMock.mockReset();
  deleteGmailDraftMock.mockResolvedValue(undefined);
  logAuditMock.mockReset();
  fixture.draftAndInbox = null;
  updateCalls.length = 0;
});

function pending(overrides: Partial<FakeDraft> = {}): FakeDraft {
  return {
    id: "draft-1",
    userId: "user-1",
    status: "sent_pending",
    qstashMessageId: "qstash-1",
    gmailDraftId: "gd-1",
    inboxItemId: "ix-1",
    action: "draft_reply",
    ...overrides,
  };
}

async function callCancel(draftId = "draft-1") {
  const { cancelPendingSendAction } = await import(
    "@/lib/agent/email/draft-actions"
  );
  return cancelPendingSendAction(draftId);
}

describe("cancelPendingSendAction — QStash cancel path", () => {
  it("calls QStash messages.delete with the persisted messageId, then deletes Gmail draft", async () => {
    fixture.draftAndInbox = {
      draft: pending({ qstashMessageId: "qstash-abc" }),
      inbox: {
        id: "ix-1",
        senderEmail: "p@u.edu",
        senderDomain: "u.edu",
        classId: null,
      },
    };

    await callCancel();

    expect(messagesDeleteMock).toHaveBeenCalledTimes(1);
    expect(messagesDeleteMock).toHaveBeenCalledWith("qstash-abc");
    expect(deleteGmailDraftMock).toHaveBeenCalledTimes(1);
    expect(deleteGmailDraftMock).toHaveBeenCalledWith("user-1", "gd-1");
  });

  it("swallows QStash already-fired errors so the user-facing flow still succeeds", async () => {
    fixture.draftAndInbox = {
      draft: pending(),
      inbox: {
        id: "ix-1",
        senderEmail: "p@u.edu",
        senderDomain: "u.edu",
        classId: null,
      },
    };
    messagesDeleteMock.mockRejectedValue(new Error("Message not found"));

    await expect(callCancel()).resolves.toBeUndefined();
    // The status flip + audit log still ran even though QStash threw.
    expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    expect(updateCalls[0]).toMatchObject({
      status: "pending",
      qstashMessageId: null,
      gmailDraftId: null,
    });
    expect(logAuditMock).toHaveBeenCalled();
  });

  it("flips status back to pending and clears qstash + gmail pointers", async () => {
    fixture.draftAndInbox = {
      draft: pending(),
      inbox: {
        id: "ix-1",
        senderEmail: "p@u.edu",
        senderDomain: "u.edu",
        classId: null,
      },
    };

    await callCancel();

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      status: "pending",
      approvedAt: null,
      qstashMessageId: null,
      gmailDraftId: null,
    });
    expect(updateCalls[0].updatedAt).toBeInstanceOf(Date);
  });
});
