import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-38 — voice profile extraction. Covers:
//   1. fetches Gmail in:sent, filters short replies, calls the model
//   2. persists the LLM output into users.preferences.voiceProfile
//      (jsonb merge — does NOT clobber other preferences keys)
//   3. throws VoiceProfileNotEnoughSamplesError when filtered samples
//      are below the 3-line threshold

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const usersSchema = {
  id: tag("users.id"),
  preferences: tag("users.preferences"),
  updatedAt: tag("users.updatedAt"),
};

vi.mock("@/lib/db/schema", () => ({
  users: usersSchema,
}));

const sqlCalls: string[] = [];

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const parts: string[] = [];
      for (let i = 0; i < strings.length; i++) {
        parts.push(strings[i]);
        if (i < values.length) parts.push(String(values[i]));
      }
      const joined = parts.join("");
      sqlCalls.push(joined);
      return joined;
    },
    { raw: () => ({}) }
  ),
}));

const updateCalls: Array<{ table: unknown; set: unknown }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    update: (table: unknown) => ({
      set: (set: unknown) => ({
        where: () => {
          updateCalls.push({ table, set });
          return Promise.resolve();
        },
      }),
    }),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));

// Stage Gmail message bodies. Each entry becomes one users.messages.get
// response. The `extractEmailBody` mock pulls the body string straight
// out of the message — the real extractor's HTML-strip / base64 paths
// aren't relevant here.
const stagedMessages: string[] = [];
let listIds: string[] = [];

vi.mock("@/lib/integrations/google/gmail", () => ({
  getGmailForUser: async () => ({
    users: {
      messages: {
        list: async () => ({
          data: { messages: listIds.map((id) => ({ id })) },
        }),
        get: async ({ id }: { id: string }) => ({
          data: { id, _stub: id },
        }),
      },
    },
  }),
}));

vi.mock("@/lib/agent/email/body-extract", () => ({
  extractEmailBody: (msg: { _stub?: string }) => {
    const idx = listIds.indexOf(msg._stub ?? "");
    return { text: stagedMessages[idx] ?? "", format: "text/plain" as const };
  },
}));

let stubbedProfile = "Casual EN/JA mix · 1-2 short paragraphs · no signature";
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: stubbedProfile } }],
          usage: { prompt_tokens: 9000, completion_tokens: 40 },
        }),
      },
    },
  }),
}));

vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({
    usd: 0.05,
    credits: 10,
    usageId: "usage-voice-1",
  }),
}));

vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4",
}));

beforeEach(() => {
  stagedMessages.length = 0;
  listIds = [];
  updateCalls.length = 0;
  sqlCalls.length = 0;
  stubbedProfile = "Casual EN/JA mix · 1-2 short paragraphs · no signature";
});

describe("generateVoiceProfile", () => {
  it("fetches sent mail, calls the model, persists to users.preferences.voiceProfile", async () => {
    listIds = ["m1", "m2", "m3"];
    stagedMessages.push(
      "Hi prof,\nSorry for the late reply.\nI'll see you Thursday.",
      "Hey,\nThanks for sending the slides.\nReally helpful.",
      "Hi,\nI'll bring the lab notebook tomorrow.\nThanks for the heads-up."
    );

    const { generateVoiceProfile } = await import(
      "@/lib/agent/email/voice-profile"
    );
    const out = await generateVoiceProfile("u1");

    expect(out.profile).toBe(stubbedProfile);
    expect(out.sampleCount).toBe(3);

    // The persist call must merge into preferences via jsonb concat —
    // we verify by checking the SQL template captured the merge shape.
    const merged = sqlCalls.some((s) =>
      s.includes("COALESCE") && s.includes("voiceProfile")
    );
    expect(merged).toBe(true);
    expect(updateCalls.length).toBe(1);
  });

  it("throws VoiceProfileNotEnoughSamplesError when fewer than 3 long-enough replies survive", async () => {
    listIds = ["m1", "m2"];
    stagedMessages.push(
      "Hi prof,\nThanks.\nSee you.",
      "Sure" // 1 line, dropped
    );

    const { generateVoiceProfile, VoiceProfileNotEnoughSamplesError } =
      await import("@/lib/agent/email/voice-profile");
    await expect(generateVoiceProfile("u1")).rejects.toBeInstanceOf(
      VoiceProfileNotEnoughSamplesError
    );
  });

  it("caps the saved profile at 200 characters", async () => {
    listIds = ["m1", "m2", "m3"];
    stagedMessages.push(
      "Hi prof,\nA reply with three lines.\nThanks.",
      "Hi prof,\nA second reply.\nKept short.",
      "Hi prof,\nAnother reply body.\nWith three lines."
    );
    stubbedProfile = "x".repeat(500);

    const { generateVoiceProfile } = await import(
      "@/lib/agent/email/voice-profile"
    );
    const out = await generateVoiceProfile("u1");
    expect(out.profile.length).toBeLessThanOrEqual(200);
  });
});
