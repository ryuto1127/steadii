import { describe, expect, it, vi } from "vitest";

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
  recordUsage: vi.fn(async () => ({ usd: 0, credits: 0, usageId: "usage-1" })),
}));

import { parseExtractorOutput } from "@/lib/agent/entity-graph/extractor";

// engineer-51 — extractor parser is pure; we test the shape-validation
// + safe-default paths without invoking the LLM. The same parser
// handles real model responses + malformed garbage in production.

describe("parseExtractorOutput", () => {
  it("parses a valid response", () => {
    const raw = JSON.stringify({
      entities: [
        {
          kind: "person",
          displayName: "Prof. Tanaka",
          aliases: ["田中先生", "Tanaka-sensei"],
        },
        { kind: "course", displayName: "MAT223", aliases: [] },
      ],
    });
    const out = parseExtractorOutput(raw);
    expect(out).toHaveLength(2);
    expect(out[0].kind).toBe("person");
    expect(out[0].displayName).toBe("Prof. Tanaka");
    expect(out[0].aliases).toEqual(["田中先生", "Tanaka-sensei"]);
    expect(out[1].kind).toBe("course");
  });

  it("returns [] on invalid JSON", () => {
    expect(parseExtractorOutput("not json")).toEqual([]);
    expect(parseExtractorOutput("{")).toEqual([]);
  });

  it("returns [] when entities key is missing or wrong type", () => {
    expect(parseExtractorOutput(JSON.stringify({}))).toEqual([]);
    expect(parseExtractorOutput(JSON.stringify({ entities: "no" }))).toEqual([]);
  });

  it("filters out entries with invalid kind", () => {
    const raw = JSON.stringify({
      entities: [
        { kind: "alien", displayName: "Xeno", aliases: [] },
        { kind: "person", displayName: "Valid", aliases: [] },
      ],
    });
    const out = parseExtractorOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].displayName).toBe("Valid");
  });

  it("filters out entries with empty displayName", () => {
    const raw = JSON.stringify({
      entities: [
        { kind: "person", displayName: "", aliases: [] },
        { kind: "person", displayName: "   ", aliases: [] },
        { kind: "person", displayName: "Real", aliases: [] },
      ],
    });
    const out = parseExtractorOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].displayName).toBe("Real");
  });

  it("caps at MAX_CANDIDATES_PER_CALL (6)", () => {
    const entities = Array.from({ length: 12 }, (_, i) => ({
      kind: "person",
      displayName: `Person ${i}`,
      aliases: [],
    }));
    const out = parseExtractorOutput(JSON.stringify({ entities }));
    expect(out).toHaveLength(6);
  });

  it("trims and clamps displayName + aliases", () => {
    const raw = JSON.stringify({
      entities: [
        {
          kind: "org",
          displayName: "  アクメトラベル  ",
          aliases: ["  Reiwa  Travel  ", "RT"],
        },
      ],
    });
    const out = parseExtractorOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].displayName).toBe("アクメトラベル");
    expect(out[0].aliases).toEqual(["Reiwa  Travel", "RT"]);
  });

  it("normalizes missing aliases to []", () => {
    const raw = JSON.stringify({
      entities: [{ kind: "project", displayName: "X" }],
    });
    const out = parseExtractorOutput(raw);
    expect(out).toHaveLength(1);
    expect(out[0].aliases).toEqual([]);
  });
});
