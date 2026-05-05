import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the post-α #6 per-draft execute route at
// /api/send/execute/[draftId]. Exercises the idempotency gate,
// signature verification, and the happy-path send.

const verifyMock = vi.fn();
vi.mock("@/lib/integrations/qstash/verify", () => ({
  verifyQStashSignature: (req: Request, body: string) =>
    verifyMock(req, body),
}));

type FakeDraft = {
  id: string;
  userId: string;
  status: "sent_pending" | "sent" | "cancelled" | "pending";
  gmailDraftId: string | null;
  inboxItemId: string;
  action: string;
  autoSent: boolean;
};

const fixture = {
  draftRow: null as FakeDraft | null,
  inboxRow: null as
    | { id: string; senderEmail: string; senderDomain: string }
    | null,
};
const dbCalls: string[] = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (_table: unknown) => ({
        where: () => ({
          limit: async () => {
            // The route does two selects: agent_drafts (full row) and
            // inbox_items (id + sender). We disambiguate by the order
            // and what's been logged so far.
            const callIdx = dbCalls.filter((c) => c.startsWith("select"))
              .length;
            if (callIdx === 0) {
              dbCalls.push("select.draft");
              return fixture.draftRow ? [fixture.draftRow] : [];
            }
            dbCalls.push("select.inbox");
            return fixture.inboxRow ? [fixture.inboxRow] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          dbCalls.push("update.draft");
          return undefined;
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agentDrafts: { id: {} },
  inboxItems: { id: {} },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));

const sendAndAuditMock = vi.fn();
vi.mock("@/lib/agent/tools/gmail", () => ({
  sendAndAudit: (...args: unknown[]) => sendAndAuditMock(...args),
}));

const recordSenderFeedbackMock = vi.fn();
vi.mock("@/lib/agent/email/feedback", () => ({
  recordSenderFeedback: (...args: unknown[]) =>
    recordSenderFeedbackMock(...args),
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

beforeEach(() => {
  verifyMock.mockReset();
  verifyMock.mockResolvedValue(true);
  sendAndAuditMock.mockReset();
  recordSenderFeedbackMock.mockReset();
  fixture.draftRow = null;
  fixture.inboxRow = null;
  dbCalls.length = 0;
});

function makeReq(): Request {
  return new Request("https://example.com/api/send/execute/draft-1", {
    method: "POST",
    body: "",
  });
}

async function loadRoute() {
  const mod = await import("@/app/api/send/execute/[draftId]/route");
  return mod.POST;
}

function paramsFor(draftId: string) {
  return { params: Promise.resolve({ draftId }) };
}

function fakeDraft(overrides: Partial<FakeDraft> = {}): FakeDraft {
  return {
    id: "draft-1",
    userId: "user-1",
    status: "sent_pending",
    gmailDraftId: "gd-1",
    inboxItemId: "ix-1",
    action: "draft_reply",
    autoSent: false,
    ...overrides,
  };
}

describe("/api/send/execute/[draftId] — auth + idempotency", () => {
  it("returns 401 when QStash signature verification fails", async () => {
    verifyMock.mockResolvedValue(false);
    const POST = await loadRoute();
    const res = await POST(
      makeReq() as never,
      paramsFor("draft-1") as never
    );
    expect(res.status).toBe(401);
    expect(sendAndAuditMock).not.toHaveBeenCalled();
  });

  it("skips silently when the draft does not exist", async () => {
    fixture.draftRow = null;
    const POST = await loadRoute();
    const res = await POST(
      makeReq() as never,
      paramsFor("draft-missing") as never
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ skipped: true, reason: "not_found" });
    expect(sendAndAuditMock).not.toHaveBeenCalled();
  });

  it("skips when the draft has already moved out of sent_pending", async () => {
    fixture.draftRow = fakeDraft({ status: "sent" });
    const POST = await loadRoute();
    const res = await POST(
      makeReq() as never,
      paramsFor("draft-1") as never
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ skipped: true, reason: "sent" });
    expect(sendAndAuditMock).not.toHaveBeenCalled();
  });
});

describe("/api/send/execute/[draftId] — happy path", () => {
  it("sends via Gmail, flips status, records sender feedback", async () => {
    fixture.draftRow = fakeDraft();
    fixture.inboxRow = {
      id: "ix-1",
      senderEmail: "prof@uni.edu",
      senderDomain: "uni.edu",
    };
    sendAndAuditMock.mockResolvedValue({ gmailMessageId: "msg-99" });

    const POST = await loadRoute();
    const res = await POST(
      makeReq() as never,
      paramsFor("draft-1") as never
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ sent: true, gmailMessageId: "msg-99" });
    expect(sendAndAuditMock).toHaveBeenCalledTimes(1);
    expect(sendAndAuditMock).toHaveBeenCalledWith(
      "user-1",
      "gd-1",
      "draft-1"
    );
    expect(recordSenderFeedbackMock).toHaveBeenCalledTimes(1);
    expect(recordSenderFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        senderEmail: "prof@uni.edu",
        userResponse: "sent",
      })
    );
  });

  it("records auto_sent feedback for an orchestrator-driven send", async () => {
    fixture.draftRow = fakeDraft({ autoSent: true });
    fixture.inboxRow = {
      id: "ix-1",
      senderEmail: "ta@uni.edu",
      senderDomain: "uni.edu",
    };
    sendAndAuditMock.mockResolvedValue({ gmailMessageId: "msg-auto" });

    const POST = await loadRoute();
    const res = await POST(
      makeReq() as never,
      paramsFor("draft-1") as never
    );
    expect(res.status).toBe(200);
    expect(recordSenderFeedbackMock).toHaveBeenCalledWith(
      expect.objectContaining({ userResponse: "auto_sent" })
    );
  });
});

describe("/api/send/execute/[draftId] — error path", () => {
  it("returns 500 when sendAndAudit throws so QStash retries", async () => {
    fixture.draftRow = fakeDraft();
    fixture.inboxRow = {
      id: "ix-1",
      senderEmail: "x@y.edu",
      senderDomain: "y.edu",
    };
    sendAndAuditMock.mockRejectedValue(new Error("gmail down"));

    const POST = await loadRoute();
    const res = await POST(
      makeReq() as never,
      paramsFor("draft-1") as never
    );
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toMatchObject({ error: "gmail down" });
    expect(sendAndAuditMock).toHaveBeenCalledTimes(1);
    expect(recordSenderFeedbackMock).not.toHaveBeenCalled();
  });
});
