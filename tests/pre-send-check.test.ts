import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-39 — pre-send fact-checker. Verifies:
//   1. ok=true happy path returns no warnings
//   2. hallucinated date triggers a warning
//   3. hallucinated URL triggers a warning
//   4. LLM error degrades to ok=true (critical constraint — never block sends)
//   5. parsePreSendCheck defends against malformed JSON
//   6. Defensive: ok=false with empty warnings degrades to ok=true

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/schema", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

let stubbed: unknown = null;
let throwOnCreate = false;
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async () => {
          if (throwOnCreate) {
            throw new Error("openai 5xx");
          }
          return stubbed as unknown;
        },
      },
    },
  }),
}));

vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usd: 0, credits: 0, usageId: "u-1" }),
}));

vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4-mini",
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));

beforeEach(() => {
  stubbed = null;
  throwOnCreate = false;
});

function fakeResponse(payload: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 500, completion_tokens: 30 },
  };
}

describe("checkDraftBeforeSend", () => {
  it("happy path: returns ok=true with no warnings", async () => {
    stubbed = fakeResponse({ ok: true, warnings: [] });
    const { checkDraftBeforeSend } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    const out = await checkDraftBeforeSend({
      userId: "u1",
      draftSubject: "Re: question",
      draftBody: "Thanks for the update — I'll review and circle back.",
      threadContext:
        "From: prof@x.edu\nSubject: question\nBody: Just checking in on chapter 7.",
    });
    expect(out.ok).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it("flags a hallucinated date that doesn't appear in the thread", async () => {
    stubbed = fakeResponse({
      ok: false,
      warnings: [
        {
          phrase: "Friday at 2pm",
          why: "No Friday meeting time appears in the thread context.",
        },
      ],
    });
    const { checkDraftBeforeSend } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    const out = await checkDraftBeforeSend({
      userId: "u1",
      draftSubject: "Re: meeting",
      draftBody: "See you Friday at 2pm.",
      threadContext:
        "From: prof@x.edu\nBody: Could we meet sometime next week?",
    });
    expect(out.ok).toBe(false);
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].phrase).toBe("Friday at 2pm");
  });

  it("flags a hallucinated URL", async () => {
    stubbed = fakeResponse({
      ok: false,
      warnings: [
        {
          phrase: "https://example.com/registration",
          why: "URL not in the thread context.",
        },
      ],
    });
    const { checkDraftBeforeSend } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    const out = await checkDraftBeforeSend({
      userId: "u1",
      draftSubject: "Re: form",
      draftBody:
        "I've filled it out — see https://example.com/registration.",
      threadContext: "From: x\nBody: Please fill the registration form.",
    });
    expect(out.ok).toBe(false);
    expect(out.warnings[0].phrase).toContain("example.com");
  });

  it("degrades to ok=true on an OpenAI failure (CRITICAL — never block sends)", async () => {
    throwOnCreate = true;
    const { checkDraftBeforeSend } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    const out = await checkDraftBeforeSend({
      userId: "u1",
      draftSubject: "Re: anything",
      draftBody: "Thanks!",
      threadContext: "Hello",
    });
    expect(out.ok).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it("defensively rewrites ok=false + empty warnings to ok=true", async () => {
    stubbed = fakeResponse({ ok: false, warnings: [] });
    const { checkDraftBeforeSend } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    const out = await checkDraftBeforeSend({
      userId: "u1",
      draftSubject: "Re: hi",
      draftBody: "hello",
      threadContext: "",
    });
    expect(out.ok).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it("trims warnings exceeding 5 to keep the modal compact", async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({
      phrase: `phrase ${i}`,
      why: `why ${i}`,
    }));
    stubbed = fakeResponse({ ok: false, warnings: many });
    const { checkDraftBeforeSend } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    const out = await checkDraftBeforeSend({
      userId: "u1",
      draftSubject: "x",
      draftBody: "y",
      threadContext: "z",
    });
    expect(out.warnings.length).toBeLessThanOrEqual(5);
  });
});

describe("parsePreSendCheck", () => {
  it("returns ok=true on unparseable JSON", async () => {
    const { parsePreSendCheck } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    expect(parsePreSendCheck("not json")).toEqual({
      ok: true,
      warnings: [],
    });
  });

  it("filters warnings missing phrase or why", async () => {
    const { parsePreSendCheck } = await import(
      "@/lib/agent/email/pre-send-check"
    );
    const out = parsePreSendCheck(
      JSON.stringify({
        ok: false,
        warnings: [
          { phrase: "ok", why: "ok" },
          { phrase: "no why" },
          { why: "no phrase" },
          { phrase: "", why: "ok" },
        ],
      })
    );
    expect(out.warnings).toHaveLength(1);
  });
});
