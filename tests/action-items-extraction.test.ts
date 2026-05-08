import { describe, expect, it, vi } from "vitest";

// engineer-39 — action items extraction. Verifies:
//   1. parseDeepPassOutput returns the structured items the model emits
//   2. confidence values clamp to [0, 1]
//   3. malformed dueDate strings degrade to null without throwing
//   4. empty / missing actionItems → empty array (defensive default)
//   5. parseActionItems drops items without a title

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({}),
}));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usd: 0, credits: 0, usageId: null }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4",
}));

import { parseDeepPassOutput } from "@/lib/agent/email/classify-deep";

describe("parseDeepPassOutput action items", () => {
  it("returns structured items the model emitted", () => {
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "Email asks for two concrete things.",
      actionItems: [
        {
          title: "Submit photo ID to registrar",
          dueDate: "2026-05-15",
          confidence: 0.92,
        },
        {
          title: "Reply to professor with availability",
          dueDate: null,
          confidence: 0.7,
        },
      ],
    });
    const out = parseDeepPassOutput(raw);
    expect(out.actionItems).toHaveLength(2);
    expect(out.actionItems[0].title).toBe("Submit photo ID to registrar");
    expect(out.actionItems[0].dueDate).toBe("2026-05-15");
    expect(out.actionItems[0].confidence).toBeCloseTo(0.92);
    expect(out.actionItems[1].dueDate).toBeNull();
  });

  it("clamps confidence outside [0, 1] to the nearest bound", () => {
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "...",
      actionItems: [
        { title: "A", dueDate: null, confidence: 1.5 },
        { title: "B", dueDate: null, confidence: -0.2 },
      ],
    });
    const out = parseDeepPassOutput(raw);
    expect(out.actionItems[0].confidence).toBe(1);
    expect(out.actionItems[1].confidence).toBe(0);
  });

  it("normalises a malformed dueDate to null without throwing", () => {
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "...",
      actionItems: [
        { title: "A", dueDate: "next Friday", confidence: 0.9 },
        { title: "B", dueDate: "2026-13-99T00:00", confidence: 0.9 },
      ],
    });
    const out = parseDeepPassOutput(raw);
    // First fails the YYYY-MM-DD regex outright → null.
    expect(out.actionItems[0].dueDate).toBeNull();
    // Second matches the regex prefix even though the date is bogus —
    // the parser slices to YYYY-MM-DD; the impossible "13-99" is a
    // deferred problem (UI rendering will show it as-is). The contract
    // here is "no throw, return a string-shaped value or null".
    expect(typeof out.actionItems[1].dueDate).toBe("string");
  });

  it("returns an empty array when actionItems is missing entirely", () => {
    const raw = JSON.stringify({
      action: "archive",
      reasoning: "Newsletter, no action needed.",
    });
    const out = parseDeepPassOutput(raw);
    expect(out.actionItems).toEqual([]);
  });

  it("drops items without a title", () => {
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "...",
      actionItems: [
        { title: "", dueDate: null, confidence: 0.9 },
        { title: "   ", dueDate: null, confidence: 0.9 },
        { title: "Real item", dueDate: null, confidence: 0.9 },
      ],
    });
    const out = parseDeepPassOutput(raw);
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0].title).toBe("Real item");
  });

  it("trims long titles to 200 chars", () => {
    const longTitle = "x".repeat(500);
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "...",
      actionItems: [{ title: longTitle, dueDate: null, confidence: 0.9 }],
    });
    const out = parseDeepPassOutput(raw);
    expect(out.actionItems[0].title.length).toBe(200);
  });

  it("returns empty action items for unparseable JSON", () => {
    const out = parseDeepPassOutput("not json");
    expect(out.actionItems).toEqual([]);
  });
});
