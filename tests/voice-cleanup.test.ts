import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiCalls: Array<{
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
}> = [];
let stubbedResponse: unknown = {
  choices: [{ message: { content: "明日のテスト、リスケしてもらえないかな？" } }],
  usage: { prompt_tokens: 220, completion_tokens: 28 },
};

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async (args: {
          model: string;
          messages: Array<{ role: string; content: string }>;
          temperature?: number;
        }) => {
          openaiCalls.push(args);
          return stubbedResponse as unknown;
        },
      },
    },
  }),
}));

const usageCalls: Array<{
  taskType: string;
  userId: string;
  inputTokens: number;
  outputTokens: number;
}> = [];
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async (r: {
    taskType: string;
    userId: string;
    inputTokens: number;
    outputTokens: number;
  }) => {
    usageCalls.push(r);
    return { usd: 0.0004, credits: 0, usageId: `usage-${usageCalls.length}` };
  },
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  openaiCalls.length = 0;
  usageCalls.length = 0;
  stubbedResponse = {
    choices: [{ message: { content: "明日のテスト、リスケしてもらえないかな？" } }],
    usage: { prompt_tokens: 220, completion_tokens: 28 },
  };
});

describe("cleanupTranscript (voice cleanup pass)", () => {
  it("returns the cleaned text from GPT-5.4 Mini and records voice_cleanup usage", async () => {
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    const out = await cleanupTranscript({
      userId: "u1",
      transcript: "明日のテストのー、あー、そう、明日のテスト、リスケしてもらえないかな",
    });
    expect(out.cleaned).toBe("明日のテスト、リスケしてもらえないかな？");
    expect(usageCalls).toHaveLength(1);
    expect(usageCalls[0].taskType).toBe("voice_cleanup");
    expect(usageCalls[0].userId).toBe("u1");
    expect(usageCalls[0].inputTokens).toBe(220);
    expect(usageCalls[0].outputTokens).toBe(28);
  });

  it("sends the locked system prompt + INPUT/OUTPUT framed user message", async () => {
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({
      userId: "u1",
      transcript: "MAT223 のレポート due tomorrow",
    });
    const sys = openaiCalls[0].messages.find((m) => m.role === "system")!.content;
    const user = openaiCalls[0].messages.find((m) => m.role === "user")!.content;
    expect(sys).toMatch(/voice-to-text transcript/);
    expect(sys).toMatch(/Output ONLY the cleaned text/i);
    expect(user.startsWith("INPUT:\n")).toBe(true);
    expect(user.endsWith("OUTPUT:")).toBe(true);
    expect(user).toContain("MAT223 のレポート due tomorrow");
  });

  it("uses GPT-5.4 Mini (chat-tier model) — voice_cleanup routes alongside chat", async () => {
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({ userId: "u1", transcript: "hello" });
    expect(openaiCalls[0].model).toMatch(/mini/);
  });

  it("short-circuits empty transcripts without calling OpenAI", async () => {
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    const out = await cleanupTranscript({ userId: "u1", transcript: "   " });
    expect(out.cleaned).toBe("");
    expect(openaiCalls).toHaveLength(0);
    expect(usageCalls).toHaveLength(0);
  });

  it("falls back to the raw transcript when the model returns empty content", async () => {
    stubbedResponse = {
      choices: [{ message: { content: "" } }],
      usage: { prompt_tokens: 100, completion_tokens: 0 },
    };
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    const out = await cleanupTranscript({ userId: "u1", transcript: "raw text" });
    expect(out.cleaned).toBe("raw text");
  });

  it("propagates the chatId to recordUsage so analytics can attribute by chat", async () => {
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({
      userId: "u1",
      chatId: "chat-abc",
      transcript: "hello",
    });
    expect(usageCalls[0]).toMatchObject({ taskType: "voice_cleanup" });
    // recordUsage receives chatId on the same call. Cast through the
    // captured shape to verify without leaking implementation details.
    expect((usageCalls[0] as unknown as { chatId?: string }).chatId).toBe(
      "chat-abc"
    );
  });
});

describe("voice cleanup credit accounting", () => {
  it("treats voice_cleanup as a NON-credit-metering task type", async () => {
    const { taskTypeMetersCredits } = await import("@/lib/agent/models");
    expect(taskTypeMetersCredits("voice_cleanup")).toBe(false);
  });

  it("routes voice_cleanup to the chat (Mini) model tier by default", async () => {
    const { selectModel } = await import("@/lib/agent/models");
    const env = {} as NodeJS.ProcessEnv;
    expect(selectModel("voice_cleanup", env)).toMatch(/mini/);
  });
});
