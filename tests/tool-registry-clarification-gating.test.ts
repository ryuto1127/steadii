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
  openAIToolDefsReadOnly,
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

// 2026-05-13 sparring inline — openAIToolDefsReadOnly powers the
// self-critique retry pass. The retry bypasses the confirmation flow,
// so write/destructive tools must be filtered out at the schema level
// (the model literally cannot see them) — defense in depth against a
// future regression that adds a non-read tool to the chat surface.
describe("openAIToolDefsReadOnly (self-critique retry surface)", () => {
  it("returns only tools with mutability='read'", () => {
    const defs = openAIToolDefsReadOnly();
    const names = new Set(defs.map((d) => d.function.name));
    for (const tool of ALL_TOOLS) {
      if (names.has(tool.schema.name)) {
        expect(tool.schema.mutability).toBe("read");
      }
    }
  });

  it("includes email_get_body — the canonical missing-content fetcher cited by the corrective message", () => {
    const defs = openAIToolDefsReadOnly();
    expect(defs.find((d) => d.function.name === "email_get_body")).toBeDefined();
  });

  it("excludes write tools (e.g. assignments_create, calendar_create_event)", () => {
    const defs = openAIToolDefsReadOnly();
    expect(
      defs.find((d) => d.function.name === "assignments_create")
    ).toBe(undefined);
    expect(
      defs.find((d) => d.function.name === "calendar_create_event")
    ).toBe(undefined);
  });

  it("hides resolve_clarification by default just like openAIToolDefs", () => {
    const defs = openAIToolDefsReadOnly();
    expect(
      defs.find((d) => d.function.name === "resolve_clarification")
    ).toBe(undefined);
  });
});
