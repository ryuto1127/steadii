import { describe, it, expect, vi } from "vitest";

// engineer-48 — reranker unit tests. Cover:
//   - 0 / 1 candidate trivial short-circuits
//   - LLM happy path produces top-K sorted by score
//   - LLM error falls back to passthrough with score=null
//   - parseRerankOutput tolerates missing / extra ids gracefully

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "x",
    AUTH_GOOGLE_ID: "x",
    AUTH_GOOGLE_SECRET: "x",
    NOTION_CLIENT_ID: "x",
    NOTION_CLIENT_SECRET: "x",
    OPENAI_API_KEY: "x",
    STRIPE_SECRET_KEY: "x",
    STRIPE_PRICE_ID_PRO: "x",
    ENCRYPTION_KEY: "k".repeat(64),
    NODE_ENV: "test",
  }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: vi.fn(async () => ({
    usd: 0,
    credits: 0,
    usageId: "usage-1",
  })),
}));

import { parseRerankOutput, rerank } from "@/lib/agent/email/reranker";

describe("parseRerankOutput", () => {
  it("returns ranked items for valid JSON", () => {
    const scored = [
      { id: "a", text: "a", sourceType: "similar_email" as const },
      { id: "b", text: "b", sourceType: "similar_email" as const },
    ];
    const raw = JSON.stringify({
      ranked: [
        { id: "a", score: 0.9, reasoning: "Direct match." },
        { id: "b", score: 0.2, reasoning: "Unrelated." },
      ],
    });
    const out = parseRerankOutput(raw, scored);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.id === "a")?.score).toBe(0.9);
    expect(out.find((r) => r.id === "b")?.score).toBe(0.2);
  });

  it("fills missing candidates with a neutral score", () => {
    const scored = [
      { id: "a", text: "a", sourceType: "similar_email" as const },
      { id: "b", text: "b", sourceType: "similar_email" as const },
    ];
    const raw = JSON.stringify({
      ranked: [{ id: "a", score: 0.9, reasoning: "Hit." }],
    });
    const out = parseRerankOutput(raw, scored);
    expect(out).toHaveLength(2);
    expect(out.find((r) => r.id === "b")?.score).toBe(0.5);
  });

  it("ignores unknown ids the model invents", () => {
    const scored = [
      { id: "a", text: "a", sourceType: "similar_email" as const },
    ];
    const raw = JSON.stringify({
      ranked: [
        { id: "a", score: 0.7, reasoning: "" },
        { id: "ghost", score: 0.9, reasoning: "" },
      ],
    });
    const out = parseRerankOutput(raw, scored);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("a");
  });

  it("falls back to neutral scores when JSON is malformed", () => {
    const scored = [
      { id: "a", text: "a", sourceType: "similar_email" as const },
    ];
    const out = parseRerankOutput("not json", scored);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0.5);
  });

  it("falls back to neutral scores when ranked is missing", () => {
    const scored = [
      { id: "a", text: "a", sourceType: "similar_email" as const },
    ];
    const out = parseRerankOutput(JSON.stringify({}), scored);
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0.5);
  });
});

describe("rerank — trivial cases", () => {
  it("returns empty output for empty candidate list (no LLM call)", async () => {
    const out = await rerank({
      userId: "u1",
      query: "q",
      candidates: [],
      topK: 8,
    });
    expect(out.beforeCount).toBe(0);
    expect(out.afterCount).toBe(0);
    expect(out.ranked).toHaveLength(0);
    expect(out.failed).toBe(false);
  });

  it("short-circuits with score=1 for a single candidate", async () => {
    const out = await rerank({
      userId: "u1",
      query: "q",
      candidates: [
        { id: "only", text: "x", sourceType: "similar_email" },
      ],
      topK: 8,
    });
    expect(out.beforeCount).toBe(1);
    expect(out.afterCount).toBe(1);
    expect(out.ranked[0]).toMatchObject({ id: "only", score: 1 });
  });
});

describe("rerank — happy path with mocked OpenAI", () => {
  it("returns top-K sorted by score desc", async () => {
    vi.resetModules();
    vi.doMock("@/lib/integrations/openai/client", () => ({
      openai: () => ({
        chat: {
          completions: {
            create: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      ranked: [
                        { id: "low", score: 0.1, reasoning: "Off topic." },
                        { id: "mid", score: 0.6, reasoning: "Related." },
                        { id: "high", score: 0.95, reasoning: "Direct hit." },
                      ],
                    }),
                  },
                },
              ],
              usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                prompt_tokens_details: { cached_tokens: 0 },
              },
            }),
          },
        },
      }),
    }));
    const { rerank: rerankFresh } = await import(
      "@/lib/agent/email/reranker"
    );
    const out = await rerankFresh({
      userId: "u1",
      query: "test query",
      candidates: [
        { id: "low", text: "promo email", sourceType: "similar_email" },
        { id: "mid", text: "course question", sourceType: "similar_email" },
        { id: "high", text: "exact same thread", sourceType: "similar_email" },
      ],
      topK: 2,
    });
    expect(out.failed).toBe(false);
    expect(out.afterCount).toBe(2);
    expect(out.ranked.map((r) => r.id)).toEqual(["high", "mid"]);
    vi.doUnmock("@/lib/integrations/openai/client");
  });
});

describe("rerank — fail-soft", () => {
  it("returns candidates unchanged when the LLM call throws", async () => {
    vi.resetModules();
    vi.doMock("@/lib/integrations/openai/client", () => ({
      openai: () => ({
        chat: {
          completions: {
            create: async () => {
              throw new Error("OpenAI down");
            },
          },
        },
      }),
    }));
    const { rerank: rerankFresh } = await import(
      "@/lib/agent/email/reranker"
    );
    const out = await rerankFresh({
      userId: "u1",
      query: "q",
      candidates: [
        { id: "a", text: "x", sourceType: "similar_email" },
        { id: "b", text: "y", sourceType: "similar_email" },
        { id: "c", text: "z", sourceType: "similar_email" },
      ],
      topK: 2,
    });
    expect(out.failed).toBe(true);
    expect(out.afterCount).toBe(2);
    expect(out.ranked.every((r) => r.score === null)).toBe(true);
    vi.doUnmock("@/lib/integrations/openai/client");
  });
});
