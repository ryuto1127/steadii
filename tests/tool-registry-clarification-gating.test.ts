import { describe, it, expect, vi } from "vitest";

// engineer-46 — tool-registry session-scoped gating. Asserts that
// `resolve_clarification` only shows up in the OpenAI tool list when
// the chat session has a non-null clarifyingDraftId. The default (no
// context) call site keeps it hidden as a defense-in-depth measure.

vi.mock("server-only", () => ({}));

// The registry pulls in every tool module which transitively touches
// env-validated clients (notion, db, etc.). Stub env + db to a no-op
// so importing the registry doesn't crash.
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
  toolsForChatSession,
  ALL_TOOLS,
} from "@/lib/agent/tool-registry";

describe("tool-registry clarification gating", () => {
  it("openAIToolDefs() with no context hides resolve_clarification", () => {
    const defs = openAIToolDefs();
    expect(defs.find((d) => d.function.name === "resolve_clarification")).toBe(
      undefined
    );
  });

  it("openAIToolDefs({ clarifyingDraftId: null }) hides resolve_clarification", () => {
    const defs = openAIToolDefs({ clarifyingDraftId: null });
    expect(defs.find((d) => d.function.name === "resolve_clarification")).toBe(
      undefined
    );
  });

  it("openAIToolDefs({ clarifyingDraftId: '<id>' }) exposes resolve_clarification", () => {
    const defs = openAIToolDefs({
      clarifyingDraftId: "00000000-0000-0000-0000-000000000001",
    });
    expect(
      defs.find((d) => d.function.name === "resolve_clarification")
    ).toBeDefined();
  });

  it("toolsForChatSession honours the same gating", () => {
    const regular = toolsForChatSession({ clarifyingDraftId: null });
    const clarif = toolsForChatSession({ clarifyingDraftId: "x" });
    expect(
      regular.find((t) => t.schema.name === "resolve_clarification")
    ).toBe(undefined);
    expect(
      clarif.find((t) => t.schema.name === "resolve_clarification")
    ).toBeDefined();
  });

  it("ALL_TOOLS still includes resolve_clarification so getToolByName works after deferred confirmations", () => {
    expect(
      ALL_TOOLS.find((t) => t.schema.name === "resolve_clarification")
    ).toBeDefined();
  });
});
