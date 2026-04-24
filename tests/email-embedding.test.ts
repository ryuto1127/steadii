import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the DB surface we touch (emailEmbeddings + usageEvents). Each fn
// returns an awaitable chain matching the Drizzle query builder shape.
const insertSpy = vi.fn();
const usageInsertSpy = vi.fn();
const existingRows: Array<{ id: string }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => existingRows,
        }),
      }),
    }),
    insert: (table: unknown) => {
      // Two insert call-sites hit this mock: (1) usage_events inside
      // recordUsage, (2) email_embeddings inside embedAndStoreInboxItem.
      // Disambiguate by the object identity Drizzle hands in as `table`.
      const tableName = (table as { __name?: string })?.__name;
      if (tableName === "usage_events") {
        return {
          values: (v: unknown) => {
            usageInsertSpy(v);
            return {
              returning: async () => [{ id: "usage-row-1" }],
            };
          },
        };
      }
      return {
        values: (v: unknown) => ({
          onConflictDoNothing: () => ({
            returning: async () => {
              insertSpy(v);
              return [{ id: "emb-row-1" }];
            },
          }),
        }),
      };
    },
  },
}));

vi.mock("@/lib/db/schema", () => ({
  emailEmbeddings: {
    __name: "email_embeddings",
    id: {},
    userId: {},
    inboxItemId: {},
  },
  usageEvents: { __name: "usage_events" },
}));

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
}));

// OpenAI stub returns a deterministic vector per input.
const fakeVector = Array.from({ length: 1536 }, (_, i) => (i % 7) / 7);
const openaiCalls: Array<{ model: string; input: string }> = [];
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    embeddings: {
      create: async ({ model, input }: { model: string; input: string }) => {
        openaiCalls.push({ model, input });
        return {
          data: [{ embedding: fakeVector }],
          usage: { prompt_tokens: 42 },
        };
      },
    },
  }),
}));

// Avoid "server-only" blowing up under Vitest.
vi.mock("server-only", () => ({}));

// Skip Sentry spans.
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
  captureException: () => {},
}));

beforeEach(() => {
  insertSpy.mockClear();
  usageInsertSpy.mockClear();
  openaiCalls.length = 0;
  existingRows.length = 0;
});
afterEach(() => vi.restoreAllMocks());

describe("embedText", () => {
  it("returns a 1536-dim vector and records usage", async () => {
    const { embedText } = await import("@/lib/agent/email/embeddings");
    const r = await embedText({ userId: "u1", text: "hello world" });
    expect(r.embedding).toHaveLength(1536);
    expect(r.tokenCount).toBe(42);
    expect(openaiCalls).toHaveLength(1);
    expect(usageInsertSpy).toHaveBeenCalledTimes(1);
    const rec = usageInsertSpy.mock.calls[0][0];
    expect(rec.taskType).toBe("email_embed");
    expect(rec.inputTokens).toBe(42);
  });

  it("is deterministic in shape across repeat calls", async () => {
    const { embedText } = await import("@/lib/agent/email/embeddings");
    const a = await embedText({ userId: "u1", text: "x" });
    const b = await embedText({ userId: "u1", text: "x" });
    expect(a.embedding.length).toBe(b.embedding.length);
    expect(a.embedding).toEqual(b.embedding);
  });
});

describe("buildEmbedInput", () => {
  it("joins subject + body with a double newline", async () => {
    const { buildEmbedInput } = await import("@/lib/agent/email/embeddings");
    expect(buildEmbedInput("hi", "there")).toBe("hi\n\nthere");
  });
  it("clamps to 2000 chars", async () => {
    const { buildEmbedInput } = await import("@/lib/agent/email/embeddings");
    const long = "a".repeat(5000);
    expect(buildEmbedInput(null, long).length).toBe(2000);
  });
  it("returns empty on all-empty input", async () => {
    const { buildEmbedInput } = await import("@/lib/agent/email/embeddings");
    expect(buildEmbedInput(null, null)).toBe("");
    expect(buildEmbedInput("   ", "\n\n")).toBe("");
  });
});

describe("embedAndStoreInboxItem idempotency", () => {
  it("skips if an embedding row already exists for this inbox_item_id", async () => {
    existingRows.push({ id: "emb-existing" });
    const { embedAndStoreInboxItem } = await import(
      "@/lib/agent/email/embeddings"
    );
    const result = await embedAndStoreInboxItem({
      userId: "u1",
      inboxItemId: "ibx1",
      subject: "hi",
      body: "there",
    });
    expect(result).toBeNull();
    expect(openaiCalls).toHaveLength(0);
  });

  it("returns null for empty input without calling OpenAI", async () => {
    const { embedAndStoreInboxItem } = await import(
      "@/lib/agent/email/embeddings"
    );
    const result = await embedAndStoreInboxItem({
      userId: "u1",
      inboxItemId: "ibx2",
      subject: null,
      body: null,
    });
    expect(result).toBeNull();
    expect(openaiCalls).toHaveLength(0);
  });

  it("inserts and returns an id on happy path", async () => {
    const { embedAndStoreInboxItem } = await import(
      "@/lib/agent/email/embeddings"
    );
    const result = await embedAndStoreInboxItem({
      userId: "u1",
      inboxItemId: "ibx3",
      subject: "question about deadline",
      body: "can I submit tomorrow?",
    });
    expect(result).toEqual({ id: "emb-row-1" });
    expect(openaiCalls).toHaveLength(1);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});
