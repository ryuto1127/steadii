import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  BUCKETS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { openai } from "@/lib/integrations/openai/client";
import { shortenTranscript, streamCleanupTranscript } from "@/lib/voice/cleanup";

// Recordings at or above this threshold get a second Nano pass that
// produces a shorter version. The client surfaces a two-option chooser
// (full vs short). Below the threshold we skip the extra call — short
// clips don't need summarizing.
const SHORTEN_DURATION_THRESHOLD_SEC = 30;

// Whisper hard cap. Anything bigger gets rejected before we touch OpenAI.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// A 25MB cap doubles as a runtime safety net; we also gate on duration in
// the client. Voice clips at α scale are sub-30s so this is huge headroom.
const ACCEPTED_MIME_PREFIX = "audio/";

// Skip the cleanup model entirely for transcripts under this many
// non-whitespace characters. "うん", "はい", "OK" round-trip in ~Whisper
// time only — cleanup has nothing to add to a 2-character transcript.
const CLEANUP_SKIP_NONWS_CHARS = 10;

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    enforceRateLimit(userId, "voice", BUCKETS.voice);
  } catch (err) {
    if (err instanceof RateLimitError) return rateLimitResponse(err);
    throw err;
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid multipart payload" },
      { status: 400 }
    );
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob)) {
    return NextResponse.json(
      { error: "missing audio blob" },
      { status: 400 }
    );
  }
  if (audio.size === 0) {
    return NextResponse.json({ error: "empty audio" }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "audio too large (25MB max)" },
      { status: 413 }
    );
  }
  if (audio.type && !audio.type.startsWith(ACCEPTED_MIME_PREFIX)) {
    return NextResponse.json(
      { error: "unsupported audio type" },
      { status: 415 }
    );
  }

  const chatIdRaw = form.get("chatId");
  const chatId =
    typeof chatIdRaw === "string" && chatIdRaw.length > 0 ? chatIdRaw : null;
  // Phase 3: clients tag the surface that triggered the recording so server
  // analytics can later split chat-input vs global-hotkey usage. Cleanup
  // behavior is identical regardless — `surface` is purely a routing hint.
  const _surface = form.get("surface");
  void _surface;

  // The Whisper SDK accepts a File-like; the multipart File from FormData
  // already satisfies the contract, but we re-wrap so the upstream filename
  // hint is consistent (some browsers emit "blob" with no extension).
  const filename =
    audio instanceof File && audio.name && audio.name !== "blob"
      ? audio.name
      : "voice.webm";
  const file = new File([audio], filename, {
    type: audio.type || "audio/webm",
  });

  let transcript: string;
  try {
    const tx = await openai().audio.transcriptions.create({
      file,
      model: "whisper-1",
      response_format: "json",
    });
    transcript = tx.text ?? "";
  } catch (err) {
    return NextResponse.json(
      {
        error: "transcription failed",
        code: "WHISPER_FAILED",
        message: err instanceof Error ? err.message : "unknown",
      },
      { status: 502 }
    );
  }

  const durationSec = estimateDurationSec(audio.size);

  // SSE response — the client reads `delta`, then `shortened` (optional),
  // then `done`. Order is guaranteed.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(event)}\n\n`)
        );
      };

      try {
        if (!transcript.trim()) {
          send({
            type: "done",
            cleaned: "",
            transcript: "",
            durationSec,
            cleanupSkipped: true,
          });
          controller.close();
          return;
        }

        // Short-transcript skip path — instant return for 1-2 word answers
        // so "うん" / "はい" / "OK" don't pay the Nano round trip.
        const nonWs = transcript.replace(/\s/g, "").length;
        if (nonWs < CLEANUP_SKIP_NONWS_CHARS) {
          send({
            type: "done",
            cleaned: transcript,
            transcript,
            durationSec,
            cleanupSkipped: true,
          });
          controller.close();
          return;
        }

        let cleaned = transcript;
        let cleanupSkipped = false;
        try {
          for await (const ev of streamCleanupTranscript({
            userId,
            transcript,
            chatId,
          })) {
            if (ev.type === "delta") {
              send({ type: "delta", delta: ev.delta });
            } else if (ev.type === "done") {
              cleaned = ev.cleaned || transcript;
            }
          }
        } catch (err) {
          cleanupSkipped = true;
          console.warn("voice cleanup stream failed", err);
          // Fall through with raw transcript so the chooser/insertion still
          // works with the user's actual words.
          send({ type: "delta", delta: transcript });
        }

        // Second pass for long clips: produce a tighter summary the client
        // can offer alongside the full version. Soft-fail — if this errors
        // we just omit `shortened`.
        let shortened: string | undefined;
        if (durationSec >= SHORTEN_DURATION_THRESHOLD_SEC && cleaned.trim()) {
          try {
            const result = await shortenTranscript({
              userId,
              cleaned,
              chatId,
            });
            const candidate = result.shortened.trim();
            if (candidate && candidate !== cleaned.trim()) {
              shortened = candidate;
              send({ type: "shortened", shortened });
            }
          } catch (err) {
            console.warn("voice shorten pass failed", err);
          }
        }

        send({
          type: "done",
          cleaned,
          transcript,
          durationSec,
          cleanupSkipped,
          ...(shortened ? { shortened } : {}),
        });
        controller.close();
      } catch (err) {
        send({
          type: "error",
          code: "STREAM_FAILED",
          message: err instanceof Error ? err.message : "Unknown error",
        });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

// Rough byte→seconds estimate for opus/webm at typical mic-capture bitrates
// (~32 kbps mono). Used only for analytics surfacing in the response — the
// authoritative duration would require decoding the container, and we don't
// store this in usage_events at α (no metadata column).
function estimateDurationSec(bytes: number): number {
  const BITS_PER_SEC = 32_000;
  return Math.max(0, Math.round((bytes * 8) / BITS_PER_SEC));
}
