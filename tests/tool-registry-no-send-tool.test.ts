import { describe, it, expect, vi } from "vitest";

// 2026-06-09 — consent-first-by-absence invariant.
//
// Steadii's send contract is: the agent PREPARES a reply (Gmail draft) and
// the user confirms it with an explicit click + an undo window. There is
// NO chat tool the model can call to actually SEND an email — the only
// send paths are the user-gated inbox-detail / queue Send and the staged-
// autonomy auto-send (which now fact-checks + fails closed). Registering a
// send tool in the chat tool registry would let the orchestrator dispatch
// a send mid-conversation, bypassing the confirm/undo contract entirely.
//
// `gmail_send` (lib/agent/tools/gmail.ts) only CREATES a draft despite its
// name, but it is deliberately NOT added to ALL_TOOLS. This test codifies
// that: no send-capable tool (anything wrapping Gmail send) may appear in
// the chat tool registry. If a future change registers one, this fails
// loudly so the consent-first contract is a conscious decision, not a
// silent regression.

vi.mock("server-only", () => ({}));

// The registry transitively imports every tool module, which touches
// env-validated clients. Stub env + db so importing it doesn't crash.
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

import { ALL_TOOLS, getToolByName } from "@/lib/agent/tool-registry";

// Names of every known send-capable tool. The gmail module exports a
// `gmail_send` schema (draft-create) + a lower-level `gmail.drafts.send`
// helper name; neither may be registered.
const KNOWN_SEND_TOOL_NAMES = ["gmail_send", "gmail.drafts.send"];

describe("tool-registry — no send-capable tool is registered", () => {
  it("ALL_TOOLS contains no tool whose name is a known send tool", () => {
    const registeredNames = ALL_TOOLS.map((t) => t.schema.name);
    for (const sendName of KNOWN_SEND_TOOL_NAMES) {
      expect(registeredNames).not.toContain(sendName);
    }
  });

  it("ALL_TOOLS contains no tool whose name pattern-matches a Gmail send", () => {
    // Defense against a future send tool with a new name: flag any tool
    // whose name reads like an email-send operation. Draft-only verbs
    // (search / get / thread) are fine; the pattern targets send/deliver/
    // dispatch verbs paired with mail/email/gmail.
    const sendLike = ALL_TOOLS.filter((t) => {
      const name = t.schema.name.toLowerCase();
      return (
        /(?:^|[._])send(?:$|[._])/.test(name) &&
        /(mail|gmail|message|email)/.test(name)
      );
    });
    expect(sendLike.map((t) => t.schema.name)).toEqual([]);
  });

  it("getToolByName cannot resolve gmail_send", () => {
    expect(getToolByName("gmail_send")).toBeUndefined();
  });
});
