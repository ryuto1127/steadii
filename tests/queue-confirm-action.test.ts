import { describe, expect, it, vi } from "vitest";

// engineer-42 — Type F confirm/correct server actions write user-resolved
// values back into agent_contact_personas.structured_facts. The critical
// invariants live in `applyUserConfirmedFact` (pure merge) and
// `normalizeStructuredFactKey` (topic → typed key mapping). The full
// server-action plumbing is intentionally untested here — those branches
// are auth + drizzle chains and are exercised end-to-end via the smoke
// flow in the verification screenshots.

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

import {
  applyUserConfirmedFact,
  normalizeStructuredFactKey,
} from "@/lib/agent/queue/confirmation-fact-merge";
import type {
  ContactStructuredFacts,
  StructuredFactEntry,
} from "@/lib/db/schema";

describe("normalizeStructuredFactKey", () => {
  it("maps the three typed structured topics", () => {
    expect(normalizeStructuredFactKey("timezone")).toBe("timezone");
    expect(normalizeStructuredFactKey("primary_language")).toBe(
      "primary_language"
    );
    expect(normalizeStructuredFactKey("language_preference")).toBe(
      "primary_language"
    );
    expect(normalizeStructuredFactKey("response_window_hours")).toBe(
      "response_window_hours"
    );
  });

  it("returns null for non-structured topics", () => {
    // sender_role / relationship / "other" / arbitrary L2 strings land
    // on the free-form facts[] array via the L2 persona learner, NOT on
    // structured_facts — so the confirm action should skip the persona
    // write entirely and only flip the confirmation status.
    expect(normalizeStructuredFactKey("sender_role")).toBeNull();
    expect(normalizeStructuredFactKey("relationship")).toBeNull();
    expect(normalizeStructuredFactKey("other")).toBeNull();
    expect(normalizeStructuredFactKey("meeting_format")).toBeNull();
  });
});

describe("applyUserConfirmedFact", () => {
  it("writes the value at confidence 1.0 / source user_confirmed", () => {
    const merged = applyUserConfirmedFact({}, "timezone", "JST");
    const entry = merged.timezone as StructuredFactEntry<string>;
    expect(entry.value).toBe("JST");
    expect(entry.confidence).toBe(1.0);
    expect(entry.source).toBe("user_confirmed");
    expect(entry.confirmedAt).not.toBeNull();
  });

  it("does not clobber sibling structured keys (persona upsert contract)", () => {
    // engineer-42 spec: the confirm path reads the existing blob, sets
    // the targeted key, writes back — never overwrites unrelated facts.
    // Verified incident-pattern: if the merge were a plain replace, a
    // timezone confirm would erase a previously-confirmed primary_language.
    const existing: ContactStructuredFacts = {
      primary_language: {
        value: "ja",
        confidence: 0.8,
        source: "llm_body_analysis",
        samples: 5,
        confirmedAt: null,
      },
    };
    const merged = applyUserConfirmedFact(existing, "timezone", "JST");
    expect(merged.timezone?.value).toBe("JST");
    expect(merged.primary_language?.value).toBe("ja");
    expect(merged.primary_language?.confidence).toBe(0.8);
    // Pre-existing entry should be byte-for-byte intact.
    expect(merged.primary_language).toEqual(existing.primary_language);
  });

  it("overwrites the same key if the user re-corrects it later", () => {
    const existing: ContactStructuredFacts = {
      timezone: {
        value: "PST",
        confidence: 1.0,
        source: "user_confirmed",
        samples: 0,
        confirmedAt: "2026-04-01T00:00:00Z",
      },
    };
    const merged = applyUserConfirmedFact(existing, "timezone", "EST");
    expect(merged.timezone?.value).toBe("EST");
    expect(merged.timezone?.source).toBe("user_confirmed");
  });

  it("stamps the supplied nowIso string when provided (deterministic test)", () => {
    const merged = applyUserConfirmedFact(
      {},
      "primary_language",
      "en",
      "2026-05-11T12:00:00.000Z"
    );
    expect(merged.primary_language?.confirmedAt).toBe(
      "2026-05-11T12:00:00.000Z"
    );
  });
});
