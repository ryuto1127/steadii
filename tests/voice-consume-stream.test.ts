import { describe, expect, it } from "vitest";
import { consumeVoiceStream } from "@/lib/voice/consume-voice-stream";

// Builds a ReadableStream<Uint8Array> that emits the given SSE event objects
// as `data: {json}\n\n` frames. `chunkBoundaries`, when provided, re-splits the
// full encoded payload at those byte offsets so we can exercise the
// partial-frame buffering (an event split across two reads).
function sseStream(
  events: Array<Record<string, unknown>>,
  opts: { trailingBlankLine?: boolean; splitEvery?: number } = {}
): ReadableStream<Uint8Array> {
  const { trailingBlankLine = true, splitEvery } = opts;
  let payload = events
    .map((e) => `data: ${JSON.stringify(e)}\n\n`)
    .join("");
  // Optionally drop the final blank line to simulate a terminal event that
  // arrives without a trailing \n\n.
  if (!trailingBlankLine) payload = payload.replace(/\n\n$/, "");

  const bytes = new TextEncoder().encode(payload);
  const chunks: Uint8Array[] = [];
  if (splitEvery && splitEvery > 0) {
    for (let i = 0; i < bytes.length; i += splitEvery) {
      chunks.push(bytes.slice(i, i + splitEvery));
    }
  } else {
    chunks.push(bytes);
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
}

describe("consumeVoiceStream", () => {
  it("returns the cleaned text from a delta + done sequence", async () => {
    const result = await consumeVoiceStream(
      sseStream([
        { type: "delta", delta: "hello " },
        { type: "delta", delta: "there" },
        {
          type: "done",
          cleaned: "hello there",
          transcript: "hello there",
          cleanupSkipped: false,
        },
      ])
    );
    expect(result.transcript).toBe("hello there");
    expect(result.shortened).toBeNull();
    expect(result.cleanupSkipped).toBe(false);
    expect(result.errored).toBe(false);
  });

  it("prefers the final `done.cleaned` over accumulated deltas", async () => {
    const result = await consumeVoiceStream(
      sseStream([
        { type: "delta", delta: "raw partial" },
        { type: "done", cleaned: "final cleaned text", transcript: "raw" },
      ])
    );
    expect(result.transcript).toBe("final cleaned text");
  });

  it("resolves empty (no error) when the transcript is empty silence", async () => {
    const result = await consumeVoiceStream(
      sseStream([
        {
          type: "done",
          cleaned: "",
          transcript: "",
          cleanupSkipped: true,
        },
      ])
    );
    expect(result.transcript).toBe("");
    expect(result.errored).toBe(false);
  });

  it("does not throw on an SSE body (the .json() bug regression)", async () => {
    // The original bug was `await resp.json()` on this exact shape throwing
    // 'Unexpected token d, "data: {..."'. Assert the consumer handles it.
    await expect(
      consumeVoiceStream(
        sseStream([{ type: "done", cleaned: "ok", transcript: "ok" }])
      )
    ).resolves.toMatchObject({ transcript: "ok" });
  });

  it("surfaces shortened only when it differs from the transcript", async () => {
    const result = await consumeVoiceStream(
      sseStream([
        { type: "shortened", shortened: "short ver" },
        {
          type: "done",
          cleaned: "the full long cleaned transcript",
          transcript: "the full long cleaned transcript",
        },
      ])
    );
    expect(result.shortened).toBe("short ver");
  });

  it("drops shortened when it equals the cleaned transcript", async () => {
    const result = await consumeVoiceStream(
      sseStream([
        { type: "shortened", shortened: "same text" },
        { type: "done", cleaned: "same text", transcript: "same text" },
      ])
    );
    expect(result.shortened).toBeNull();
  });

  it("flags cleanupSkipped from the done event", async () => {
    const result = await consumeVoiceStream(
      sseStream([
        {
          type: "done",
          cleaned: "うん",
          transcript: "うん",
          cleanupSkipped: true,
        },
      ])
    );
    expect(result.transcript).toBe("うん");
    expect(result.cleanupSkipped).toBe(true);
  });

  it("reports errored=true on an explicit error event", async () => {
    const result = await consumeVoiceStream(
      sseStream([
        { type: "error", code: "STREAM_FAILED", message: "boom" },
      ])
    );
    expect(result.errored).toBe(true);
    expect(result.transcript).toBe("");
  });

  it("handles an event split across read() boundaries", async () => {
    // Chunk the payload into tiny slices so a single `data:` frame straddles
    // multiple reads — exercises the partial-buffer carry-over.
    const result = await consumeVoiceStream(
      sseStream(
        [
          { type: "delta", delta: "abc" },
          { type: "done", cleaned: "abc def", transcript: "abc def" },
        ],
        { splitEvery: 7 }
      )
    );
    expect(result.transcript).toBe("abc def");
  });

  it("handles a terminal event with no trailing blank line", async () => {
    const result = await consumeVoiceStream(
      sseStream(
        [{ type: "done", cleaned: "tail", transcript: "tail" }],
        { trailingBlankLine: false }
      )
    );
    expect(result.transcript).toBe("tail");
  });

  it("ignores a malformed event and still completes", async () => {
    // Hand-build a stream with one garbage frame between valid ones.
    const payload =
      `data: {"type":"delta","delta":"good"}\n\n` +
      `data: {not valid json\n\n` +
      `data: {"type":"done","cleaned":"good","transcript":"good"}\n\n`;
    const bytes = new TextEncoder().encode(payload);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
    const result = await consumeVoiceStream(stream);
    expect(result.transcript).toBe("good");
    expect(result.errored).toBe(false);
  });
});
