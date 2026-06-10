import { beforeEach, describe, expect, it, vi } from "vitest";

// applyTriageResult backfillMode gate. On a backfilled row we still insert
// (L1 label) and embed (the lone allowed metered op), but we MUST NOT run
// class binding or stamp an auto-archive proposal (a queue card). The normal
// path runs both. These tests lock that structural difference.

const embedMock = vi.fn<(...a: unknown[]) => Promise<unknown>>(
  async () => null
);
vi.mock("@/lib/agent/email/embeddings", () => ({
  embedAndStoreInboxItem: (...a: unknown[]) => embedMock(...a),
}));

const bindMock = vi.fn<(...a: unknown[]) => Promise<unknown>>(async () => ({
  classId: null,
  method: "none",
  confidence: 0,
  alternates: [],
}));
const persistBindingMock = vi.fn<(...a: unknown[]) => Promise<unknown>>(
  async () => undefined
);
vi.mock("@/lib/agent/email/class-binding", () => ({
  bindEmailToClass: (...a: unknown[]) => bindMock(...a),
  persistBinding: (...a: unknown[]) => persistBindingMock(...a),
}));

const proposeArchiveMock = vi.fn<(...a: unknown[]) => Promise<unknown>>(
  async () => ({ proposed: false })
);
vi.mock("@/lib/agent/email/auto-archive", () => ({
  maybeProposeAutoArchive: (...a: unknown[]) => proposeArchiveMock(...a),
}));

vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async () => {},
}));

vi.mock("@/lib/agent/email/rules", () => ({
  classifyEmail: () => ({}),
}));

// Minimal db stub: insert(...).values(...).onConflictDoNothing(...).
// returning() yields a created row; the embedding re-read select yields a
// vector; everything else is a no-op chain.
const createdRow = { id: "ibx-created", senderEmail: "p@corp.com" };
vi.mock("@/lib/db/client", () => ({
  db: {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [createdRow],
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ embedding: [0.1, 0.2] }],
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: {
    userId: {},
    sourceType: {},
    externalId: {},
    id: {},
  },
  agentRules: {},
  emailEmbeddings: { inboxItemId: {}, embedding: {} },
  users: {},
}));

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  isNull: () => ({}),
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureException: () => {} }));

beforeEach(() => {
  embedMock.mockClear();
  bindMock.mockClear();
  persistBindingMock.mockClear();
  proposeArchiveMock.mockClear();
});

async function loadApply() {
  const mod = await import("@/lib/agent/email/triage");
  return mod.applyTriageResult;
}

const input = {
  externalId: "ext-1",
  threadExternalId: "thr-1",
  fromEmail: "p@corp.com",
  fromName: "P",
  fromDomain: "corp.com",
  toEmails: [],
  ccEmails: [],
  subject: "subj",
  snippet: "snip",
  bodySnippet: "snip",
  receivedAt: new Date(),
  gmailLabelIds: [],
};

const result = {
  bucket: "auto_high",
  senderRole: null,
  ruleProvenance: [],
  firstTimeSender: false,
  confidence: 0.9,
  urgencyExpiresAt: null,
};

describe("applyTriageResult — backfillMode gate", () => {
  it("backfill: embeds but skips class binding + auto-archive proposal", async () => {
    const applyTriageResult = await loadApply();
    await applyTriageResult(
      "user-1",
      "acct-1",
      input as never,
      result as never,
      { backfillMode: true }
    );

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(bindMock).not.toHaveBeenCalled();
    expect(persistBindingMock).not.toHaveBeenCalled();
    expect(proposeArchiveMock).not.toHaveBeenCalled();
  });

  it("normal: embeds AND binds AND runs auto-archive proposal", async () => {
    const applyTriageResult = await loadApply();
    await applyTriageResult(
      "user-1",
      "acct-1",
      input as never,
      result as never
    );

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(bindMock).toHaveBeenCalledTimes(1);
    expect(proposeArchiveMock).toHaveBeenCalledTimes(1);
  });
});
