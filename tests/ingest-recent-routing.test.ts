import { beforeEach, describe, expect, it, vi } from "vitest";

// Narrow hotfix test: ingestLast24h must route `auto_high` items through
// processL2 with `forceTier: "high"` so an agent_draft gets created. Prior
// to this fix, only `l2_pending` items invoked processL2 and auto_high
// inbox rows ended up without drafts — unreachable from the Inbox UI.

const processL2Mock = vi.fn<
  (id: string, opts?: { forceTier?: "high" }) => Promise<unknown>
>(async () => ({
  agentDraftId: "d1",
  status: "pending",
  action: "draft_reply",
  pausedAtStep: null,
  riskTier: "high",
}));
vi.mock("@/lib/agent/email/l2", () => ({
  processL2: (id: string, opts?: { forceTier?: "high" }) =>
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
}));

const fetchedIds: string[] = ["m1", "m2"];
vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  listRecentMessages: async () => fetchedIds.map((id) => ({ id })),
  getMessage: async (_userId: string, id: string) => ({
    id,
    threadId: null,
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
  getHeader: (msg: { payload?: { headers?: Array<{ name: string; value: string }> } }, name: string) =>
    msg.payload?.headers?.find((h) => h.name === name)?.value ?? null,
  parseAddress: (raw: string | null) => ({ email: raw ?? "", name: null }),
  parseAddressList: () => [],
  domainOfEmail: (email: string) => email.split("@")[1] ?? "",
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: () => {},
}));

beforeEach(() => {
  processL2Mock.mockClear();
  triageMock.mockReset();
  applyMock.mockReset();
});

async function loadIngest() {
  const mod = await import("@/lib/agent/email/ingest-recent");
  return mod.ingestLast24h;
}

function triageFor(bucket: string) {
  return {
    bucket,
    senderRole: null,
    ruleProvenance: [],
    firstTimeSender: false,
  };
}

describe("ingestLast24h → processL2 routing", () => {
  it("auto_high bucket invokes processL2 with forceTier='high'", async () => {
    triageMock
      .mockResolvedValueOnce(triageFor("auto_high"))
      .mockResolvedValueOnce(triageFor("ignore"));
    applyMock
      .mockResolvedValueOnce({ id: "inbox-1" })
      .mockResolvedValueOnce(null);

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(processL2Mock).toHaveBeenCalledTimes(1);
    expect(processL2Mock).toHaveBeenCalledWith("inbox-1", { forceTier: "high" });
  });

  it("l2_pending bucket invokes processL2 with no forceTier", async () => {
    triageMock.mockResolvedValueOnce(triageFor("l2_pending"));
    applyMock.mockResolvedValueOnce({ id: "inbox-2" });
    // second message has no inbox row (dup)
    triageMock.mockResolvedValueOnce(triageFor("l2_pending"));
    applyMock.mockResolvedValueOnce(null);

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(processL2Mock).toHaveBeenCalledTimes(1);
    expect(processL2Mock).toHaveBeenCalledWith("inbox-2", {});
  });

  it("auto_medium and auto_low buckets do NOT invoke processL2", async () => {
    triageMock
      .mockResolvedValueOnce(triageFor("auto_medium"))
      .mockResolvedValueOnce(triageFor("auto_low"));
    applyMock
      .mockResolvedValueOnce({ id: "inbox-3" })
      .mockResolvedValueOnce({ id: "inbox-4" });

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(processL2Mock).not.toHaveBeenCalled();
  });

  it("processL2 failure on one item does not poison the ingest", async () => {
    processL2Mock.mockRejectedValueOnce(new Error("boom"));
    triageMock
      .mockResolvedValueOnce(triageFor("auto_high"))
      .mockResolvedValueOnce(triageFor("l2_pending"));
    applyMock
      .mockResolvedValueOnce({ id: "inbox-5" })
      .mockResolvedValueOnce({ id: "inbox-6" });

    const ingest = await loadIngest();
    const summary = await ingest("user-1");

    expect(processL2Mock).toHaveBeenCalledTimes(2);
    expect(summary.created).toBe(2);
  });
});
