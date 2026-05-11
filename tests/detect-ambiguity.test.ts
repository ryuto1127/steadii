import { describe, expect, it, vi } from "vitest";

// engineer-41 — detect_ambiguity parser tests. Pure parser only;
// the LLM call itself is integration-only.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/integrations/openai/client", () => ({ openai: () => ({}) }));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usd: 0, credits: 0, usageId: null }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4-mini",
}));

import { parseDetectAmbiguityOutput } from "@/lib/agent/email/l2-tools/detect-ambiguity";

describe("parseDetectAmbiguityOutput", () => {
  it("returns ambiguous=true with the suggested question", () => {
    const raw = JSON.stringify({
      ambiguous: true,
      suggestedQuestion: "Is this contact in JST?",
      rationale: "Body mentions a time without a timezone.",
    });
    const out = parseDetectAmbiguityOutput(raw);
    expect(out.ambiguous).toBe(true);
    expect(out.suggestedQuestion).toBe("Is this contact in JST?");
  });

  it("returns ambiguous=false when the agent is confident", () => {
    const raw = JSON.stringify({
      ambiguous: false,
      suggestedQuestion: null,
      rationale: "Explicit JST marker in body.",
    });
    const out = parseDetectAmbiguityOutput(raw);
    expect(out.ambiguous).toBe(false);
    expect(out.suggestedQuestion).toBeNull();
  });

  it("trims an over-long suggested question", () => {
    const raw = JSON.stringify({
      ambiguous: true,
      suggestedQuestion: "x".repeat(800),
      rationale: "",
    });
    const out = parseDetectAmbiguityOutput(raw);
    expect(out.suggestedQuestion?.length).toBeLessThanOrEqual(500);
  });

  it("returns a safe default on malformed JSON", () => {
    const out = parseDetectAmbiguityOutput("not json");
    expect(out.ambiguous).toBe(false);
    expect(out.suggestedQuestion).toBeNull();
  });
});
