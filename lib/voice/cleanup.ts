import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import {
  VOICE_CLEANUP_SYSTEM_PROMPT,
  buildCleanupUserMessage,
} from "./cleanup-prompt";

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
}): Promise<CleanupResult> {
  const trimmed = args.transcript.trim();
  if (!trimmed) return { cleaned: "", usageId: null };

  const transcript =
    trimmed.length > MAX_TRANSCRIPT_CHARS
      ? trimmed.slice(0, MAX_TRANSCRIPT_CHARS)
      : trimmed;

  const model = selectModel("voice_cleanup");
  const resp = await openai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: VOICE_CLEANUP_SYSTEM_PROMPT },
      { role: "user", content: buildCleanupUserMessage(transcript) },
    ],
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
