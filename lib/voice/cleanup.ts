import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import {
  VOICE_CLEANUP_SYSTEM_PROMPT,
  VOICE_SHORTEN_SYSTEM_PROMPT,
  buildCleanupUserMessage,
  buildShortenUserMessage,
} from "./cleanup-prompt";
import {
  buildVoiceContextSystemMessage,
  fetchVoiceUserContext,
  type VoiceUserContext,
} from "./user-context";

// Caps on the cleanup pass. Whisper transcripts of voice clips at α scale
// are short (< 30s typically), so 4000 chars covers the long tail and
// keeps the Mini call cheap if someone holds the trigger longer than
// expected.
const MAX_TRANSCRIPT_CHARS = 4000;

export type CleanupResult = {
  cleaned: string;
  usageId: string | null;
};

export async function cleanupTranscript(args: {
  userId: string;
  transcript: string;
  chatId?: string | null;
  // Test-only override. Production callers omit this; the function fetches
  // the user's classes + recent chat titles itself so callers don't have
  // to plumb DB access.
  userContext?: VoiceUserContext;
}): Promise<CleanupResult> {
  const trimmed = args.transcript.trim();
  if (!trimmed) return { cleaned: "", usageId: null };

  const transcript =
    trimmed.length > MAX_TRANSCRIPT_CHARS
      ? trimmed.slice(0, MAX_TRANSCRIPT_CHARS)
      : trimmed;

  // Universal prompt is the stable cacheable prefix. The per-user context
  // is appended as a SEPARATE system message so OpenAI's auto-cache keeps
  // working on the prefix even as classes/chats churn. When the user has
  // no context (new account, no titled chats), we skip the second message
  // entirely — the single-system-message fast path still caches.
  const userContext =
    args.userContext ?? (await fetchVoiceUserContext(args.userId));
  const contextMessage = buildVoiceContextSystemMessage(userContext);

  const messages: Array<{ role: "system" | "user"; content: string }> = [
    { role: "system", content: VOICE_CLEANUP_SYSTEM_PROMPT },
  ];
  if (contextMessage) {
    messages.push({ role: "system", content: contextMessage });
  }
  messages.push({ role: "user", content: buildCleanupUserMessage(transcript) });

  const model = selectModel("voice_cleanup");
  const resp = await openai().chat.completions.create({
    model,
    messages,
    temperature: 0.2,
  });

  const trimmedReply = resp.choices[0]?.message?.content?.trim() ?? "";
  const cleaned = trimmedReply.length > 0 ? trimmedReply : transcript;

  const rec = await recordUsage({
    userId: args.userId,
    chatId: args.chatId ?? null,
    model,
    taskType: "voice_cleanup",
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
    cachedTokens:
      (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
        ?.prompt_tokens_details?.cached_tokens ?? 0,
  });

  return { cleaned, usageId: rec.usageId };
}

// Second pass for long recordings (>30s) — produces a shorter version of
// the already-cleaned transcript so the user can pick full vs. summary
// before sending. Routes the same `voice_cleanup` task type as the main
// cleanup; analytics rolls them up together. Failure here is soft — the
// caller treats absence as "no shorten available" and falls back to full.
export async function shortenTranscript(args: {
  userId: string;
  cleaned: string;
  chatId?: string | null;
}): Promise<{ shortened: string; usageId: string | null }> {
  const trimmed = args.cleaned.trim();
  if (!trimmed) return { shortened: "", usageId: null };

  const input =
    trimmed.length > MAX_TRANSCRIPT_CHARS
      ? trimmed.slice(0, MAX_TRANSCRIPT_CHARS)
      : trimmed;

  const model = selectModel("voice_cleanup");
  const resp = await openai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: VOICE_SHORTEN_SYSTEM_PROMPT },
      { role: "user", content: buildShortenUserMessage(input) },
    ],
    temperature: 0.2,
  });

  const reply = resp.choices[0]?.message?.content?.trim() ?? "";
  const shortened = reply.length > 0 ? reply : input;

  const rec = await recordUsage({
    userId: args.userId,
    chatId: args.chatId ?? null,
    model,
    taskType: "voice_cleanup",
    inputTokens: resp.usage?.prompt_tokens ?? 0,
    outputTokens: resp.usage?.completion_tokens ?? 0,
    cachedTokens:
      (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
        ?.prompt_tokens_details?.cached_tokens ?? 0,
  });

  return { shortened, usageId: rec.usageId };
}
