import { describe, expect, it, vi } from "vitest";

// engineer-59 — entry gate for the agentic L2 tool-using loop. Read-only
// informational mail should fall through to the standard one-shot deep
// pass; reply-worthy mail (scheduling / RSVP / ambiguous ask) should
// invoke agentic L2.

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

import { shouldRunAgenticL2 } from "@/lib/agent/email/agentic-l2";

describe("shouldRunAgenticL2", () => {
  it("returns true for a scheduling ask in English", () => {
    expect(
      shouldRunAgenticL2({
        subject: "Quick meeting?",
        body: "Are you available next Tuesday at 3pm to talk?",
        riskConfidence: 0.9,
      })
    ).toBe(true);
  });

  it("returns true for an explicit question", () => {
    expect(
      shouldRunAgenticL2({
        subject: "Re: assignment 4",
        body: "Could you confirm the deadline is Friday?",
        riskConfidence: 0.95,
      })
    ).toBe(true);
  });

  it("returns true for a Japanese scheduling ask", () => {
    expect(
      shouldRunAgenticL2({
        subject: "面談のお願い",
        body: "今週の都合の良い時間を教えてください。",
        riskConfidence: 0.9,
      })
    ).toBe(true);
  });

  it("returns true when subject body contains question mark", () => {
    expect(
      shouldRunAgenticL2({
        subject: "Re: assignment",
        body: "Did you submit the form?",
        riskConfidence: 0.9,
      })
    ).toBe(true);
  });

  it("returns false for a read-only course announcement", () => {
    expect(
      shouldRunAgenticL2({
        subject: "CSC108 Lecture 3 notes posted",
        body: "Lecture 3 slides and recording are now available on Quercus. Reading: Chapter 4.",
        riskConfidence: 0.95,
      })
    ).toBe(false);
  });

  it("returns false for a system notification with no reply intent", () => {
    expect(
      shouldRunAgenticL2({
        subject: "Your transcript is ready",
        body: "Your official transcript has been generated and is available for download.",
        riskConfidence: 0.92,
      })
    ).toBe(false);
  });

  it("returns true on low risk-confidence even without reply markers", () => {
    expect(
      shouldRunAgenticL2({
        subject: "Update from your TA",
        body: "Just letting you know the answer is 42.",
        riskConfidence: 0.55,
      })
    ).toBe(true);
  });

  it("returns true when userClarification is present", () => {
    expect(
      shouldRunAgenticL2({
        subject: "FYI: schedule change",
        body: "The class on Monday has been canceled.",
        riskConfidence: 0.95,
        userClarification: "Confirm with the prof",
      })
    ).toBe(true);
  });

  it("ignores empty userClarification", () => {
    expect(
      shouldRunAgenticL2({
        subject: "FYI: schedule change",
        body: "The class on Monday has been canceled.",
        riskConfidence: 0.95,
        userClarification: "   ",
      })
    ).toBe(false);
  });
});
