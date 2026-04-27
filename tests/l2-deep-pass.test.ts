import { beforeEach, describe, expect, it, vi } from "vitest";

let stubbed: unknown = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          action: "draft_reply",
          reasoning:
            "Prior similar thread 'Re: midterm grade' shows user usually replies directly.",
        }),
      },
    },
  ],
  usage: { prompt_tokens: 4500, completion_tokens: 700 },
};

const openaiCalls: Array<{ model: string; userPrompt: string }> = [];
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async (args: {
          model: string;
          messages: Array<{ role: string; content: string }>;
        }) => {
          openaiCalls.push({
            model: args.model,
            userPrompt:
              args.messages.find((m) => m.role === "user")?.content ?? "",
          });
          return stubbed as unknown;
        },
      },
    },
  }),
}));

vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({
    usd: 0.02,
    credits: 4,
    usageId: "usage-deep-1",
  }),
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));

beforeEach(() => {
  openaiCalls.length = 0;
});

describe("runDeepPass", () => {
  it("returns action + reasoning + provenance", async () => {
    const { runDeepPass } = await import("@/lib/agent/email/classify-deep");
    const out = await runDeepPass({
      userId: "u1",
      senderEmail: "prof@x.edu",
      senderDomain: "x.edu",
      senderRole: "professor",
      subject: "Final grade question",
      snippet: "I wanted to check my final grade",
      bodySnippet: "I think there's been an error in my grading, could you check?",
      riskPass: {
        riskTier: "high",
        confidence: 0.95,
        reasoning: "Grade appeal keyword matched.",
        usageId: "usage-risk-1",
      },
      similarEmails: [
        {
          inboxItemId: "prior-1",
          similarity: 0.87,
          subject: "Re: midterm grade",
          snippet: "Thanks for explaining",
          receivedAt: new Date("2026-03-10"),
          senderEmail: "prof@x.edu",
        },
        {
          inboxItemId: "prior-2",
          similarity: 0.71,
          subject: "Re: quiz score",
          snippet: "Noted.",
          receivedAt: new Date("2026-02-01"),
          senderEmail: "ta@x.edu",
        },
      ],
      totalCandidates: 24,
      threadRecentMessages: [],
    });
    expect(out.action).toBe("draft_reply");
    expect(out.reasoning).toContain("midterm grade");
    expect(out.retrievalProvenance.sources).toHaveLength(2);
    expect(out.retrievalProvenance.total_candidates).toBe(24);
    expect(out.retrievalProvenance.returned).toBe(2);
    expect(out.retrievalProvenance.sources[0]?.id).toBe("prior-1");
    const first = out.retrievalProvenance.sources[0];
    if (first?.type === "email") {
      expect(first.similarity).toBeCloseTo(0.87);
    } else {
      throw new Error("expected first source to be type=email");
    }
    expect(out.usageId).toBe("usage-deep-1");
  });

  it("includes retrieved emails in the user prompt", async () => {
    const { runDeepPass } = await import("@/lib/agent/email/classify-deep");
    await runDeepPass({
      userId: "u1",
      senderEmail: "prof@x.edu",
      senderDomain: "x.edu",
      senderRole: "professor",
      subject: "hi",
      snippet: "",
      bodySnippet: "",
      riskPass: {
        riskTier: "high",
        confidence: 0.9,
        reasoning: "...",
        usageId: null,
      },
      similarEmails: [
        {
          inboxItemId: "xyz",
          similarity: 0.8,
          subject: "Same subject",
          snippet: "prior content",
          receivedAt: new Date(),
          senderEmail: "prof@x.edu",
        },
      ],
      totalCandidates: 1,
      threadRecentMessages: [
        { sender: "me@example", snippet: "my earlier message" },
      ],
    });
    const prompt = openaiCalls[0].userPrompt;
    expect(prompt).toContain("Same subject");
    expect(prompt).toContain("my earlier message");
    expect(prompt).toContain("top 1 of 1");
  });

  it("parseDeepPassOutput falls back to ask_clarifying on bad JSON", async () => {
    const { parseDeepPassOutput } = await import(
      "@/lib/agent/email/classify-deep"
    );
    const out = parseDeepPassOutput("garbage");
    expect(out.action).toBe("ask_clarifying");
    expect(out.reasoning).toMatch(/unparseable|deferring/i);
  });

  // polish-7 — the 2-category triage adds notify_only as a valid
  // model output. parseDeepPassOutput must accept it without
  // downgrading to the safety default (ask_clarifying).
  it("parseDeepPassOutput accepts notify_only", async () => {
    const { parseDeepPassOutput } = await import(
      "@/lib/agent/email/classify-deep"
    );
    const out = parseDeepPassOutput(
      JSON.stringify({
        action: "notify_only",
        reasoning: "Grade posted, no reply expected.",
      })
    );
    expect(out.action).toBe("notify_only");
    expect(out.reasoning).toContain("Grade posted");
  });

  // polish-7 — the recent-feedback prompt block. When non-null and
  // non-empty, the deep pass should inject a "Recent feedback" header
  // plus per-row counts. When null/empty, the prompt shape stays
  // identical to the pre-polish-7 build (no header at all).
  it("includes a recent-feedback block when summary rows exist", async () => {
    const { runDeepPass } = await import("@/lib/agent/email/classify-deep");
    await runDeepPass({
      userId: "u1",
      senderEmail: "registrar@x.edu",
      senderDomain: "x.edu",
      senderRole: null,
      subject: "Grade posted",
      snippet: "Your grade has been recorded.",
      bodySnippet: "Your grade has been recorded.",
      riskPass: {
        riskTier: "high",
        confidence: 0.9,
        reasoning: "Grade keyword.",
        usageId: null,
      },
      similarEmails: [],
      totalCandidates: 0,
      threadRecentMessages: [],
      recentFeedback: {
        scope: "sender",
        proposedCounts: {
          draft_reply: { dismissed: 3 },
          notify_only: { dismissed: 1 },
        },
        windowDays: 30,
        totalRows: 4,
      },
    });
    const prompt = openaiCalls.at(-1)!.userPrompt;
    expect(prompt).toContain("Recent feedback");
    expect(prompt).toContain("3× the agent proposed draft_reply");
    expect(prompt).toContain("revealed preference");
  });

  it("omits the feedback block when summary is null", async () => {
    const { runDeepPass } = await import("@/lib/agent/email/classify-deep");
    await runDeepPass({
      userId: "u1",
      senderEmail: "x@y.com",
      senderDomain: "y.com",
      senderRole: null,
      subject: "hi",
      snippet: "",
      bodySnippet: "",
      riskPass: {
        riskTier: "high",
        confidence: 0.5,
        reasoning: "x",
        usageId: null,
      },
      similarEmails: [],
      totalCandidates: 0,
      threadRecentMessages: [],
      recentFeedback: null,
    });
    const prompt = openaiCalls.at(-1)!.userPrompt;
    expect(prompt).not.toContain("Recent feedback");
  });

  it("buildProvenance snippet capped at 200 chars", async () => {
    const { buildProvenance } = await import(
      "@/lib/agent/email/classify-deep"
    );
    const long = "a".repeat(500);
    const prov = buildProvenance({
      similarEmails: [
        {
          inboxItemId: "x",
          similarity: 0.5,
          subject: null,
          snippet: long,
          receivedAt: new Date(),
          senderEmail: "y@z.com",
        },
      ],
      totalCandidates: 1,
    });
    const first = prov.sources[0];
    if (first?.type === "email") {
      expect(first.snippet.length).toBe(200);
    } else {
      throw new Error("expected first source to be type=email");
    }
  });
});
