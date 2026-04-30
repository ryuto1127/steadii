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

let streamCleanupChunks: string[] = ["Hello, ", "world."];
let streamCleanupError: Error | null = null;
let shortenResult: { shortened: string; usageId: string | null } | Error = {
  shortened: "Hi.",
  usageId: "u2",
};
const shortenCalls: Array<unknown> = [];
const streamCleanupCalls: Array<unknown> = [];

vi.mock("@/lib/voice/cleanup", () => ({
  cleanupTranscript: async () => ({ cleaned: "", usageId: null }),
  shortenTranscript: async (args: unknown) => {
    shortenCalls.push(args);
    if (shortenResult instanceof Error) throw shortenResult;
    return shortenResult;
  },
  streamCleanupTranscript: async function* (args: unknown) {
    streamCleanupCalls.push(args);
    if (streamCleanupError) throw streamCleanupError;
    let cleaned = "";
    for (const chunk of streamCleanupChunks) {
      cleaned += chunk;
      yield { type: "delta" as const, delta: chunk };
    }
    yield { type: "done" as const, cleaned, usageId: "u1" };
  },
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  whisperResponse = { text: "hello world this is a long enough phrase" };
  streamCleanupChunks = ["Hello, ", "world."];
  streamCleanupError = null;
  shortenResult = { shortened: "Hi.", usageId: "u2" };
  shortenCalls.length = 0;
  streamCleanupCalls.length = 0;
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

type SseEvent = Record<string, unknown>;

async function postVoice(blob: Blob): Promise<{
  status: number;
  events: SseEvent[];
  contentType: string | null;
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
  const contentType = res.headers.get("content-type");
  // Non-SSE error path returns JSON; surface as a single event so the
  // assertion shape is uniform.
  if (contentType && contentType.includes("application/json")) {
    const body = (await res.json()) as Record<string, unknown>;
    return { status: res.status, events: [body], contentType };
  }
  const text = await res.text();
  const events: SseEvent[] = [];
  for (const part of text.split("\n\n")) {
    const trimmed = part.trim();
    if (!trimmed.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(trimmed.slice(5).trim()) as SseEvent);
    } catch {
      // skip malformed
    }
  }
  return { status: res.status, events, contentType };
}

describe("/api/voice route — Phase 4 (SSE streaming + Nano + short-skip)", () => {
  it("emits delta events in order followed by a final done event", async () => {
    streamCleanupChunks = ["Hello, ", "world", "."];
    const { status, events, contentType } = await postVoice(makeAudioBlob(5));
    expect(status).toBe(200);
    expect(contentType).toContain("text/event-stream");
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas.map((d) => d.delta)).toEqual(["Hello, ", "world", "."]);
    const done = events.find((e) => e.type === "done");
    expect(done).toBeDefined();
    expect(done?.cleaned).toBe("Hello, world.");
  });

  it("includes a shortened event for >=30s clips when shorten produced a tighter version", async () => {
    streamCleanupChunks = ["long ", "cleaned ", "text"];
    shortenResult = { shortened: "short", usageId: "u2" };
    const { events } = await postVoice(makeAudioBlob(35));
    const shortened = events.find((e) => e.type === "shortened");
    expect(shortened?.shortened).toBe("short");
    const done = events.find((e) => e.type === "done");
    expect(done?.shortened).toBe("short");
    expect((done?.durationSec as number) >= 30).toBe(true);
    expect(shortenCalls).toHaveLength(1);
  });

  it("does NOT include shortened when durationSec < 30", async () => {
    const { events } = await postVoice(makeAudioBlob(5));
    const shortened = events.find((e) => e.type === "shortened");
    expect(shortened).toBeUndefined();
    const done = events.find((e) => e.type === "done");
    expect(done && "shortened" in done).toBe(false);
    expect(shortenCalls).toHaveLength(0);
  });

  it("soft-fails when shorten throws — done event still emits with cleaned only", async () => {
    streamCleanupChunks = ["long ", "cleaned ", "text"];
    shortenResult = new Error("shorten boom");
    const { events } = await postVoice(makeAudioBlob(35));
    const done = events.find((e) => e.type === "done");
    expect(done?.cleaned).toBe("long cleaned text");
    expect(done && "shortened" in done).toBe(false);
    expect(shortenCalls).toHaveLength(1);
  });

  it("omits shortened when the model returned the same text as cleaned", async () => {
    streamCleanupChunks = ["already ", "concise"];
    shortenResult = { shortened: "already concise", usageId: "u2" };
    const { events } = await postVoice(makeAudioBlob(35));
    const shortened = events.find((e) => e.type === "shortened");
    expect(shortened).toBeUndefined();
  });

  it("omits shortened when the model returned an empty/whitespace string", async () => {
    streamCleanupChunks = ["long ", "cleaned ", "text"];
    shortenResult = { shortened: "   ", usageId: "u2" };
    const { events } = await postVoice(makeAudioBlob(35));
    const shortened = events.find((e) => e.type === "shortened");
    expect(shortened).toBeUndefined();
  });

  it("does not call shorten when transcription is empty (cleanup is skipped)", async () => {
    whisperResponse = { text: "" };
    const { events } = await postVoice(makeAudioBlob(35));
    const done = events.find((e) => e.type === "done");
    expect(done?.cleaned).toBe("");
    expect(done?.cleanupSkipped).toBe(true);
    expect(streamCleanupCalls).toHaveLength(0);
    expect(shortenCalls).toHaveLength(0);
  });

  it("skips cleanup for very short transcripts (<10 non-whitespace chars)", async () => {
    whisperResponse = { text: "うん" };
    const { events } = await postVoice(makeAudioBlob(2));
    const done = events.find((e) => e.type === "done");
    expect(done?.cleaned).toBe("うん");
    expect(done?.cleanupSkipped).toBe(true);
    // No cleanup model call — that's the speed win.
    expect(streamCleanupCalls).toHaveLength(0);
    // No deltas emitted either, since cleanup was skipped.
    const deltas = events.filter((e) => e.type === "delta");
    expect(deltas).toHaveLength(0);
  });

  it("skip threshold counts non-whitespace only — pure spaces still skip", async () => {
    whisperResponse = { text: "    \n  " };
    const { events } = await postVoice(makeAudioBlob(2));
    const done = events.find((e) => e.type === "done");
    expect(done?.cleanupSkipped).toBe(true);
    expect(streamCleanupCalls).toHaveLength(0);
  });
});

describe("voice_cleanup model routing", () => {
  it("selectModel(voice_cleanup) returns the Nano default when no env override", async () => {
    const { selectModel } = await import("@/lib/agent/models");
    // Empty-ish env so no overrides leak in from process.env
    const result = selectModel("voice_cleanup", {} as NodeJS.ProcessEnv);
    expect(result).toBe("gpt-5.4-nano");
  });

  it("respects OPENAI_NANO_MODEL override", async () => {
    const { selectModel } = await import("@/lib/agent/models");
    const result = selectModel("voice_cleanup", {
      OPENAI_NANO_MODEL: "custom-nano",
    } as unknown as NodeJS.ProcessEnv);
    expect(result).toBe("custom-nano");
  });
});
