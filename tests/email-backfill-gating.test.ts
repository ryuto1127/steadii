import { beforeEach, describe, expect, it, vi } from "vitest";

// CRITICAL cost/noise guarantee for the 30-day backfill.
//
// Backfilled items (older than 24h) must get L1 triage labeling + an
// embedding ONLY — NO L2 classify, deep pass, draft generation, queue
// cards, auto-cal detection, entity resolution, or notifications. This is
// enforced STRUCTURALLY by the backfillMode flag threaded through
// ingestSince → applyTriageResult, not by timing luck.
//
// These tests drive ingestSince with backfillMode and assert that none of
// the metered downstream paths (processL2 → email_classify_risk/deep +
// email_draft; proactive_proposal) are invoked, and that applyTriageResult
// receives { backfillMode: true } so it skips class-binding + auto-archive.
// The only metered task type a backfill may incur is email_embed (exercised
// inside applyTriageResult, which is mocked here).

type ForceTier = "high" | "medium";
const processL2Mock = vi.fn<
  (id: string, opts?: { forceTier?: ForceTier }) => Promise<unknown>
>(async () => ({ agentDraftId: "d1", status: "pending" }));
vi.mock("@/lib/agent/email/l2", () => ({
  processL2: (id: string, opts?: { forceTier?: ForceTier }) =>
    processL2Mock(id, opts),
}));

const triageMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const applyMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/agent/email/triage", () => ({
  triageMessage: (...a: unknown[]) => triageMock(...a),
  applyTriageResult: (...a: unknown[]) => applyMock(...a),
}));

vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async () => {},
}));

vi.mock("@/lib/integrations/google/gmail", () => ({
  GmailNotConnectedError: class extends Error {},
  getGoogleProviderAccountId: async () => "google-acct-1",
  isInvalidGrantError: () => false,
  markGmailTokenRevoked: async () => {},
}));

const fetchedIds = ["m1", "m2", "m3"];
vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  listRecentMessages: async () => fetchedIds.map((id) => ({ id })),
  getMessage: async (_userId: string, id: string) => ({
    id,
    threadId: `thr-${id}`,
    snippet: "snip",
    internalDate: String(Date.now()),
    labelIds: [],
    payload: {
      headers: [
        { name: "From", value: `sender-${id}@corp.com` },
        { name: "Subject", value: `subj ${id}` },
      ],
    },
  }),
  getHeader: (
    msg: { payload?: { headers?: Array<{ name: string; value: string }> } },
    name: string
  ) => msg.payload?.headers?.find((h) => h.name === name)?.value ?? null,
  parseAddress: (raw: string | null) => ({ email: raw ?? "", name: null }),
  parseAddressList: () => [],
  domainOfEmail: (email: string) => email.split("@")[1] ?? "",
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: () => {},
}));

const resolverMock = vi.fn();
vi.mock("@/lib/agent/entity-graph/resolver", () => ({
  resolveEntitiesInBackground: (...args: unknown[]) => resolverMock(...args),
}));

beforeEach(() => {
  processL2Mock.mockClear();
  triageMock.mockReset();
  applyMock.mockReset();
  resolverMock.mockReset();
});

async function loadIngestSince() {
  const mod = await import("@/lib/agent/email/ingest-recent");
  return mod.ingestSince;
}

function triageFor(bucket: string) {
  return {
    bucket,
    senderRole: null,
    ruleProvenance: [],
    firstTimeSender: false,
  };
}

describe("ingestSince backfillMode — cost/noise gate", () => {
  it("never invokes processL2 even for L2-eligible buckets", async () => {
    // All three buckets that WOULD trigger L2 on the normal path.
    triageMock
      .mockResolvedValueOnce(triageFor("auto_high"))
      .mockResolvedValueOnce(triageFor("auto_medium"))
      .mockResolvedValueOnce(triageFor("l2_pending"));
    applyMock
      .mockResolvedValueOnce({ id: "ibx-1" })
      .mockResolvedValueOnce({ id: "ibx-2" })
      .mockResolvedValueOnce({ id: "ibx-3" });

    const ingestSince = await loadIngestSince();
    await ingestSince("user-1", {
      sinceUnix: 1000,
      beforeUnix: 2000,
      windowLabel: "backfill_30d",
      backfillMode: true,
    });

    expect(processL2Mock).not.toHaveBeenCalled();
  });

  it("never invokes entity resolution on backfilled items", async () => {
    triageMock
      .mockResolvedValueOnce(triageFor("auto_high"))
      .mockResolvedValueOnce(triageFor("l2_pending"))
      .mockResolvedValueOnce(triageFor("auto_low"));
    applyMock
      .mockResolvedValueOnce({ id: "ibx-1" })
      .mockResolvedValueOnce({ id: "ibx-2" })
      .mockResolvedValueOnce({ id: "ibx-3" });

    const ingestSince = await loadIngestSince();
    await ingestSince("user-1", { backfillMode: true });

    expect(resolverMock).not.toHaveBeenCalled();
  });

  it("threads backfillMode:true into every applyTriageResult call", async () => {
    triageMock
      .mockResolvedValueOnce(triageFor("auto_high"))
      .mockResolvedValueOnce(triageFor("l2_pending"))
      .mockResolvedValueOnce(triageFor("auto_low"));
    applyMock
      .mockResolvedValueOnce({ id: "ibx-1" })
      .mockResolvedValueOnce({ id: "ibx-2" })
      .mockResolvedValueOnce({ id: "ibx-3" });

    const ingestSince = await loadIngestSince();
    await ingestSince("user-1", { backfillMode: true });

    expect(applyMock).toHaveBeenCalledTimes(3);
    for (const call of applyMock.mock.calls) {
      // applyTriageResult(userId, accountId, input, result, opts)
      expect(call[4]).toEqual({ backfillMode: true });
    }
  });

  it("still triages + inserts (L1 labeling is preserved)", async () => {
    triageMock
      .mockResolvedValueOnce(triageFor("auto_high"))
      .mockResolvedValueOnce(triageFor("l2_pending"))
      .mockResolvedValueOnce(triageFor("auto_medium"));
    applyMock
      .mockResolvedValueOnce({ id: "ibx-1" })
      .mockResolvedValueOnce({ id: "ibx-2" })
      .mockResolvedValueOnce({ id: "ibx-3" });

    const ingestSince = await loadIngestSince();
    const summary = await ingestSince("user-1", { backfillMode: true });

    expect(triageMock).toHaveBeenCalledTimes(3);
    expect(summary.created).toBe(3);
  });
});

describe("ingestSince normal mode — full treatment unchanged", () => {
  it("processL2 + resolver still fire and applyTriageResult gets no backfill flag", async () => {
    triageMock.mockResolvedValueOnce(triageFor("auto_high"));
    applyMock.mockResolvedValueOnce({ id: "ibx-n1" });
    triageMock.mockResolvedValueOnce(triageFor("ignore"));
    applyMock.mockResolvedValueOnce(null);
    triageMock.mockResolvedValueOnce(triageFor("ignore"));
    applyMock.mockResolvedValueOnce(null);

    const ingestSince = await loadIngestSince();
    await ingestSince("user-1", { windowLabel: "last_24h" });

    expect(processL2Mock).toHaveBeenCalledTimes(1);
    expect(resolverMock).toHaveBeenCalledTimes(1);
    expect(applyMock.mock.calls[0][4]).toEqual({ backfillMode: false });
  });
});
