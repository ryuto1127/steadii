import { beforeEach, describe, expect, it, vi } from "vitest";

// Covers C6 "drafts pause, classify continues" behavior. We mock
// assertCreditsAvailable so it is exceeded ONLY before the deep pass.
// Expected outcome: risk pass runs, deep + draft skipped, row persisted
// with status='paused' and paused_at_step='deep'.

type InboxItem = {
  id: string;
  userId: string;
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null;
  subject: string | null;
  snippet: string | null;
  firstTimeSender: boolean;
};

const inboxItems: InboxItem[] = [];
const draftInserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (inboxItems.length > 0) return inboxItems;
            return [{ email: "u@example.com", name: "U" }];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (row: Record<string, unknown>) => ({
        returning: async () => {
          draftInserts.push(row);
          return [{ id: `draft-${draftInserts.length}` }];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: {},
  agentDrafts: { id: {} },
  users: {},
}));
vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

class FakeBillingErr extends Error {
  code = "BILLING_QUOTA_EXCEEDED" as const;
  balance = {};
}
const assertMock = vi.fn();
vi.mock("@/lib/billing/credits", () => ({
  assertCreditsAvailable: (userId: string) => assertMock(userId),
  BillingQuotaExceededError: FakeBillingErr,
}));

const riskMock = vi.fn();
vi.mock("@/lib/agent/email/classify-risk", () => ({
  runRiskPass: (a: unknown) => riskMock(a),
}));
const deepMock = vi.fn();
vi.mock("@/lib/agent/email/classify-deep", () => ({
  runDeepPass: (a: unknown) => deepMock(a),
}));
const draftMock = vi.fn();
vi.mock("@/lib/agent/email/draft", () => ({
  runDraft: (a: unknown) => draftMock(a),
}));
vi.mock("@/lib/agent/email/retrieval", () => ({
  searchSimilarEmails: async () => ({ results: [], totalCandidates: 0 }),
  DEEP_PASS_TOP_K: 20,
}));
vi.mock("@/lib/agent/email/embeddings", () => ({
  buildEmbedInput: (a: string | null, b: string | null) =>
    `${a ?? ""}\n${b ?? ""}`.trim(),
}));
vi.mock("@/lib/agent/email/thread", () => ({
  fetchRecentThreadMessages: async () => [],
}));
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async () => {},
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: (t: string) =>
    t === "email_classify_risk" ? "gpt-5.4-mini" : "gpt-5.4",
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
  captureException: () => {},
}));

function addInbox() {
  inboxItems.length = 0;
  inboxItems.push({
    id: "ibx",
    userId: "u1",
    senderEmail: "grad@x.edu",
    senderDomain: "x.edu",
    senderRole: null,
    subject: "interview",
    snippet: "please confirm",
    firstTimeSender: true,
  });
}

beforeEach(() => {
  inboxItems.length = 0;
  draftInserts.length = 0;
  assertMock.mockReset();
  riskMock.mockReset();
  deepMock.mockReset();
  draftMock.mockReset();
});

describe("credit exhaustion behavior (C6)", () => {
  it("high risk + exhausted deep → risk completes, deep+draft skipped, paused='deep'", async () => {
    addInbox();
    // No gate before risk (memory: "classify continues"). First assert
    // call is before deep → denied.
    assertMock.mockRejectedValueOnce(new FakeBillingErr());
    riskMock.mockResolvedValue({
      riskTier: "high",
      confidence: 0.9,
      reasoning: "high stakes",
      usageId: "risk-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx");

    expect(riskMock).toHaveBeenCalledTimes(1);
    expect(deepMock).not.toHaveBeenCalled();
    expect(draftMock).not.toHaveBeenCalled();
    expect(out.status).toBe("paused");
    expect(out.pausedAtStep).toBe("deep");
    expect(out.riskTier).toBe("high");
    expect(out.action).toBe("paused");
    expect(draftInserts).toHaveLength(1);
    const row = draftInserts[0];
    expect(row.status).toBe("paused");
    expect(row.action).toBe("paused");
    expect(row.pausedAtStep).toBe("deep");
    expect(row.riskPassUsageId).toBe("risk-uid");
    expect(row.draftUsageId).toBeNull();
    expect(row.riskTier).toBe("high");
  });

  it("medium risk + exhausted draft → risk completes, draft skipped, paused='draft'", async () => {
    addInbox();
    // risk has no gate; draft gate denied.
    assertMock.mockRejectedValueOnce(new FakeBillingErr());
    riskMock.mockResolvedValue({
      riskTier: "medium",
      confidence: 0.7,
      reasoning: "routine",
      usageId: "risk-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx");

    expect(riskMock).toHaveBeenCalledTimes(1);
    expect(draftMock).not.toHaveBeenCalled();
    expect(out.pausedAtStep).toBe("draft");
    expect(out.riskTier).toBe("medium");
    expect(out.action).toBe("paused");
    expect(draftInserts[0].status).toBe("paused");
    expect(draftInserts[0].action).toBe("paused");
    expect(draftInserts[0].riskTier).toBe("medium");
  });

  it("low risk + exhausted → completes normally (no_op, no gate hit)", async () => {
    addInbox();
    // assertCreditsAvailable is only called before deep/draft; low risk
    // never reaches either, so credit exhaustion is irrelevant and the
    // draft row persists as status='pending' action='no_op'.
    riskMock.mockResolvedValue({
      riskTier: "low",
      confidence: 0.85,
      reasoning: "acknowledgement",
      usageId: "risk-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx");

    expect(riskMock).toHaveBeenCalledTimes(1);
    expect(deepMock).not.toHaveBeenCalled();
    expect(draftMock).not.toHaveBeenCalled();
    expect(assertMock).not.toHaveBeenCalled();
    expect(out.status).toBe("pending");
    expect(out.pausedAtStep).toBeNull();
    expect(out.action).toBe("no_op");
    expect(draftInserts[0].status).toBe("pending");
    expect(draftInserts[0].action).toBe("no_op");
  });
});
