import { describe, expect, it, vi } from "vitest";

// engineer-41 — agentic-l2 final-JSON parser. Pure-function tests over
// the schema-coerced output. The full loop integration test lives in
// agentic-l2-loop.test.ts.

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
  selectModel: () => "gpt-5.4",
}));
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async () => {},
}));
vi.mock("@/lib/agent/email/l2-tools", () => ({
  getL2ToolByName: () => undefined,
  l2OpenAIToolDefs: () => [],
}));

import { parseFinalJson } from "@/lib/agent/email/agentic-l2";

describe("parseFinalJson", () => {
  it("parses a well-formed final pass", () => {
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "Inferred JST from body; calendar shows free at 10am.",
      actionItems: [
        {
          title: "Confirm interview slot",
          dueDate: "2026-05-14",
          confidence: 0.9,
        },
      ],
      confirmationsQueued: [],
      availabilityChecksRan: ["2026-05-15T01:00:00Z"],
      inferredFacts: [
        {
          topic: "timezone",
          value: "Asia/Tokyo",
          confidence: 0.85,
          source: "llm_body_analysis",
        },
      ],
      schedulingDetected: true,
    });
    const out = parseFinalJson(raw);
    expect(out).not.toBeNull();
    expect(out?.action).toBe("draft_reply");
    expect(out?.actionItems).toHaveLength(1);
    expect(out?.inferredFacts).toHaveLength(1);
    expect(out?.inferredFacts[0].topic).toBe("timezone");
    expect(out?.schedulingDetected).toBe(true);
  });

  it("defaults to ask_clarifying when action is unrecognised", () => {
    const raw = JSON.stringify({
      action: "do_something_weird",
      reasoning: "x",
      actionItems: [],
      confirmationsQueued: [],
      availabilityChecksRan: [],
      inferredFacts: [],
      schedulingDetected: false,
    });
    expect(parseFinalJson(raw)?.action).toBe("ask_clarifying");
  });

  it("returns null on malformed JSON", () => {
    expect(parseFinalJson("not json")).toBeNull();
  });

  it("clamps inferredFacts confidence and drops empty entries", () => {
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "x",
      actionItems: [],
      confirmationsQueued: [],
      availabilityChecksRan: [],
      inferredFacts: [
        { topic: "timezone", value: "Asia/Tokyo", confidence: 1.5, source: "x" },
        { topic: "", value: "Asia/Tokyo", confidence: 0.5, source: "x" },
        { topic: "timezone", value: "", confidence: 0.5, source: "x" },
      ],
      schedulingDetected: false,
    });
    const out = parseFinalJson(raw);
    expect(out?.inferredFacts).toHaveLength(1);
    expect(out?.inferredFacts[0].confidence).toBe(1);
  });
});
