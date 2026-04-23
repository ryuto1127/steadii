import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiCalls: Array<{
  model: string;
  messages: Array<{ role: string; content: string }>;
}> = [];
let stubbedResponse: unknown = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          risk_tier: "high",
          confidence: 0.9,
          reasoning: "Sender is a first-time admissions officer.",
        }),
      },
    },
  ],
  usage: { prompt_tokens: 800, completion_tokens: 80 },
};

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async (args: {
          model: string;
          messages: Array<{ role: string; content: string }>;
        }) => {
          openaiCalls.push({ model: args.model, messages: args.messages });
          return stubbedResponse as unknown;
        },
      },
    },
  }),
}));

const usageCalls: Array<{ taskType: string; userId: string }> = [];
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async (r: { taskType: string; userId: string }) => {
    usageCalls.push(r);
    return { usd: 0.001, credits: 0, usageId: `usage-${usageCalls.length}` };
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

beforeEach(() => {
  openaiCalls.length = 0;
  usageCalls.length = 0;
});

describe("runRiskPass (L2 Mini classify)", () => {
  it("returns the high tier and records email_classify_risk usage", async () => {
    const { runRiskPass } = await import("@/lib/agent/email/classify-risk");
    const out = await runRiskPass({
      userId: "u1",
      senderEmail: "admissions@grad.example",
      senderDomain: "grad.example",
      senderRole: null,
      subject: "Offer of admission",
      snippet: "Congratulations, we would like to offer...",
      firstTimeSender: true,
    });
    expect(out.riskTier).toBe("high");
    expect(out.confidence).toBeCloseTo(0.9);
    expect(out.reasoning).toContain("admissions");
    expect(usageCalls[0].taskType).toBe("email_classify_risk");
    expect(out.usageId).toBe("usage-1");
  });

  it("includes first-time-sender flag and sender role in the user prompt", async () => {
    const { runRiskPass } = await import("@/lib/agent/email/classify-risk");
    await runRiskPass({
      userId: "u1",
      senderEmail: "p@dept.edu",
      senderDomain: "dept.edu",
      senderRole: "professor",
      subject: "Re: midterm",
      snippet: "see you in OH",
      firstTimeSender: false,
    });
    const userMsg = openaiCalls[0].messages.find((m) => m.role === "user")!.content;
    expect(userMsg).toContain("professor");
    expect(userMsg).not.toContain("First-time sender");
  });

  it("parseRiskPassOutput defaults to medium on malformed JSON", async () => {
    const { parseRiskPassOutput } = await import(
      "@/lib/agent/email/classify-risk"
    );
    const out = parseRiskPassOutput("not json at all");
    expect(out.riskTier).toBe("medium");
    expect(out.confidence).toBe(0.5);
    expect(out.reasoning).toMatch(/default/i);
  });

  it("clamps bad tier enum values to medium (safety-biased fallback)", async () => {
    const { parseRiskPassOutput } = await import(
      "@/lib/agent/email/classify-risk"
    );
    const out = parseRiskPassOutput(
      JSON.stringify({ risk_tier: "extreme", confidence: 2, reasoning: "x" })
    );
    expect(out.riskTier).toBe("medium");
    // confidence out-of-range also normalizes
    expect(out.confidence).toBe(0.5);
  });

  it("passes through low/medium/high values correctly", async () => {
    const { parseRiskPassOutput } = await import(
      "@/lib/agent/email/classify-risk"
    );
    for (const tier of ["low", "medium", "high"] as const) {
      const out = parseRiskPassOutput(
        JSON.stringify({ risk_tier: tier, confidence: 0.3, reasoning: "x" })
      );
      expect(out.riskTier).toBe(tier);
      expect(out.confidence).toBeCloseTo(0.3);
    }
  });
});
