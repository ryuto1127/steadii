import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// engineer-41 — detect_ambiguity parser tests. Pure parser only;
// the LLM call itself is integration-only.

const openaiUserMsgs: string[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async (args: {
          messages: Array<{ role: string; content: string }>;
        }) => {
          openaiUserMsgs.push(
            args.messages.find((m) => m.role === "user")?.content ?? ""
          );
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    ambiguous: true,
                    suggestedQuestion: "テスト",
                    rationale: "x",
                  }),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          };
        },
      },
    },
  }),
}));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usd: 0, credits: 0, usageId: null }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4-mini",
}));

import {
  parseDetectAmbiguityOutput,
  detectAmbiguityTool,
} from "@/lib/agent/email/l2-tools/detect-ambiguity";

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

describe("detect_ambiguity — confirmation-question locale", () => {
  it("emits the question-language header from ctx.locale", async () => {
    openaiUserMsgs.length = 0;
    await detectAmbiguityTool.execute(
      { userId: "u1", inboxItemId: "i1", locale: "ja" },
      { context: "scheduling slot", decision: "pick slot 2", confidence: 0.6 }
    );
    expect(openaiUserMsgs[0]).toContain("Question language: ja");
  });

  it("defaults the question-language header to en when locale is omitted", async () => {
    openaiUserMsgs.length = 0;
    await detectAmbiguityTool.execute(
      { userId: "u1", inboxItemId: "i1" },
      { context: "scheduling slot", decision: "pick slot 2", confidence: 0.6 }
    );
    expect(openaiUserMsgs[0]).toContain("Question language: en");
  });

  it("prompt no longer hard-codes the suggested question to English", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/agent/email/l2-tools/detect-ambiguity.ts"),
      "utf-8"
    );
    expect(src).not.toMatch(/user-friendly language, English\./);
    expect(src).toMatch(/in the user's app locale per the "Question language"/);
  });

  it("agentic-l2 prompt instructs the L2 agent to author the question in the user's locale", () => {
    const src = readFileSync(
      join(process.cwd(), "lib/agent/email/agentic-l2-prompt.ts"),
      "utf-8"
    );
    expect(src).toMatch(
      /"question" you pass is shown to the student VERBATIM, so it MUST be written in the student's app locale/
    );
  });
});
