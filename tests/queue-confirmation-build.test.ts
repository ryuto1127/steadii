import { describe, expect, it, vi } from "vitest";

// engineer-42 — Type F queue cards: verify the pure mapping from
// `agent_confirmations` row → QueueCardF, plus the topic normalization
// that maps L2 tool free-form topic strings into the typed union.

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "test",
    AUTH_GOOGLE_ID: "test",
    AUTH_GOOGLE_SECRET: "test",
    NOTION_CLIENT_ID: "test",
    NOTION_CLIENT_SECRET: "test",
    OPENAI_API_KEY: "test",
    STRIPE_SECRET_KEY: "test",
    STRIPE_PRICE_ID_PRO: "test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

import {
  confirmationToTypeF,
  normalizeConfirmationTopic,
} from "@/lib/agent/queue/build";
import type { AgentConfirmation } from "@/lib/db/schema";

function fakeRow(over: Partial<AgentConfirmation> = {}): AgentConfirmation {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "u1",
    topic: "timezone",
    senderEmail: "prof@example.edu",
    question: "Prof is in JST?",
    inferredValue: "JST",
    options: null,
    status: "pending",
    resolvedValue: null,
    resolvedAt: null,
    originatingDraftId: null,
    context: null,
    createdAt: new Date("2026-05-11T12:00:00Z"),
    updatedAt: new Date("2026-05-11T12:00:00Z"),
    ...over,
  };
}

describe("normalizeConfirmationTopic", () => {
  it("maps known topics 1:1", () => {
    expect(normalizeConfirmationTopic("timezone")).toBe("timezone");
    expect(normalizeConfirmationTopic("sender_role")).toBe("sender_role");
    expect(normalizeConfirmationTopic("primary_language")).toBe(
      "primary_language"
    );
    expect(normalizeConfirmationTopic("relationship")).toBe("relationship");
    expect(normalizeConfirmationTopic("other")).toBe("other");
  });

  it("aliases 'language_preference' (L2 tool name) → primary_language", () => {
    // The L2 tool schema lists `language_preference` as the canonical
    // topic key; the persona structured_facts blob calls the same fact
    // `primary_language`. The normalizer collapses the two so the queue
    // card and downstream persona writer see one identifier.
    expect(normalizeConfirmationTopic("language_preference")).toBe(
      "primary_language"
    );
  });

  it("falls back to 'other' for unknown topics", () => {
    expect(normalizeConfirmationTopic("meeting_format")).toBe("other");
    expect(normalizeConfirmationTopic("")).toBe("other");
  });
});

describe("confirmationToTypeF", () => {
  it("produces a Type F card with the canonical id prefix", () => {
    const card = confirmationToTypeF(
      fakeRow({ id: "11111111-1111-1111-1111-111111111111" })
    );
    expect(card.archetype).toBe("F");
    expect(card.id).toBe(
      "confirmation:11111111-1111-1111-1111-111111111111"
    );
  });

  it("carries the question into title and inferredValue into body", () => {
    const card = confirmationToTypeF(
      fakeRow({
        question: "Prof Tanaka is in JST?",
        inferredValue: "JST",
        senderEmail: "tanaka@u-tokyo.ac.jp",
      })
    );
    expect(card.title).toBe("Prof Tanaka is in JST?");
    expect(card.body).toContain("JST");
    expect(card.body).toContain("tanaka@u-tokyo.ac.jp");
  });

  it("exposes confirm / correct / dismiss options", () => {
    const card = confirmationToTypeF(fakeRow());
    expect(card.options).toHaveLength(3);
    const types = card.options.map((o) => o.type);
    expect(types).toContain("confirm");
    expect(types).toContain("correct");
    expect(types).toContain("dismiss");
  });

  it("normalizes free-form L2 topic strings", () => {
    const card = confirmationToTypeF(
      fakeRow({ topic: "language_preference" })
    );
    expect(card.topic).toBe("primary_language");
  });

  it("forwards null inferredValue and senderEmail without crashing", () => {
    const card = confirmationToTypeF(
      fakeRow({ inferredValue: null, senderEmail: null })
    );
    expect(card.inferredValue).toBeNull();
    expect(card.senderEmail).toBeNull();
    // Body collapses to empty when neither piece of context is present.
    expect(card.body).toBe("");
  });

  it("propagates originatingDraftId for the deep-link", () => {
    const card = confirmationToTypeF(
      fakeRow({ originatingDraftId: "22222222-2222-2222-2222-222222222222" })
    );
    expect(card.originatingDraftId).toBe(
      "22222222-2222-2222-2222-222222222222"
    );
  });
});
