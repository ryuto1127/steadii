import { describe, it, expect, vi } from "vitest";

// engineer-51 — registration smoke test for the lookup_entity chat
// tool. Verifies the tool appears in the openAIToolDefs() output for
// a normal chat session AND is fetchable via getToolByName. Doesn't
// exercise execution — that's covered by the lookup-tool integration
// tests (when DB is available).

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

import {
  openAIToolDefs,
  getToolByName,
} from "@/lib/agent/tool-registry";

describe("lookup_entity tool registration", () => {
  it("appears in the default chat tool list", () => {
    const defs = openAIToolDefs();
    const found = defs.find((d) => d.function.name === "lookup_entity");
    expect(found).toBeDefined();
    expect(found?.function.description).toContain("entity graph");
  });

  it("is fetchable via getToolByName", () => {
    const tool = getToolByName("lookup_entity");
    expect(tool).toBeDefined();
    expect(tool?.schema.mutability).toBe("read");
  });

  it("has a query parameter in the schema", () => {
    const tool = getToolByName("lookup_entity");
    expect(tool).toBeDefined();
    const params = tool?.schema.parameters as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(params.properties).toHaveProperty("query");
    expect(params.required).toContain("query");
  });

  it("is in the L2 tool list as well", async () => {
    const l2 = await import("@/lib/agent/email/l2-tools");
    const defs = l2.l2OpenAIToolDefs();
    expect(defs.find((d) => d.function.name === "lookup_entity")).toBeDefined();
  });
});
