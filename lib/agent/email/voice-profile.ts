import "server-only";
import * as Sentry from "@sentry/nextjs";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import { getGmailForUser } from "@/lib/integrations/google/gmail";
import { extractEmailBody } from "./body-extract";

// engineer-38 — one-shot voice extraction. Reads up to 50 of the user's
// most recent sent messages, joins the bodies into a single LLM input,
// and returns a 200-character description of register / language mix /
// length / signature pattern. The result is persisted to
// users.preferences.voiceProfile and injected into every L2 draft prompt
// as the cold-start anchor for first-time senders. Sender-history (when
// present) overrides this for sender-specific style.
//
// Cost ceiling: ~10K chars of context + 200 chars output on GPT-5.4 ≈
// $0.05/run. Onboarding-only + manual re-trigger keeps lifetime spend
// trivial. Voice profile auto-refresh on schedule is intentionally
// out-of-scope (handoff §"Out of scope").

const SAMPLE_SIZE = 50;
const MIN_BODY_LINES = 3;
const MAX_INPUT_CHARS = 10_000;
const MAX_PROFILE_CHARS = 200;

export type GenerateVoiceProfileResult = {
  profile: string;
  // Number of sent messages that survived the >=3-line filter and
  // contributed to the LLM input. Surfaced for tests + audit; the user
  // never sees this number.
  sampleCount: number;
  usageId: string | null;
};

export class VoiceProfileNotEnoughSamplesError extends Error {
  constructor(public readonly available: number) {
    super(
      `Not enough sent-mail samples to extract voice profile (got ${available})`
    );
    this.name = "VoiceProfileNotEnoughSamplesError";
  }
}

export async function generateVoiceProfile(
  userId: string
): Promise<GenerateVoiceProfileResult> {
  return Sentry.startSpan(
    {
      name: "email.voice_profile.generate",
      op: "gen_ai.generate",
      attributes: {
        "steadii.user_id": userId,
        "steadii.task_type": "email_draft",
      },
    },
    async () => {
      const samples = await fetchRecentSentBodies(userId);
      if (samples.length < 3) {
        throw new VoiceProfileNotEnoughSamplesError(samples.length);
      }

      const corpus = joinSamples(samples).slice(0, MAX_INPUT_CHARS);
      const model = selectModel("email_draft");
      const resp = await openai().chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: corpus },
        ],
        // Voice profile is ~30-50 tokens output; cap loose to avoid
        // truncating unusual long descriptions.
        max_tokens: 200,
      });

      const raw = resp.choices[0]?.message?.content ?? "";
      const profile = sanitizeProfile(raw);

      const rec = await recordUsage({
        userId,
        model,
        taskType: "email_draft",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as {
            prompt_tokens_details?: { cached_tokens?: number };
          })?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      await persistVoiceProfile(userId, profile);

      return {
        profile,
        sampleCount: samples.length,
        usageId: rec.usageId,
      };
    }
  );
}

const SYSTEM_PROMPT = `Summarize this user's writing style across the sent emails below.

Output a single 200-character description that captures:
- register (formal / casual / mixed by recipient)
- language mix (English / Japanese / mixed; default register language)
- typical length (one-paragraph / multi-paragraph / bullets)
- signature pattern (name only / "Best, name" / no signature / etc.)
- tone (warm / direct / formal / playful)

The description is injected as a single line into draft-generation prompts. Return as raw string, no markdown, no quotes around the output, no preamble. Do NOT exceed 200 characters.`;

async function fetchRecentSentBodies(userId: string): Promise<string[]> {
  const gmail = await getGmailForUser(userId);
  const list = await gmail.users.messages.list({
    userId: "me",
    q: "in:sent",
    maxResults: SAMPLE_SIZE,
  });
  const ids = (list.data.messages ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);

  const out: string[] = [];
  // Sequential fetch keeps us inside Gmail's per-second quota for a
  // single-user one-shot. Parallelizing here would burn quota for
  // negligible wallclock gain (the LLM call dominates total time).
  for (const id of ids) {
    try {
      const msg = await gmail.users.messages.get({
        userId: "me",
        id,
        format: "full",
      });
      const body = extractEmailBody(msg.data).text;
      const cleaned = stripQuotedReplies(body);
      const lineCount = cleaned.split(/\r?\n/).filter((l) => l.trim().length > 0)
        .length;
      // Filter out forwards and very-short replies — those are noise for
      // voice extraction. The threshold is lenient (3 substantive lines)
      // because real user voice often shows up in 4-line replies.
      if (lineCount < MIN_BODY_LINES) continue;
      if (/^[\s>]*-+\s*Forwarded message\s*-+/im.test(cleaned)) continue;
      out.push(cleaned);
    } catch (err) {
      Sentry.captureException(err, {
        level: "warning",
        tags: { feature: "voice_profile", op: "gmail_get" },
        user: { id: userId },
      });
    }
  }
  return out;
}

function stripQuotedReplies(body: string): string {
  // Drop everything from the first `>` reply marker or the standard
  // "On <date>, <name> wrote:" header onward. This is rough but enough
  // to strip the bulk of quoted predecessors so the LLM sees the user's
  // own writing.
  const idx = body.search(/^(?:>+|On .+ wrote:)/m);
  if (idx >= 0) return body.slice(0, idx).trim();
  return body.trim();
}

function joinSamples(samples: string[]): string {
  return samples.map((s, i) => `--- email ${i + 1} ---\n${s}`).join("\n\n");
}

function sanitizeProfile(raw: string): string {
  const trimmed = raw.replace(/^\s*["']|["']\s*$/g, "").trim();
  return trimmed.slice(0, MAX_PROFILE_CHARS);
}

export async function persistVoiceProfile(
  userId: string,
  profile: string
): Promise<void> {
  const merge = sql`COALESCE(${users.preferences}, '{}'::jsonb) || ${JSON.stringify(
    { voiceProfile: profile }
  )}::jsonb`;
  await db
    .update(users)
    .set({ preferences: merge, updatedAt: new Date() })
    .where(eq(users.id, userId));
}
