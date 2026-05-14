import { beforeEach, describe, expect, it, vi } from "vitest";

// Narrow hotfix test: ingestLast24h must route `auto_high` and `auto_medium`
// items through processL2 with the matching forceTier so an agent_draft
// gets created. Prior to the hotfixes, only `l2_pending` items invoked
// processL2 and strict-tier auto_* rows ended up without drafts —
// unreachable from the Inbox UI.

type ForceTier = "high" | "medium";
const processL2Mock = vi.fn<
  (id: string, opts?: { forceTier?: ForceTier }) => Promise<unknown>
>(async () => ({
  agentDraftId: "d1",
  status: "pending",
  action: "draft_reply",
  pausedAtStep: null,
  riskTier: "high",
}));
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

// engineer-51 — resolver module pulls in db + entity-graph deps; the
// ingest path only needs the fire-and-forget no-op behavior here.
// engineer-59 — track invocations to assert the auto_low gate skips it.
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

  it("auto_medium bucket invokes processL2 with forceTier='medium'", async () => {
    triageMock.mockResolvedValueOnce(triageFor("auto_medium"));
    applyMock.mockResolvedValueOnce({ id: "inbox-3m" });
    triageMock.mockResolvedValueOnce(triageFor("ignore"));
    applyMock.mockResolvedValueOnce(null);

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(processL2Mock).toHaveBeenCalledTimes(1);
    expect(processL2Mock).toHaveBeenCalledWith("inbox-3m", {
      forceTier: "medium",
    });
  });

  it("auto_low and ignore buckets do NOT invoke processL2", async () => {
    triageMock
      .mockResolvedValueOnce(triageFor("auto_low"))
      .mockResolvedValueOnce(triageFor("ignore"));
    applyMock
      .mockResolvedValueOnce({ id: "inbox-4" })
      .mockResolvedValueOnce(null);

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(processL2Mock).not.toHaveBeenCalled();
  });

  // engineer-59 — UNGATED_AGENT_WORK fix. resolveEntitiesInBackground
  // runs an LLM extractor (taskType=tool_call) per inbox row; on
  // auto_low (newsletters / transactional / no-reply) it earns nothing.
  it("auto_low bucket skips resolveEntitiesInBackground", async () => {
    triageMock.mockResolvedValueOnce(triageFor("auto_low"));
    applyMock.mockResolvedValueOnce({ id: "inbox-low" });
    triageMock.mockResolvedValueOnce(triageFor("ignore"));
    applyMock.mockResolvedValueOnce(null);

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(resolverMock).not.toHaveBeenCalled();
  });

  it("auto_high bucket still runs resolveEntitiesInBackground", async () => {
    triageMock.mockResolvedValueOnce(triageFor("auto_high"));
    applyMock.mockResolvedValueOnce({ id: "inbox-high" });
    triageMock.mockResolvedValueOnce(triageFor("ignore"));
    applyMock.mockResolvedValueOnce(null);

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(resolverMock).toHaveBeenCalledTimes(1);
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
