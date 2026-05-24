import { beforeEach, describe, expect, it, vi } from "vitest";

// Self-filter coverage. Steadii's own outbound mail (digest, drafts,
// system messages) sent from @mysteadii.com (and the legacy .xyz
// domain) must never reach the user's queue. The gate fires before
// triage so we don't burn LLM credits classifying our own outbound.
//
// Test pattern mirrors ingest-recent-routing.test.ts: stub the Gmail
// fetch layer with synthetic payloads, mock triage + apply, and assert
// the downstream calls were skipped for self-sender variants.

const triageMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const applyMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock("@/lib/agent/email/triage", () => ({
  triageMessage: (...a: unknown[]) => triageMock(...a),
  applyTriageResult: (...a: unknown[]) => applyMock(...a),
}));

vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async () => {},
}));

vi.mock("@/lib/agent/email/l2", () => ({
  processL2: async () => ({}),
}));

vi.mock("@/lib/agent/entity-graph/resolver", () => ({
  resolveEntitiesInBackground: () => {},
}));

vi.mock("@/lib/integrations/google/gmail", () => ({
  GmailNotConnectedError: class extends Error {},
  getGoogleProviderAccountId: async () => "google-acct-1",
}));

// Per-test message store — each test seeds `messages` with the
// (id → fromHeader) map it wants the Gmail fetch layer to return.
const messages: Map<string, string> = new Map();

vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  listRecentMessages: async () =>
    [...messages.keys()].map((id) => ({ id })),
  getMessage: async (_userId: string, id: string) => ({
    id,
    threadId: null,
    snippet: "snip",
    internalDate: String(Date.now()),
    labelIds: [],
    payload: {
      headers: [
        { name: "From", value: messages.get(id) ?? "" },
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

beforeEach(() => {
  triageMock.mockReset();
  applyMock.mockReset();
  messages.clear();
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

describe("ingestLast24h → self-filter (@mysteadii.com / .xyz)", () => {
  it("normal third-party sender is NOT filtered (control)", async () => {
    messages.set("m-third-party", "user@external-domain.example");
    triageMock.mockResolvedValueOnce(triageFor("auto_low"));
    applyMock.mockResolvedValueOnce({ id: "inbox-1" });

    const ingest = await loadIngest();
    await ingest("user-1");

    expect(triageMock).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledTimes(1);
  });

  it("filters noreply@mysteadii.com (canonical self-sender)", async () => {
    messages.set("m-noreply", "noreply@mysteadii.com");

    const ingest = await loadIngest();
    const summary = await ingest("user-1");

    expect(triageMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.created).toBe(0);
  });

  it("filters digest@mysteadii.com (different local-part)", async () => {
    messages.set("m-digest", "digest@mysteadii.com");

    const ingest = await loadIngest();
    const summary = await ingest("user-1");

    expect(triageMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it("filters NoReply@MySteadii.com (case mix)", async () => {
    messages.set("m-case", "NoReply@MySteadii.com");

    const ingest = await loadIngest();
    const summary = await ingest("user-1");

    expect(triageMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it("filters something@mysteadii.xyz (legacy domain)", async () => {
    messages.set("m-legacy", "something@mysteadii.xyz");

    const ingest = await loadIngest();
    const summary = await ingest("user-1");

    expect(triageMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
  });

  it("mixed batch: filters self-senders, routes third-party through", async () => {
    messages.set("m-self-1", "noreply@mysteadii.com");
    messages.set("m-third", "user@external-domain.example");
    messages.set("m-self-2", "digest@mysteadii.xyz");

    triageMock.mockResolvedValueOnce(triageFor("auto_low"));
    applyMock.mockResolvedValueOnce({ id: "inbox-third" });

    const ingest = await loadIngest();
    const summary = await ingest("user-1");

    // Triage runs exactly once — for the third-party row.
    expect(triageMock).toHaveBeenCalledTimes(1);
    expect(applyMock).toHaveBeenCalledTimes(1);
    expect(summary.skipped).toBe(2);
    expect(summary.created).toBe(1);
  });
});

describe("isSteadiiSelfSender (unit)", () => {
  it("returns false for null / undefined / empty", async () => {
    const { isSteadiiSelfSender } = await import("@/lib/agent/email/ingest-recent");
    expect(isSteadiiSelfSender(null)).toBe(false);
    expect(isSteadiiSelfSender(undefined)).toBe(false);
    expect(isSteadiiSelfSender("")).toBe(false);
  });

  it("returns false for third-party domains", async () => {
    const { isSteadiiSelfSender } = await import("@/lib/agent/email/ingest-recent");
    expect(isSteadiiSelfSender("alice@external-domain.example")).toBe(false);
    expect(isSteadiiSelfSender("bot@mysteadii-evil.example")).toBe(false);
  });

  it("matches both .com and .xyz domains, any local-part, any case", async () => {
    const { isSteadiiSelfSender } = await import("@/lib/agent/email/ingest-recent");
    expect(isSteadiiSelfSender("noreply@mysteadii.com")).toBe(true);
    expect(isSteadiiSelfSender("digest@mysteadii.com")).toBe(true);
    expect(isSteadiiSelfSender("NoReply@MySteadii.com")).toBe(true);
    expect(isSteadiiSelfSender("something@mysteadii.xyz")).toBe(true);
    expect(isSteadiiSelfSender("  noreply@mysteadii.com  ")).toBe(true);
  });
});
