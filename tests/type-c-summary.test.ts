import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({ chat: { completions: { create: vi.fn() } } }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "test-model",
}));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usageId: "usage-1" }),
}));

import {
  parseDeepPassOutput,
  SHORT_SUMMARY_MAX_LEN,
} from "@/lib/agent/email/classify-deep";

describe("parseDeepPassOutput — shortSummary (engineer-43)", () => {
  it("returns the summary when action is notify_only and string non-empty", () => {
    const raw = JSON.stringify({
      action: "notify_only",
      reasoning: "FYI from the registrar.",
      actionItems: [],
      shortSummary: "Fall 2026 MAT223 grade posted to ACORN — A−.",
    });
    const parsed = parseDeepPassOutput(raw);
    expect(parsed.shortSummary).toBe(
      "Fall 2026 MAT223 grade posted to ACORN — A−."
    );
  });

  it("returns null when action is draft_reply even if model emits a summary", () => {
    const raw = JSON.stringify({
      action: "draft_reply",
      reasoning: "Reply needed.",
      actionItems: [],
      shortSummary: "Some leaked summary that shouldn't surface.",
    });
    expect(parseDeepPassOutput(raw).shortSummary).toBeNull();
  });

  it("returns null when shortSummary is missing entirely", () => {
    const raw = JSON.stringify({
      action: "notify_only",
      reasoning: "FYI.",
      actionItems: [],
    });
    expect(parseDeepPassOutput(raw).shortSummary).toBeNull();
  });

  it("returns null when shortSummary is an empty / whitespace string", () => {
    const raw = JSON.stringify({
      action: "notify_only",
      reasoning: "FYI.",
      actionItems: [],
      shortSummary: "   ",
    });
    expect(parseDeepPassOutput(raw).shortSummary).toBeNull();
  });

  it("caps shortSummary at SHORT_SUMMARY_MAX_LEN (280) chars", () => {
    const long = "x".repeat(SHORT_SUMMARY_MAX_LEN + 50);
    const raw = JSON.stringify({
      action: "notify_only",
      reasoning: "FYI.",
      actionItems: [],
      shortSummary: long,
    });
    const parsed = parseDeepPassOutput(raw);
    expect(parsed.shortSummary).not.toBeNull();
    expect(parsed.shortSummary!.length).toBe(SHORT_SUMMARY_MAX_LEN);
  });
});
