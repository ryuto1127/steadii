import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-38 — edit-delta capture verifies recordSenderFeedback persists
// (originalDraftBody, editedBody) when the user's final body diverges
// from the LLM's first draft, and writes both as null when they match
// (or when the caller doesn't pass them at all). This is the data layer
// the daily style-learner reads from.

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const agentSenderFeedbackSchema = {
  id: tag("agentSenderFeedback.id"),
  userId: tag("agentSenderFeedback.userId"),
  originalDraftBody: tag("agentSenderFeedback.originalDraftBody"),
  editedBody: tag("agentSenderFeedback.editedBody"),
  senderEmail: tag("agentSenderFeedback.senderEmail"),
  senderDomain: tag("agentSenderFeedback.senderDomain"),
  proposedAction: tag("agentSenderFeedback.proposedAction"),
  userResponse: tag("agentSenderFeedback.userResponse"),
  inboxItemId: tag("agentSenderFeedback.inboxItemId"),
  agentDraftId: tag("agentSenderFeedback.agentDraftId"),
  createdAt: tag("agentSenderFeedback.createdAt"),
};

vi.mock("@/lib/db/schema", () => ({
  agentSenderFeedback: agentSenderFeedbackSchema,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  gte: (col: unknown, val: unknown) => ({ kind: "gte", col, val }),
  or: (...args: unknown[]) => ({ kind: "or", args }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      Array.from(strings).join(""),
    { raw: () => ({}) }
  ),
}));

const insertCalls: Array<{ values: unknown }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: (values: unknown) => {
        insertCalls.push({ values });
        return Promise.resolve();
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: async () => [],
      }),
    }),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

beforeEach(() => {
  insertCalls.length = 0;
});

describe("recordSenderFeedback — edit-delta capture", () => {
  it("persists (originalDraftBody, editedBody) when the bodies differ", async () => {
    const { recordSenderFeedback } = await import("@/lib/agent/email/feedback");
    await recordSenderFeedback({
      userId: "u1",
      senderEmail: "prof@x.edu",
      senderDomain: "x.edu",
      proposedAction: "draft_reply",
      userResponse: "sent",
      inboxItemId: "ix-1",
      agentDraftId: "d-1",
      originalDraftBody: "ご確認お願いします。",
      editedBody: "確認お願いします。",
    });

    expect(insertCalls).toHaveLength(1);
    const v = insertCalls[0]?.values as {
      originalDraftBody: string | null;
      editedBody: string | null;
    };
    expect(v.originalDraftBody).toBe("ご確認お願いします。");
    expect(v.editedBody).toBe("確認お願いします。");
  });

  it("writes both null when the bodies match (no real edit)", async () => {
    const { recordSenderFeedback } = await import("@/lib/agent/email/feedback");
    await recordSenderFeedback({
      userId: "u1",
      senderEmail: "prof@x.edu",
      senderDomain: "x.edu",
      proposedAction: "draft_reply",
      userResponse: "sent",
      inboxItemId: "ix-1",
      agentDraftId: "d-1",
      originalDraftBody: "Same body.",
      editedBody: "Same body.",
    });

    expect(insertCalls).toHaveLength(1);
    const v = insertCalls[0]?.values as {
      originalDraftBody: string | null;
      editedBody: string | null;
    };
    expect(v.originalDraftBody).toBeNull();
    expect(v.editedBody).toBeNull();
  });

  it("writes both null when the caller passes neither (legacy callsites)", async () => {
    const { recordSenderFeedback } = await import("@/lib/agent/email/feedback");
    await recordSenderFeedback({
      userId: "u1",
      senderEmail: "prof@x.edu",
      senderDomain: "x.edu",
      proposedAction: "draft_reply",
      userResponse: "dismissed",
      inboxItemId: "ix-1",
      agentDraftId: "d-1",
    });

    expect(insertCalls).toHaveLength(1);
    const v = insertCalls[0]?.values as {
      originalDraftBody: string | null;
      editedBody: string | null;
    };
    expect(v.originalDraftBody).toBeNull();
    expect(v.editedBody).toBeNull();
  });

  it("treats whitespace-only diff as no real edit", async () => {
    const { recordSenderFeedback } = await import("@/lib/agent/email/feedback");
    await recordSenderFeedback({
      userId: "u1",
      senderEmail: "prof@x.edu",
      senderDomain: "x.edu",
      proposedAction: "draft_reply",
      userResponse: "sent",
      inboxItemId: "ix-1",
      agentDraftId: "d-1",
      originalDraftBody: "  Body.  ",
      editedBody: "Body.",
    });
    expect(insertCalls).toHaveLength(1);
    const v = insertCalls[0]?.values as {
      originalDraftBody: string | null;
      editedBody: string | null;
    };
    expect(v.originalDraftBody).toBeNull();
    expect(v.editedBody).toBeNull();
  });
});
