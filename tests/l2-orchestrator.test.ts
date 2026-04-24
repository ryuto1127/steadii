import { beforeEach, describe, expect, it, vi } from "vitest";

// End-to-end orchestrator test with mocked OpenAI + DB. Validates:
// 1. risk → deep → draft persistence on happy path
// 2. medium-risk path skips deep, generates a draft
// 3. low-risk path does no_op and skips the draft
// 4. usage pointers + retrieval_provenance are set correctly

type InboxItem = {
  id: string;
  userId: string;
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null;
  subject: string | null;
  snippet: string | null;
  firstTimeSender: boolean;
  ruleProvenance: Array<{ ruleId: string; source: string; why: string }> | null;
};

const inboxItems: InboxItem[] = [];
const draftInserts: Array<Record<string, unknown>> = [];
const inboxUpdates: Array<{ id: string; riskTier: string }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (_table: unknown) => ({
        where: () => ({
          limit: async () => {
            // Return the inbox item or the user row based on which mock is
            // being hit; the test sets only one at a time.
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
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          inboxUpdates.push({
            id: "ibx",
            riskTier: String(patch.riskTier ?? ""),
          });
        },
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: {},
  agentDrafts: { id: {} },
  users: {},
}));

vi.mock("drizzle-orm", () => ({ eq: () => ({}) }));

// Credit gate: never throws in the happy path.
vi.mock("@/lib/billing/credits", () => ({
  assertCreditsAvailable: vi.fn(async () => ({
    plan: "pro",
    used: 0,
    limit: 1000,
    remaining: 1000,
    topupRemaining: 0,
    windowStart: new Date(),
    windowEnd: new Date(),
    exceeded: false,
    nearLimit: false,
  })),
  BillingQuotaExceededError: class extends Error {
    code = "BILLING_QUOTA_EXCEEDED" as const;
    constructor(public balance: unknown = null) {
      super("quota");
    }
  },
}));

const riskMock = vi.fn();
vi.mock("@/lib/agent/email/classify-risk", () => ({
  runRiskPass: (args: unknown) => riskMock(args),
}));

const deepMock = vi.fn();
vi.mock("@/lib/agent/email/classify-deep", () => ({
  runDeepPass: (args: unknown) => deepMock(args),
}));

const draftMock = vi.fn();
vi.mock("@/lib/agent/email/draft", () => ({
  runDraft: (args: unknown) => draftMock(args),
}));

type SearchResult = {
  results: Array<{
    inboxItemId: string;
    similarity: number;
    subject: string | null;
    snippet: string | null;
    receivedAt: Date;
    senderEmail: string;
  }>;
  totalCandidates: number;
};
const searchMock = vi.fn<() => Promise<SearchResult>>(async () => ({
  results: [],
  totalCandidates: 0,
}));
vi.mock("@/lib/agent/email/retrieval", () => ({
  searchSimilarEmails: searchMock,
  DEEP_PASS_TOP_K: 20,
}));

vi.mock("@/lib/agent/email/embeddings", () => ({
  buildEmbedInput: (a: string | null, b: string | null) =>
    `${a ?? ""}\n${b ?? ""}`.trim(),
}));

vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: vi.fn(async () => {}),
}));

vi.mock("@/lib/agent/models", () => ({
  selectModel: (t: string) =>
    t === "email_classify_deep" || t === "email_draft"
      ? "gpt-5.4"
      : t === "email_classify_risk"
      ? "gpt-5.4-mini"
      : "gpt-5.4-mini",
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
  captureException: () => {},
}));

function addInbox(overrides: Partial<InboxItem> = {}) {
  const base: InboxItem = {
    id: "ibx",
    userId: "u1",
    senderEmail: "x@y.edu",
    senderDomain: "y.edu",
    senderRole: null,
    subject: "s",
    snippet: "sn",
    firstTimeSender: false,
    ruleProvenance: null,
    ...overrides,
  };
  inboxItems.length = 0;
  inboxItems.push(base);
}

beforeEach(() => {
  inboxItems.length = 0;
  draftInserts.length = 0;
  inboxUpdates.length = 0;
  riskMock.mockReset();
  deepMock.mockReset();
  draftMock.mockReset();
  searchMock.mockClear();
});

describe("processL2 orchestrator", () => {
  it("high risk → deep → draft; persists provenance + usage pointers", async () => {
    addInbox();
    riskMock.mockResolvedValue({
      riskTier: "high",
      confidence: 0.9,
      reasoning: "hi",
      usageId: "risk-uid",
    });
    deepMock.mockResolvedValue({
      action: "draft_reply",
      reasoning: "deep said reply",
      retrievalProvenance: {
        sources: [{ type: "email", id: "p1", similarity: 0.9, snippet: "x" }],
        total_candidates: 5,
        returned: 1,
      },
      usageId: "deep-uid",
    });
    draftMock.mockResolvedValue({
      subject: "Re: s",
      body: "body",
      to: ["prof@y.edu"],
      cc: [],
      inReplyTo: null,
      usageId: "draft-uid",
    });
    searchMock.mockResolvedValue({
      results: [
        {
          inboxItemId: "p1",
          similarity: 0.9,
          subject: "past",
          snippet: "x",
          receivedAt: new Date(),
          senderEmail: "prof@y.edu",
        },
      ],
      totalCandidates: 5,
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx");

    expect(out.status).toBe("pending");
    expect(out.riskTier).toBe("high");
    expect(out.action).toBe("draft_reply");
    expect(draftInserts).toHaveLength(1);
    const row = draftInserts[0];
    expect(row.riskPassUsageId).toBe("risk-uid");
    expect(row.deepPassUsageId).toBe("deep-uid");
    expect(row.draftUsageId).toBe("draft-uid");
    expect(row.retrievalProvenance).toEqual({
      sources: [{ type: "email", id: "p1", similarity: 0.9, snippet: "x" }],
      total_candidates: 5,
      returned: 1,
    });
    expect(row.action).toBe("draft_reply");
    expect(row.draftBody).toBe("body");
    expect(inboxUpdates[0]?.riskTier).toBe("high");
  });

  it("medium risk: skips deep pass, generates draft with empty retrieval", async () => {
    addInbox();
    riskMock.mockResolvedValue({
      riskTier: "medium",
      confidence: 0.7,
      reasoning: "med",
      usageId: "risk-uid",
    });
    draftMock.mockResolvedValue({
      subject: "Re: s",
      body: "b",
      to: ["x@y.edu"],
      cc: [],
      inReplyTo: null,
      usageId: "draft-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx");

    expect(deepMock).not.toHaveBeenCalled();
    expect(draftMock).toHaveBeenCalled();
    expect(out.action).toBe("draft_reply");
    expect(draftInserts[0].retrievalProvenance).toBeNull();
    expect(draftInserts[0].deepPassUsageId).toBeNull();
  });

  it("low risk: no_op; no draft generated; still persists a row", async () => {
    addInbox();
    riskMock.mockResolvedValue({
      riskTier: "low",
      confidence: 0.9,
      reasoning: "rsvp",
      usageId: "risk-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx");

    expect(deepMock).not.toHaveBeenCalled();
    expect(draftMock).not.toHaveBeenCalled();
    expect(out.action).toBe("no_op");
    expect(out.status).toBe("pending");
    expect(draftInserts[0].draftBody).toBeNull();
    expect(draftInserts[0].action).toBe("no_op");
  });

  it("forceTier:'high' skips risk pass, runs deep+draft with synthesized L1 reasoning", async () => {
    addInbox({
      ruleProvenance: [
        {
          ruleId: "GLOBAL_AUTO_HIGH_INTERNSHIP",
          source: "global",
          why: "Internship / interview / offer.",
        },
      ],
    });
    deepMock.mockResolvedValue({
      action: "draft_reply",
      reasoning: "deep said reply",
      retrievalProvenance: {
        sources: [],
        total_candidates: 0,
        returned: 0,
      },
      usageId: "deep-uid",
    });
    draftMock.mockResolvedValue({
      subject: "Re: s",
      body: "body",
      to: ["recruiter@corp.com"],
      cc: [],
      inReplyTo: null,
      usageId: "draft-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx", { forceTier: "high" });

    expect(riskMock).not.toHaveBeenCalled();
    expect(deepMock).toHaveBeenCalled();
    // Deep pass must see the synthesized L1 reasoning so it can cite it.
    const deepArgs = deepMock.mock.calls[0]?.[0] as {
      riskPass: { riskTier: string; reasoning: string; usageId: string | null };
    };
    expect(deepArgs.riskPass.riskTier).toBe("high");
    expect(deepArgs.riskPass.usageId).toBeNull();
    expect(deepArgs.riskPass.reasoning).toContain("GLOBAL_AUTO_HIGH_INTERNSHIP");

    expect(out.status).toBe("pending");
    expect(out.riskTier).toBe("high");
    expect(out.action).toBe("draft_reply");

    const row = draftInserts[0];
    expect(row.riskTier).toBe("high");
    // No risk-pass usage to record.
    expect(row.riskPassUsageId).toBeNull();
    expect(row.deepPassUsageId).toBe("deep-uid");
    expect(row.draftUsageId).toBe("draft-uid");
    expect(row.action).toBe("draft_reply");
    expect(row.draftBody).toBe("body");
    expect(inboxUpdates[0]?.riskTier).toBe("high");
  });

  it("forceTier:'high' with empty provenance falls back to generic reasoning", async () => {
    addInbox({ ruleProvenance: [] });
    deepMock.mockResolvedValue({
      action: "archive",
      reasoning: "receipt only",
      retrievalProvenance: { sources: [], total_candidates: 0, returned: 0 },
      usageId: "deep-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx", { forceTier: "high" });

    expect(riskMock).not.toHaveBeenCalled();
    const deepArgs = deepMock.mock.calls[0]?.[0] as {
      riskPass: { reasoning: string };
    };
    expect(deepArgs.riskPass.reasoning).toContain("AUTO_HIGH");
    expect(out.riskTier).toBe("high");
    expect(out.action).toBe("archive");
  });

  it("uses deep-pass action (e.g. archive) even on high risk", async () => {
    addInbox();
    riskMock.mockResolvedValue({
      riskTier: "high",
      confidence: 0.9,
      reasoning: "hi",
      usageId: "risk-uid",
    });
    deepMock.mockResolvedValue({
      action: "archive",
      reasoning: "receipt only",
      retrievalProvenance: {
        sources: [],
        total_candidates: 0,
        returned: 0,
      },
      usageId: "deep-uid",
    });

    const { processL2 } = await import("@/lib/agent/email/l2");
    const out = await processL2("ibx");

    expect(draftMock).not.toHaveBeenCalled();
    expect(out.action).toBe("archive");
    expect(draftInserts[0].reasoning).toBe("receipt only");
  });
});
