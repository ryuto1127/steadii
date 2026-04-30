import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import {
  BUCKETS,
  RateLimitError,
  enforceRateLimit,
  rateLimitResponse,
} from "@/lib/utils/rate-limit";
import { openai } from "@/lib/integrations/openai/client";
import { cleanupTranscript, shortenTranscript } from "@/lib/voice/cleanup";

// Recordings at or above this threshold get a second Mini pass that
// produces a shorter version. The client surfaces a two-option chooser
// (full vs short). Below the threshold we skip the extra call — short
// clips don't need summarizing.
const SHORTEN_DURATION_THRESHOLD_SEC = 30;

// Whisper hard cap. Anything bigger gets rejected before we touch OpenAI.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
// A 25MB cap doubles as a runtime safety net; we also gate on duration in
// the client. Voice clips at α scale are sub-30s so this is huge headroom.
const ACCEPTED_MIME_PREFIX = "audio/";

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
  // Read here so the param is observable during request inspection; no
  // schema column persists it yet.
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

  if (!transcript.trim()) {
    return NextResponse.json({
      cleaned: "",
      transcript: "",
      durationSec,
      cleanupSkipped: true,
    });
  }

  let cleaned = transcript;
  let cleanupSkipped = false;
  try {
    const result = await cleanupTranscript({
      userId,
      transcript,
      chatId,
    });
    cleaned = result.cleaned || transcript;
  } catch {
    cleanupSkipped = true;
  }

  // Second pass for long clips: produce a tighter summary the client can
  // offer alongside the full version. Soft-fail — if this errors we just
  // omit `shortened` and the client falls through to the normal "insert
  // cleaned text" path.
  let shortened: string | undefined;
  if (durationSec >= SHORTEN_DURATION_THRESHOLD_SEC && cleaned.trim()) {
    try {
      const result = await shortenTranscript({
        userId,
        cleaned,
        chatId,
      });
      const candidate = result.shortened.trim();
      // Only surface the chooser if the model actually condensed something.
      // If the shorten pass returned the same text (rule #4: "already
      // concise → return unchanged"), drop it so the client doesn't show
      // a useless two-option pill.
      if (candidate && candidate !== cleaned.trim()) {
        shortened = candidate;
      }
    } catch (err) {
      console.warn("voice shorten pass failed", err);
    }
  }

  return NextResponse.json({
    cleaned,
    transcript,
    durationSec,
    cleanupSkipped,
    ...(shortened ? { shortened } : {}),
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
