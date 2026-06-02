import { beforeEach, describe, expect, it, vi } from "vitest";

// Mirrors tests/email-retrieval.test.ts's mock setup (self-contained), with
// the mocked row shape extended by sender_name. Asserts that Steadii
// self-sender rows pulled into the vector slate are dropped before mapping
// to SimilarEmail, while normal rows pass through. This is the going-forward
// half of the SELF_REFERENCE_RETRIEVAL_LOOP fix (the backfill clears legacy
// rows; this filter keeps the slate clean for all future retrievals).

type SqlTemplate = { sql: string; params: unknown[] };
const sqlCalls: SqlTemplate[] = [];
const mockedRows: {
  count: Array<{ total: number }>;
  results: Array<{
    inbox_item_id: string;
    distance: number;
    subject: string | null;
    snippet: string | null;
    received_at: Date;
    sender_email: string;
    sender_name: string | null;
  }>;
} = {
  count: [{ total: 10 }],
  results: [],
};

vi.mock("@/lib/db/client", () => ({
  db: {
    execute: async (tmpl: unknown) => {
      sqlCalls.push({ sql: JSON.stringify(tmpl).slice(0, 400), params: [] });
      if (sqlCalls.length === 1) {
        return { rows: mockedRows.count };
      }
      return { rows: mockedRows.results };
    },
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings,
    values,
  }),
}));

vi.mock("server-only", () => ({}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

vi.mock("@/lib/agent/email/embeddings", () => ({
  embedText: async () => ({
    embedding: new Array(1536).fill(0.01),
    tokenCount: 10,
    model: "text-embedding-3-small",
  }),
}));

beforeEach(() => {
  sqlCalls.length = 0;
  mockedRows.count = [{ total: 10 }];
  mockedRows.results = [];
});

describe("searchSimilarEmails — self-sender exclusion", () => {
  const now = new Date("2026-05-20T00:00:00Z");

  it("drops a self-sender row (self-sender email) and keeps normal rows", async () => {
    mockedRows.results = [
      {
        inbox_item_id: "normal-1",
        distance: 0.1,
        subject: "deadline question",
        snippet: "when is it due",
        received_at: now,
        sender_email: "prof@example.edu",
        sender_name: "Course Staff",
      },
      {
        inbox_item_id: "self-digest",
        distance: 0.2,
        subject: "朝のダイジェスト",
        snippet: "your morning digest",
        received_at: now,
        sender_email: "agent@mysteadii.com",
        sender_name: "Steadii Agent",
      },
      {
        inbox_item_id: "normal-2",
        distance: 0.3,
        subject: "extension request",
        snippet: "may I have more time",
        received_at: now,
        sender_email: "ta@example.edu",
        sender_name: "Teaching Assistant",
      },
    ];
    const { searchSimilarEmails } = await import("@/lib/agent/email/retrieval");
    const out = await searchSimilarEmails({ userId: "u1", queryText: "q" });
    const ids = out.results.map((r) => r.inboxItemId);
    expect(ids).not.toContain("self-digest");
    expect(ids).toContain("normal-1");
    expect(ids).toContain("normal-2");
    expect(out.results).toHaveLength(2);
  });

  it("drops a row whose email is normal but from-name is 'Steadii Agent'", async () => {
    mockedRows.results = [
      {
        inbox_item_id: "normal-1",
        distance: 0.1,
        subject: "deadline question",
        snippet: "when is it due",
        received_at: now,
        sender_email: "prof@example.edu",
        sender_name: "Course Staff",
      },
      {
        inbox_item_id: "self-by-name",
        distance: 0.2,
        subject: "週次ダイジェスト",
        snippet: "your weekly digest",
        received_at: now,
        // Email rewritten by a relay so the domain looks external, but the
        // from-name still identifies Steadii's own digest.
        sender_email: "bounce@relay.example",
        sender_name: "Steadii Agent",
      },
    ];
    const { searchSimilarEmails } = await import("@/lib/agent/email/retrieval");
    const out = await searchSimilarEmails({ userId: "u1", queryText: "q" });
    const ids = out.results.map((r) => r.inboxItemId);
    expect(ids).not.toContain("self-by-name");
    expect(ids).toEqual(["normal-1"]);
  });
});
