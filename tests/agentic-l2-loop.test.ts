import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-41 — agentic L2 loop integration. Mocks the OpenAI streaming
// surface + the L2 tool registry so we can verify:
//   1. The loop calls tools in the order the mocked model emits
//   2. Empty tool_calls on an iteration ends the loop with the model's
//      final text as the JSON candidate
//   3. Cap exhaustion (MAX_TOOL_ITERATIONS) triggers the forced final-
//      pass with tool_choice=none
//   4. The returned shape matches the new AgenticL2Result fields

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usd: 0, credits: 0, usageId: "usage-loop-1" }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4",
}));
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async () => {},
}));

// Mocked tool registry. Each tool just records its call and returns
// canned data; the loop's job is to dispatch them in order.
const toolCalls: Array<{ name: string; args: unknown }> = [];
vi.mock("@/lib/agent/email/l2-tools", () => ({
  getL2ToolByName: (name: string) => {
    if (name === "lookup_contact_persona") {
      return {
        schema: { name },
        execute: async (_ctx: unknown, args: unknown) => {
          toolCalls.push({ name, args });
          return { found: true, relationship: "MAT223 instructor", facts: [], structuredFacts: {}, lastExtractedAt: null };
        },
      };
    }
    if (name === "extract_candidate_dates") {
      return {
        schema: { name },
        execute: async (_ctx: unknown, args: unknown) => {
          toolCalls.push({ name, args });
          return {
            candidates: [
              {
                date: "2026-05-15",
                startTime: "10:00",
                endTime: "11:00",
                timezoneHint: "JST",
                confidence: 0.95,
                sourceText: "x",
              },
            ],
          };
        },
      };
    }
    if (name === "queue_user_confirmation") {
      return {
        schema: { name },
        execute: async (_ctx: unknown, args: unknown) => {
          toolCalls.push({ name, args });
          return { confirmationId: "conf-fake-1", status: "queued" };
        },
      };
    }
    return undefined;
  },
  l2OpenAIToolDefs: () => [],
}));

// Scriptable OpenAI mock. Each call to openai().chat.completions.create
// pops the next scripted response off `scripted` and either replays
// streaming chunks (when stream:true) or returns a flat completion
// (forced final-pass, stream:false).
type ScriptedToolCall = { id: string; name: string; args: string };
type ScriptedStream = {
  mode: "stream";
  text: string;
  toolCalls: ScriptedToolCall[];
};
type ScriptedFlat = { mode: "flat"; text: string };
type Scripted = ScriptedStream | ScriptedFlat;

let scripted: Scripted[] = [];
function nextScripted(): Scripted | null {
  return scripted.shift() ?? null;
}

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async (opts: { stream?: boolean }) => {
          const s = nextScripted();
          if (!s) return mkFlatResponse("{}");
          if (s.mode === "stream") {
            // Build an async iterable of chunks: deltas with text, then
            // tool_calls if any, then a usage chunk.
            return {
              [Symbol.asyncIterator]: async function* () {
                if (s.text) {
                  yield {
                    choices: [{ delta: { content: s.text } }],
                  };
                }
                for (let i = 0; i < s.toolCalls.length; i++) {
                  const tc = s.toolCalls[i];
                  yield {
                    choices: [
                      {
                        delta: {
                          tool_calls: [
                            {
                              index: i,
                              id: tc.id,
                              function: { name: tc.name, arguments: tc.args },
                            },
                          ],
                        },
                      },
                    ],
                  };
                }
                yield {
                  usage: {
                    prompt_tokens: 100,
                    completion_tokens: 20,
                    prompt_tokens_details: { cached_tokens: 0 },
                  },
                };
              },
            };
          }
          // Flat (forced final-pass) response.
          return mkFlatResponse(s.text);
        },
      },
    },
  }),
}));

function mkFlatResponse(text: string) {
  return {
    choices: [{ message: { content: text } }],
    usage: {
      prompt_tokens: 200,
      completion_tokens: 30,
      prompt_tokens_details: { cached_tokens: 0 },
    },
  };
}

import { runAgenticL2 } from "@/lib/agent/email/agentic-l2";

const baseInput = {
  userId: "user-1",
  inboxItemId: "inbox-1",
  senderEmail: "prof@school.edu",
  senderDomain: "school.edu",
  senderRole: "professor" as string | null,
  subject: "Interview slot?",
  bodyForPipeline: "Can you do 2026/5/15 10:00 JST?",
  riskPass: {
    riskTier: "high" as const,
    confidence: 0.9,
    reasoning: "Direct ask from a known professor.",
    usageId: null,
  },
  locale: "en" as const,
};

beforeEach(() => {
  toolCalls.length = 0;
  scripted = [];
});

describe("runAgenticL2 loop", () => {
  it("calls tools in the order the model emits them, then returns parsed final JSON", async () => {
    // Iteration 1: model emits two tool calls (lookup_contact_persona,
    // then extract_candidate_dates).
    scripted.push({
      mode: "stream",
      text: "",
      toolCalls: [
        {
          id: "tc-1",
          name: "lookup_contact_persona",
          args: JSON.stringify({ contactEmail: "prof@school.edu" }),
        },
        {
          id: "tc-2",
          name: "extract_candidate_dates",
          args: JSON.stringify({ body: "Can you do 2026/5/15 10:00 JST?" }),
        },
      ],
    });
    // Iteration 2: model emits the final JSON text and no tool calls,
    // ending the loop.
    scripted.push({
      mode: "stream",
      text: JSON.stringify({
        action: "draft_reply",
        reasoning: "Slot is free. Drafting acceptance.",
        actionItems: [],
        confirmationsQueued: [],
        availabilityChecksRan: [],
        inferredFacts: [
          {
            topic: "timezone",
            value: "Asia/Tokyo",
            confidence: 0.85,
            source: "llm_body_analysis",
          },
        ],
        schedulingDetected: true,
      }),
      toolCalls: [],
    });

    const out = await runAgenticL2(baseInput);
    expect(toolCalls.map((c) => c.name)).toEqual([
      "lookup_contact_persona",
      "extract_candidate_dates",
    ]);
    expect(out.action).toBe("draft_reply");
    expect(out.schedulingDetected).toBe(true);
    expect(out.inferredFacts).toHaveLength(1);
    expect(out.iterations).toBe(2);
    expect(out.toolCallCount).toBe(2);
  });

  it("captures queue_user_confirmation results into confirmationQuestions", async () => {
    scripted.push({
      mode: "stream",
      text: "",
      toolCalls: [
        {
          id: "tc-1",
          name: "queue_user_confirmation",
          args: JSON.stringify({
            topic: "timezone",
            question: "Is this contact in JST?",
            inferredValue: "Asia/Tokyo",
          }),
        },
      ],
    });
    scripted.push({
      mode: "stream",
      text: JSON.stringify({
        action: "draft_reply",
        reasoning: "x",
        actionItems: [],
        confirmationsQueued: ["conf-fake-1"],
        availabilityChecksRan: [],
        inferredFacts: [],
        schedulingDetected: false,
      }),
      toolCalls: [],
    });

    const out = await runAgenticL2(baseInput);
    expect(out.confirmationQuestions).toHaveLength(1);
    expect(out.confirmationQuestions[0].confirmationId).toBe("conf-fake-1");
    expect(out.confirmationQuestions[0].topic).toBe("timezone");
  });

  it("triggers a forced final-pass when the model exhausts iterations", async () => {
    // Push 10 iterations that always emit one tool call (unknown tool
    // — the dispatcher inserts an error message and loops again). The
    // loop hits MAX_TOOL_ITERATIONS=10 and must fall back to the forced
    // final-pass.
    for (let i = 0; i < 10; i++) {
      scripted.push({
        mode: "stream",
        text: "",
        toolCalls: [
          {
            id: `tc-${i}`,
            name: "nonexistent_tool",
            args: "{}",
          },
        ],
      });
    }
    // Forced final-pass (flat completion).
    scripted.push({
      mode: "flat",
      text: JSON.stringify({
        action: "ask_clarifying",
        reasoning: "Hit cap; defer to user review.",
        actionItems: [],
        confirmationsQueued: [],
        availabilityChecksRan: [],
        inferredFacts: [],
        schedulingDetected: false,
      }),
    });

    const out = await runAgenticL2(baseInput);
    expect(out.iterations).toBe(10);
    expect(out.action).toBe("ask_clarifying");
    expect(out.reasoning).toContain("Hit cap");
  });
});
