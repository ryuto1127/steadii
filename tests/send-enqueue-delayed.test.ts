import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the post-α #6 publish path. Verifies the QStash publish
// uses `delay = users.undo_window_seconds`, the messageId returned by
// QStash is persisted on agent_drafts, and the default fallback (10s)
// applies only when the user row is missing the column.

const publishJSONMock = vi.fn();
vi.mock("@/lib/integrations/qstash/client", () => ({
  qstash: () => ({ publishJSON: publishJSONMock }),
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ APP_URL: "https://app.test" }),
}));

const createGmailDraftMock = vi.fn();
vi.mock("@/lib/agent/tools/gmail", () => ({
  createGmailDraft: (...args: unknown[]) => createGmailDraftMock(...args),
}));

const logAuditMock = vi.fn();
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: (...args: unknown[]) => logAuditMock(...args),
}));

type FakeDraft = {
  id: string;
  userId: string;
  status: "pending" | "edited" | "sent_pending";
  action: "draft_reply" | "summarize" | "categorize_only";
  draftSubject: string | null;
  draftBody: string | null;
  draftTo: string[];
  draftCc: string[];
  draftInReplyTo: string | null;
};

type FakeInbox = { id: string; threadExternalId: string | null };

type FakeUser = { undoWindowSeconds: number | null };

const fixture = {
  draftAndInbox: null as { draft: FakeDraft; inbox: FakeInbox } | null,
  user: null as FakeUser | null,
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
        where: () => ({
          limit: async () => {
            return fixture.user ? [fixture.user] : [];
          },
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
  agentDrafts: { id: {}, inboxItemId: {} },
  inboxItems: { id: {} },
  users: { id: {}, undoWindowSeconds: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  publishJSONMock.mockReset();
  publishJSONMock.mockResolvedValue({ messageId: "qstash-msg-1" });
  createGmailDraftMock.mockReset();
  createGmailDraftMock.mockResolvedValue({ gmailDraftId: "gd-1" });
  logAuditMock.mockReset();
  fixture.draftAndInbox = null;
  fixture.user = null;
  updateCalls.length = 0;
});

function ready(overrides: Partial<FakeDraft> = {}): FakeDraft {
  return {
    id: "draft-1",
    userId: "user-1",
    status: "pending",
    action: "draft_reply",
    draftSubject: "Re: Office Hours",
    draftBody: "Thanks — see you Thursday.",
    draftTo: ["prof@uni.edu"],
    draftCc: [],
    draftInReplyTo: null,
    ...overrides,
  };
}

async function callEnqueue(args?: { isAutomatic?: boolean }) {
  const { enqueueSendForDraft } = await import(
    "@/lib/agent/email/send-enqueue"
  );
  return enqueueSendForDraft({
    userId: "user-1",
    draftId: "draft-1",
    isAutomatic: args?.isAutomatic ?? false,
  });
}

describe("enqueueSendForDraft — delayed publish", () => {
  it("publishes with delay = users.undo_window_seconds (custom 30s)", async () => {
    fixture.draftAndInbox = {
      draft: ready(),
      inbox: { id: "ix-1", threadExternalId: "thr-1" },
    };
    fixture.user = { undoWindowSeconds: 30 };

    const result = await callEnqueue();

    expect(publishJSONMock).toHaveBeenCalledTimes(1);
    expect(publishJSONMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://app.test/api/send/execute/draft-1",
        delay: 30,
        retries: 3,
      })
    );
    expect(result.undoWindowSeconds).toBe(30);
  });

  it("falls back to 10s when the user row has no undo_window_seconds", async () => {
    fixture.draftAndInbox = {
      draft: ready(),
      inbox: { id: "ix-1", threadExternalId: null },
    };
    fixture.user = { undoWindowSeconds: null };

    const result = await callEnqueue();

    expect(publishJSONMock).toHaveBeenCalledWith(
      expect.objectContaining({ delay: 10 })
    );
    expect(result.undoWindowSeconds).toBe(10);
  });

  it("persists the qstashMessageId + gmailDraftId + sent_pending atomically", async () => {
    fixture.draftAndInbox = {
      draft: ready(),
      inbox: { id: "ix-1", threadExternalId: null },
    };
    fixture.user = { undoWindowSeconds: 10 };
    publishJSONMock.mockResolvedValue({ messageId: "qstash-abcdef" });
    createGmailDraftMock.mockResolvedValue({ gmailDraftId: "gd-99" });

    await callEnqueue({ isAutomatic: true });

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      status: "sent_pending",
      autoSent: true,
      qstashMessageId: "qstash-abcdef",
      gmailDraftId: "gd-99",
    });
    expect(updateCalls[0].approvedAt).toBeInstanceOf(Date);
  });

  it("throws when the draft action is not draft_reply (defensive — no QStash call)", async () => {
    fixture.draftAndInbox = {
      draft: ready({ action: "summarize" }),
      inbox: { id: "ix-1", threadExternalId: null },
    };
    fixture.user = { undoWindowSeconds: 10 };

    await expect(callEnqueue()).rejects.toThrow(/draft_reply/);
    expect(publishJSONMock).not.toHaveBeenCalled();
    expect(createGmailDraftMock).not.toHaveBeenCalled();
  });
});
