import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mocks for the route handler. Auth + rate-limit + Whisper + cleanup are
// the four boundaries we don't want to cross in a unit test. Each mock
// is module-scoped so re-imports inside tests pick them up via the test
// runner's caching.

vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { id: "u1" } }),
}));

vi.mock("@/lib/utils/rate-limit", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/utils/rate-limit")
  >("@/lib/utils/rate-limit");
  return {
    ...actual,
    enforceRateLimit: () => {},
  };
});

let whisperResponse: { text: string } | Error = { text: "hello world" };
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    audio: {
      transcriptions: {
        create: async () => {
          if (whisperResponse instanceof Error) throw whisperResponse;
          return whisperResponse;
        },
      },
    },
  }),
}));

let cleanupResult: { cleaned: string; usageId: string | null } | Error = {
  cleaned: "Hello, world.",
  usageId: "u1",
};
let shortenResult: { shortened: string; usageId: string | null } | Error = {
  shortened: "Hi.",
  usageId: "u2",
};
const shortenCalls: Array<unknown> = [];
const cleanupCalls: Array<unknown> = [];
vi.mock("@/lib/voice/cleanup", () => ({
  cleanupTranscript: async (args: unknown) => {
    cleanupCalls.push(args);
    if (cleanupResult instanceof Error) throw cleanupResult;
    return cleanupResult;
  },
  shortenTranscript: async (args: unknown) => {
    shortenCalls.push(args);
    if (shortenResult instanceof Error) throw shortenResult;
    return shortenResult;
  },
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  whisperResponse = { text: "hello world" };
  cleanupResult = { cleaned: "Hello, world.", usageId: "u1" };
  shortenResult = { shortened: "Hi.", usageId: "u2" };
  shortenCalls.length = 0;
  cleanupCalls.length = 0;
});

afterEach(() => {
  vi.resetModules();
});

// estimateDurationSec maps bytes → seconds at ~32 kbps. Below threshold
// uses ~5s of audio (20KB), at/above threshold uses ~30s (120KB).
function makeAudioBlob(approxDurationSec: number): Blob {
  const bytes = Math.round((approxDurationSec * 32_000) / 8);
  const buf = new Uint8Array(bytes);
  return new Blob([buf], { type: "audio/webm" });
}

async function postVoice(blob: Blob): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const { POST } = await import("@/app/api/voice/route");
  const form = new FormData();
  form.set("audio", blob, "voice.webm");
  const req = new Request("http://localhost/api/voice", {
    method: "POST",
    body: form,
  });
  const res = await POST(
    req as unknown as Parameters<typeof POST>[0]
  );
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe("/api/voice route — Phase 2 (auto-shorten)", () => {
  it("returns shortened when durationSec >= 30 and shorten succeeds", async () => {
    cleanupResult = { cleaned: "long cleaned text", usageId: "u1" };
    shortenResult = { shortened: "short", usageId: "u2" };
    const { body, status } = await postVoice(makeAudioBlob(35));
    expect(status).toBe(200);
    expect(body.cleaned).toBe("long cleaned text");
    expect(body.shortened).toBe("short");
    expect((body.durationSec as number) >= 30).toBe(true);
    expect(shortenCalls).toHaveLength(1);
  });

  it("does NOT include shortened when durationSec < 30", async () => {
    const { body, status } = await postVoice(makeAudioBlob(5));
    expect(status).toBe(200);
    expect(body.cleaned).toBe("Hello, world.");
    expect("shortened" in body).toBe(false);
    expect(shortenCalls).toHaveLength(0);
  });

  it("soft-fails when shorten throws — parent request still succeeds with cleaned only", async () => {
    cleanupResult = { cleaned: "long cleaned text", usageId: "u1" };
    shortenResult = new Error("shorten boom");
    const { body, status } = await postVoice(makeAudioBlob(35));
    expect(status).toBe(200);
    expect(body.cleaned).toBe("long cleaned text");
    expect("shortened" in body).toBe(false);
    expect(shortenCalls).toHaveLength(1);
  });

  it("omits shortened when the model returned the same text as cleaned (no condensation)", async () => {
    cleanupResult = { cleaned: "already concise", usageId: "u1" };
    shortenResult = { shortened: "already concise", usageId: "u2" };
    const { body, status } = await postVoice(makeAudioBlob(35));
    expect(status).toBe(200);
    expect("shortened" in body).toBe(false);
  });

  it("omits shortened when the model returned an empty/whitespace string", async () => {
    cleanupResult = { cleaned: "long cleaned text", usageId: "u1" };
    shortenResult = { shortened: "   ", usageId: "u2" };
    const { body, status } = await postVoice(makeAudioBlob(35));
    expect(status).toBe(200);
    expect("shortened" in body).toBe(false);
  });

  it("does not call shorten when transcription is empty (cleanup is skipped)", async () => {
    whisperResponse = { text: "" };
    const { body, status } = await postVoice(makeAudioBlob(35));
    expect(status).toBe(200);
    expect(body.cleaned).toBe("");
    expect(body.cleanupSkipped).toBe(true);
    expect("shortened" in body).toBe(false);
    expect(shortenCalls).toHaveLength(0);
  });
});
