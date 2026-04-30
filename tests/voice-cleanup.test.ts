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

// The cleanup pass fetches the user's classes + recent chat titles by
// default. We mock the helper so the existing tests don't need a DB —
// each test that wants context overrides the stub locally. We can't use
// importActual here because the real module imports the DB client, which
// reads env vars that vitest doesn't have set.
let stubbedUserContext: { classesBlock?: string; topicsBlock?: string } = {};
vi.mock("@/lib/voice/user-context", () => ({
  fetchVoiceUserContext: async () => stubbedUserContext,
  buildVoiceContextSystemMessage: (ctx: {
    classesBlock?: string;
    topicsBlock?: string;
  }) => {
    const parts: string[] = [];
    if (ctx.classesBlock) parts.push(ctx.classesBlock);
    if (ctx.topicsBlock) parts.push(ctx.topicsBlock);
    if (parts.length === 0) return null;
    return `USER ACADEMIC CONTEXT (use to disambiguate proper nouns / topics):\n${parts.join("\n")}`;
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
  stubbedUserContext = {};
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
    expect((usageCalls[0] as unknown as { chatId?: string }).chatId).toBe(
      "chat-abc"
    );
  });
});

describe("cleanupTranscript with academic context (Phase 2)", () => {
  it("appends a SECOND system message with the user's classes + topics when present", async () => {
    stubbedUserContext = {
      classesBlock:
        "Classes:\n- MAT223 — Linear Algebra I (Prof. Smith)\n- CSC110 — Introduction to Computer Science",
      topicsBlock: "Recent chat topics: midterm review, lab 4 submission",
    };
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({ userId: "u1", transcript: "MAT223 のレポート" });

    const systems = openaiCalls[0].messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(2);
    // Universal prompt is the cacheable prefix — it stays first and unchanged.
    expect(systems[0].content).toMatch(/voice-to-text transcript/);
    // Per-user context is the second message.
    expect(systems[1].content).toMatch(/USER ACADEMIC CONTEXT/);
    expect(systems[1].content).toContain("MAT223");
    expect(systems[1].content).toContain("Prof. Smith");
    expect(systems[1].content).toContain("midterm review");
  });

  it("omits the second system message entirely when the user has no classes and no chat titles", async () => {
    stubbedUserContext = {};
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({ userId: "u1", transcript: "hello" });
    const systems = openaiCalls[0].messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(1);
    expect(systems[0].content).toMatch(/voice-to-text transcript/);
  });

  it("includes only classes when the user has no titled chats", async () => {
    stubbedUserContext = {
      classesBlock: "Classes:\n- MAT223 — Linear Algebra I",
    };
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({ userId: "u1", transcript: "MAT223" });
    const systems = openaiCalls[0].messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(2);
    expect(systems[1].content).toContain("Classes:");
    expect(systems[1].content).not.toContain("Recent chat topics");
  });

  it("preserves the cacheable prefix as the first system message exactly (drift guard)", async () => {
    const { VOICE_CLEANUP_SYSTEM_PROMPT } = await import(
      "@/lib/voice/cleanup-prompt"
    );
    stubbedUserContext = {
      classesBlock: "Classes:\n- MAT223 — Linear Algebra I",
    };
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({ userId: "u1", transcript: "hello" });
    const firstSystem = openaiCalls[0].messages.find(
      (m) => m.role === "system"
    )!.content;
    // The first system message must be byte-exact with the locked prompt
    // — anything else would invalidate OpenAI's auto-cache hit.
    expect(firstSystem).toBe(VOICE_CLEANUP_SYSTEM_PROMPT);
  });

  it("accepts an explicit userContext override (skips DB fetch)", async () => {
    const { cleanupTranscript } = await import("@/lib/voice/cleanup");
    await cleanupTranscript({
      userId: "u1",
      transcript: "hello",
      userContext: {
        classesBlock: "Classes:\n- HIST200 — World History",
      },
    });
    const systems = openaiCalls[0].messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(2);
    expect(systems[1].content).toContain("HIST200");
  });
});

describe("shortenTranscript (Phase 2 — long voice msg summary)", () => {
  beforeEach(() => {
    stubbedResponse = {
      choices: [{ message: { content: "短くした版です。" } }],
      usage: { prompt_tokens: 80, completion_tokens: 12 },
    };
  });

  it("returns the shortened text from GPT-5.4 Mini and logs voice_cleanup usage", async () => {
    const { shortenTranscript } = await import("@/lib/voice/cleanup");
    const out = await shortenTranscript({
      userId: "u1",
      cleaned: "今日の授業についてめっちゃ長く話します。…（中略）…",
    });
    expect(out.shortened).toBe("短くした版です。");
    expect(usageCalls).toHaveLength(1);
    expect(usageCalls[0].taskType).toBe("voice_cleanup");
  });

  it("uses the shorten system prompt — a different prompt from cleanup", async () => {
    const { shortenTranscript } = await import("@/lib/voice/cleanup");
    await shortenTranscript({ userId: "u1", cleaned: "blah blah blah" });
    const sys = openaiCalls[0].messages.find((m) => m.role === "system")!.content;
    expect(sys).toMatch(/shorter version/i);
    expect(sys).toMatch(/Output ONLY the shortened text/i);
  });

  it("short-circuits empty input without calling OpenAI", async () => {
    const { shortenTranscript } = await import("@/lib/voice/cleanup");
    const out = await shortenTranscript({ userId: "u1", cleaned: "  " });
    expect(out.shortened).toBe("");
    expect(openaiCalls).toHaveLength(0);
    expect(usageCalls).toHaveLength(0);
  });

  it("falls back to the input when the model returns empty content", async () => {
    stubbedResponse = {
      choices: [{ message: { content: "" } }],
      usage: { prompt_tokens: 60, completion_tokens: 0 },
    };
    const { shortenTranscript } = await import("@/lib/voice/cleanup");
    const out = await shortenTranscript({
      userId: "u1",
      cleaned: "untouched original",
    });
    expect(out.shortened).toBe("untouched original");
  });

  it("only sends ONE system message — the shorten prompt does not consume USER ACADEMIC CONTEXT", async () => {
    stubbedUserContext = {
      classesBlock: "Classes:\n- MAT223 — Linear Algebra I",
    };
    const { shortenTranscript } = await import("@/lib/voice/cleanup");
    await shortenTranscript({ userId: "u1", cleaned: "long ramble" });
    const systems = openaiCalls[0].messages.filter((m) => m.role === "system");
    expect(systems).toHaveLength(1);
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
