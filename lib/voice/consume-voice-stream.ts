// Shared consumer for the `/api/voice` SSE response stream.
//
// `/api/voice` (app/api/voice/route.ts) ALWAYS responds with
// `text/event-stream` — a sequence of `data: {json}\n\n` events:
//   - { type: "delta", delta }          — incremental cleaned-transcript chunks
//   - { type: "shortened", shortened }   — optional tighter summary for long clips
//   - { type: "done", cleaned, transcript, cleanupSkipped, ... } — terminal
//   - { type: "error", code, message }   — stream-side failure
//
// Calling `.json()` on this body throws ("Unexpected token 'd', "data: {..."),
// which is exactly the bug this helper exists to prevent. Both the chat
// composer (components/chat/use-voice-input.ts) and the global voice handler
// (components/voice/voice-app-provider.tsx) consume the stream through this
// one function so their parsing can never drift apart again.

export type VoiceStreamResult = {
  // Final cleaned transcript, trimmed. Empty string = the user produced no
  // usable speech (silence / Whisper returned nothing). Callers should treat
  // an empty transcript as a silent no-op, NOT as an error.
  transcript: string;
  // Tighter summary offered for long clips, if the route produced one and it
  // differs from the full transcript. `null` when absent.
  shortened: string | null;
  // True when the cleanup model was skipped/failed and the raw Whisper
  // transcript was passed through. The transcript is still usable; callers
  // may surface a soft "cleanup unavailable" hint.
  cleanupSkipped: boolean;
  // True when the stream emitted an explicit `error` event. This is a genuine
  // failure (distinct from an empty transcript) and callers should surface an
  // error to the user.
  errored: boolean;
};

type VoiceStreamEvent = {
  type: string;
  delta?: string;
  cleaned?: string;
  transcript?: string;
  shortened?: string;
  cleanupSkipped?: boolean;
  code?: string;
  message?: string;
};

/**
 * Reads a `/api/voice` SSE Response body to completion and resolves to the
 * final cleaned transcript plus stream metadata. Never throws on a
 * well-formed-but-empty result; malformed individual events are ignored.
 *
 * Pass a Response whose `.ok` is already true and whose `.body` is non-null —
 * HTTP-level failures (non-200, missing body) are the caller's concern and
 * are NOT represented as `errored` here.
 */
export async function consumeVoiceStream(
  body: ReadableStream<Uint8Array>
): Promise<VoiceStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  // Accumulators mirror the route's event contract.
  let deltaCleaned = "";
  let cleanedFinal: string | null = null;
  let transcriptFallback = "";
  let shortened: string | null = null;
  let cleanupSkipped = false;
  let errored = false;

  const handleEvent = (payload: VoiceStreamEvent) => {
    if (payload.type === "delta" && typeof payload.delta === "string") {
      deltaCleaned += payload.delta;
    } else if (
      payload.type === "shortened" &&
      typeof payload.shortened === "string"
    ) {
      shortened = payload.shortened;
    } else if (payload.type === "done") {
      cleanedFinal = payload.cleaned ?? deltaCleaned ?? payload.transcript ?? "";
      transcriptFallback = payload.transcript ?? "";
      cleanupSkipped = !!payload.cleanupSkipped;
    } else if (payload.type === "error") {
      errored = true;
    }
  };

  const drainBuffer = (final: boolean) => {
    // SSE events are separated by a blank line (\n\n). On non-final flushes we
    // hold back the trailing partial chunk in `buf`; on the final flush every
    // remaining part is complete (a `done`/`error` event may arrive without a
    // terminating blank line).
    const parts = buf.split("\n\n");
    buf = final ? "" : (parts.pop() ?? "");
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      try {
        handleEvent(JSON.parse(line.slice(5).trim()) as VoiceStreamEvent);
      } catch {
        // Ignore a malformed individual event; the stream may still complete.
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    drainBuffer(false);
  }
  // Flush any trailing bytes + a final event with no terminating blank line.
  buf += decoder.decode();
  drainBuffer(true);

  const transcript = (cleanedFinal ?? deltaCleaned ?? transcriptFallback).trim();
  // Only surface `shortened` when it actually differs from what we'd insert.
  const usableShortened =
    shortened && shortened !== transcript ? shortened : null;

  return {
    transcript,
    shortened: usableShortened,
    cleanupSkipped,
    errored,
  };
}
