import { describe, expect, it, vi } from "vitest";

// Short-circuit "server-only" + the openai client so importing the
// module under test doesn't trip lib/env.ts validation. The module's
// LLM call accepts a dependency-injected runner; tests substitute a
// fake runner so no real OpenAI call ever happens.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => {
    throw new Error(
      "openai() should not be called in this test — pass an injected runner",
    );
  },
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4-nano",
}));

import {
  buildIntentLLMUserPrompt,
  classifyWithLLMIfNeeded,
  parseLLMResponse,
  REGEX_TRUST_THRESHOLD,
  runIntentLLMClassification,
  type IntentLLMRunner,
} from "@/lib/agent/intent-classifier-llm";
import type {
  IntentClassification,
  IntentClassificationContext,
} from "@/lib/agent/intent-classifier";

describe("REGEX_TRUST_THRESHOLD", () => {
  it("is exposed as a numeric threshold in [0, 1]", () => {
    expect(typeof REGEX_TRUST_THRESHOLD).toBe("number");
    expect(REGEX_TRUST_THRESHOLD).toBeGreaterThan(0);
    expect(REGEX_TRUST_THRESHOLD).toBeLessThanOrEqual(1);
  });
});

describe("parseLLMResponse", () => {
  it("parses well-formed JSON", () => {
    const r = parseLLMResponse(
      JSON.stringify({
        intent: "DRAFT_EMAIL_REPLY",
        confidence: 0.85,
        reasoning: "title names a sender + reply verb",
      }),
    );
    expect(r.intent).toBe("DRAFT_EMAIL_REPLY");
    expect(r.confidence).toBeCloseTo(0.85);
    expect(r.reasoning).toMatch(/sender/);
  });

  it("falls back to OTHER for malformed JSON", () => {
    const r = parseLLMResponse("not json at all");
    expect(r.intent).toBe("OTHER");
    expect(r.confidence).toBe(0);
    expect(r.reasoning).toBe("");
  });

  it("falls back to OTHER for an unknown intent value", () => {
    const r = parseLLMResponse(
      JSON.stringify({ intent: "FOO_BAR", confidence: 0.9, reasoning: "x" }),
    );
    expect(r.intent).toBe("OTHER");
  });

  it("clamps confidence above 1 down to 1", () => {
    const r = parseLLMResponse(
      JSON.stringify({
        intent: "CALENDAR_EVENT",
        confidence: 2.5,
        reasoning: "x",
      }),
    );
    expect(r.confidence).toBe(1);
  });

  it("clamps negative confidence to 0", () => {
    const r = parseLLMResponse(
      JSON.stringify({
        intent: "STUDY_SESSION",
        confidence: -0.4,
        reasoning: "x",
      }),
    );
    expect(r.confidence).toBe(0);
  });

  it("truncates reasoning > 200 chars", () => {
    const long = "a".repeat(500);
    const r = parseLLMResponse(
      JSON.stringify({
        intent: "OTHER",
        confidence: 0.1,
        reasoning: long,
      }),
    );
    expect(r.reasoning.length).toBe(200);
  });
});

describe("buildIntentLLMUserPrompt", () => {
  it("includes the task title verbatim", () => {
    const p = buildIntentLLMUserPrompt("Reply to Sample Corp", {});
    expect(p).toContain("Reply to Sample Corp");
  });

  it("appends known entities when provided", () => {
    const ctx: IntentClassificationContext = {
      knownEntities: [
        { id: "e1", displayName: "Sample Corp", aliases: ["サンプル"] },
        { id: "e2", displayName: "Acme Travel", aliases: [] },
      ],
    };
    const p = buildIntentLLMUserPrompt("Reply to サンプル", ctx);
    expect(p).toMatch(/Known entities: /);
    expect(p).toContain("Sample Corp");
    expect(p).toContain("Acme Travel");
    expect(p).toContain("サンプル");
  });

  it("appends known class codes when provided", () => {
    const p = buildIntentLLMUserPrompt("MAT223 review", {
      knownClassCodes: ["MAT223", "CSC110"],
    });
    expect(p).toMatch(/Known class codes: /);
    expect(p).toContain("MAT223");
    expect(p).toContain("CSC110");
  });

  it("caps entity list at 30 names to keep tokens bounded", () => {
    const knownEntities = Array.from({ length: 50 }, (_, i) => ({
      id: `e${i}`,
      displayName: `EntityName${i}`,
      aliases: [],
    }));
    const p = buildIntentLLMUserPrompt("task", { knownEntities });
    const count = (p.match(/EntityName\d+/g) ?? []).length;
    expect(count).toBeLessThanOrEqual(30);
  });

  it("omits context sections when nothing provided", () => {
    const p = buildIntentLLMUserPrompt("Random title", {});
    expect(p).not.toContain("Known entities:");
    expect(p).not.toContain("Known class codes:");
  });
});

describe("runIntentLLMClassification (with injected runner)", () => {
  it("returns the runner's result tagged as llm-fallback", async () => {
    const runner: IntentLLMRunner = async () => ({
      intent: "CALENDAR_EVENT",
      confidence: 0.82,
      reasoning: "Has weekday + time",
    });
    const r = await runIntentLLMClassification({
      title: "Friday 2pm meeting",
      context: {},
      runner,
    });
    expect(r.intent).toBe("CALENDAR_EVENT");
    expect(r.confidence).toBeCloseTo(0.82);
    expect(r.matchedPattern).toBe("llm-fallback");
  });

  it("passes the built prompt to the runner", async () => {
    let observed: { userPrompt: string } | null = null;
    const runner: IntentLLMRunner = async (args) => {
      observed = args;
      return { intent: "OTHER", confidence: 0.3, reasoning: "x" };
    };
    await runIntentLLMClassification({
      title: "test title",
      context: { knownClassCodes: ["MAT223"] },
      runner,
    });
    expect(observed).not.toBeNull();
    expect(observed!.userPrompt).toContain("test title");
    expect(observed!.userPrompt).toContain("MAT223");
  });
});

describe("classifyWithLLMIfNeeded", () => {
  const regexHighConf: IntentClassification = {
    intent: "DRAFT_EMAIL_REPLY",
    confidence: 0.85,
    matchedPattern: "ja-X-eno-reply",
  };
  const regexLowConf: IntentClassification = {
    intent: "OTHER",
    confidence: 0,
  };

  it("returns the regex result unchanged when confidence >= threshold", async () => {
    let called = false;
    const runner: IntentLLMRunner = async () => {
      called = true;
      return { intent: "OTHER", confidence: 0, reasoning: "" };
    };
    const r = await classifyWithLLMIfNeeded({
      regexResult: regexHighConf,
      title: "anything",
      context: {},
      runner,
    });
    expect(r).toBe(regexHighConf);
    expect(called).toBe(false);
  });

  it("invokes the LLM when regex confidence is below threshold", async () => {
    let called = false;
    const runner: IntentLLMRunner = async () => {
      called = true;
      return {
        intent: "ASSIGNMENT_WORK",
        confidence: 0.75,
        reasoning: "PS-shape",
      };
    };
    const r = await classifyWithLLMIfNeeded({
      regexResult: regexLowConf,
      title: "PS-shape title",
      context: {},
      runner,
    });
    expect(called).toBe(true);
    expect(r.intent).toBe("ASSIGNMENT_WORK");
    expect(r.confidence).toBeCloseTo(0.75);
  });

  it("keeps the regex result when LLM reply is less confident", async () => {
    const regexMid: IntentClassification = {
      intent: "STUDY_SESSION",
      confidence: 0.5,
      matchedPattern: "ja-study-keyword",
    };
    const runner: IntentLLMRunner = async () => ({
      intent: "OTHER",
      confidence: 0.2,
      reasoning: "less sure",
    });
    const r = await classifyWithLLMIfNeeded({
      regexResult: regexMid,
      title: "ambiguous",
      context: {},
      runner,
    });
    expect(r).toBe(regexMid);
  });

  it("gracefully degrades to the regex result when the LLM call throws", async () => {
    const runner: IntentLLMRunner = async () => {
      throw new Error("simulated timeout");
    };
    const r = await classifyWithLLMIfNeeded({
      regexResult: regexLowConf,
      title: "anything",
      context: {},
      runner,
    });
    expect(r).toBe(regexLowConf);
  });
});
