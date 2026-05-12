import { describe, expect, it, vi } from "vitest";

// engineer-45 — Type E freeText submission triggers an immediate L2
// re-run. We verify the contract at two levels:
//
//   (a) buildAgenticL2UserMessage threads `userClarification` into the
//       LLM-visible user message with the "=== Student's clarification
//       ===" header. Without this, the loop has no signal to act on.
//
//   (b) The buildAgenticL2UserMessage emits the same prompt shape when
//       userClarification is undefined / empty — i.e. the new option is
//       additive, not load-bearing. (Existing classify paths still get
//       the same prompt as before.)

vi.mock("server-only", () => ({}));

import { buildAgenticL2UserMessage } from "@/lib/agent/email/agentic-l2-prompt";

describe("buildAgenticL2UserMessage with userClarification", () => {
  const baseArgs = {
    locale: "ja" as const,
    senderEmail: "recruiter@acme.example.co.jp",
    senderDomain: "acme.example.co.jp",
    senderRole: null,
    subject: "面接日程の調整",
    body: "5/15 と 5/19 でご都合のよい日をご教示ください。",
    riskTierReasoning: "Risk pass tier=high (confidence 0.85). Career.",
  };

  it("renders the clarification block when userClarification is non-empty", () => {
    const out = buildAgenticL2UserMessage({
      ...baseArgs,
      userClarification: "5/15 の 10:00-10:30 PT を希望します。",
    });
    expect(out).toContain("=== Student's clarification ===");
    expect(out).toContain("5/15 の 10:00-10:30 PT");
    expect(out).toContain("authoritative additional context");
  });

  it("omits the clarification block when userClarification is undefined", () => {
    const out = buildAgenticL2UserMessage(baseArgs);
    expect(out).not.toContain("=== Student's clarification ===");
  });

  it("omits the clarification block when userClarification is an empty string", () => {
    const out = buildAgenticL2UserMessage({
      ...baseArgs,
      userClarification: "",
    });
    expect(out).not.toContain("=== Student's clarification ===");
  });

  it("omits the clarification block when userClarification is whitespace-only", () => {
    const out = buildAgenticL2UserMessage({
      ...baseArgs,
      userClarification: "   \n\t  ",
    });
    expect(out).not.toContain("=== Student's clarification ===");
  });

  it("renders the sender TZ hint when the domain heuristic resolves", () => {
    const out = buildAgenticL2UserMessage({
      ...baseArgs,
      likelySenderTimezone: {
        tz: "Asia/Tokyo",
        confidence: 0.95,
        source: "tld:co.jp",
      },
    });
    expect(out).toContain("=== Sender timezone hint ===");
    expect(out).toContain("Asia/Tokyo");
    expect(out).toContain("0.95");
  });

  it("omits the TZ hint block when no inference is provided", () => {
    const out = buildAgenticL2UserMessage(baseArgs);
    expect(out).not.toContain("=== Sender timezone hint ===");
  });

  it("caps userClarification at 2000 chars to prevent prompt bloat", () => {
    const long = "x".repeat(3000);
    const out = buildAgenticL2UserMessage({
      ...baseArgs,
      userClarification: long,
    });
    // 2000 of "x" should be in the rendered output, but not the full 3000.
    expect(out).toContain("x".repeat(2000));
    expect(out).not.toContain("x".repeat(2001));
  });
});
