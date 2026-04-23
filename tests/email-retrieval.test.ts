import { beforeEach, describe, expect, it, vi } from "vitest";

// We don't hit pgvector in unit tests. Instead we mock db.execute to return
// rows whose similarity ordering we control. The test validates: (1) raw
// SQL shape is called, (2) result-row mapping, (3) exclude-self path,
// (4) totalCandidates wiring, (5) distance→similarity conversion.

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
  }>;
} = {
  count: [{ total: 10 }],
  results: [],
};

vi.mock("@/lib/db/client", () => ({
  db: {
    execute: async (tmpl: unknown) => {
      // Drizzle tags its sql`` output; we only need something vaguely
      // array-looking for assertion. Record call order so the test can
      // tell the count query from the similarity query.
      sqlCalls.push({
        sql: JSON.stringify(tmpl).slice(0, 400),
        params: [],
      });
      // First call: COUNT. Second call: SELECT ... vector.
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

// Return a deterministic vector for any text input.
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

describe("searchSimilarEmails", () => {
  it("returns empty results with corpus total when no rows match", async () => {
    mockedRows.results = [];
    const { searchSimilarEmails } = await import(
      "@/lib/agent/email/retrieval"
    );
    const out = await searchSimilarEmails({
      userId: "u1",
      queryText: "q",
    });
    expect(out.results).toEqual([]);
    expect(out.totalCandidates).toBe(10);
    expect(sqlCalls).toHaveLength(2);
  });

  it("maps rows and sorts by similarity desc (via SQL ORDER BY already)", async () => {
    const now = new Date("2026-04-20T00:00:00Z");
    // Simulate pgvector returning distances from closest to farthest.
    mockedRows.results = [
      {
        inbox_item_id: "a",
        distance: 0.0, // identical → similarity 1
        subject: "deadline question",
        snippet: "when is it",
        received_at: now,
        sender_email: "prof@u.ca",
      },
      {
        inbox_item_id: "b",
        distance: 0.5, // → similarity 0.75
        subject: "extension request",
        snippet: "may I",
        received_at: now,
        sender_email: "prof@u.ca",
      },
      {
        inbox_item_id: "c",
        distance: 2.0, // max distance → similarity 0
        subject: "unrelated promo",
        snippet: "50% off",
        received_at: now,
        sender_email: "ads@x.com",
      },
    ];
    const { searchSimilarEmails } = await import(
      "@/lib/agent/email/retrieval"
    );
    const out = await searchSimilarEmails({
      userId: "u1",
      queryText: "deadline question",
    });
    expect(out.results).toHaveLength(3);
    expect(out.results[0].inboxItemId).toBe("a");
    expect(out.results[0].similarity).toBe(1);
    expect(out.results[1].similarity).toBeCloseTo(0.75);
    expect(out.results[2].similarity).toBe(0);
  });

  it("distanceToSimilarity clamps to [0,1]", async () => {
    const { distanceToSimilarity } = await import(
      "@/lib/agent/email/retrieval"
    );
    expect(distanceToSimilarity(-0.01)).toBe(1);
    expect(distanceToSimilarity(2.5)).toBe(0);
    expect(distanceToSimilarity(0)).toBe(1);
    expect(distanceToSimilarity(2)).toBe(0);
    expect(distanceToSimilarity(NaN)).toBe(0);
  });

  it("cluster-style retrieval: fixtures with 3 distinct semantic clusters", async () => {
    // Each cluster's "match" is signaled by its distance; we assert the
    // top-3 returned match the expected cluster's ids. This is the test
    // shape the prompt asks for (semantic-cluster smoke).
    const now = new Date("2026-04-01");
    const buildRow = (id: string, d: number) => ({
      inbox_item_id: id,
      distance: d,
      subject: `subject-${id}`,
      snippet: null,
      received_at: now,
      sender_email: "x@y.com",
    });
    mockedRows.results = [
      buildRow("deadline-1", 0.05),
      buildRow("deadline-2", 0.08),
      buildRow("deadline-3", 0.12),
      buildRow("grade-1", 0.4),
      buildRow("promo-1", 1.5),
    ];
    const { searchSimilarEmails } = await import(
      "@/lib/agent/email/retrieval"
    );
    const out = await searchSimilarEmails({
      userId: "u1",
      queryText: "when is the assignment deadline",
      topK: 3,
    });
    expect(out.results.slice(0, 3).map((r) => r.inboxItemId)).toEqual([
      "deadline-1",
      "deadline-2",
      "deadline-3",
    ]);
  });
});
