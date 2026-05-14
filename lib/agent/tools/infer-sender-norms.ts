import "server-only";
import { z } from "zod";
import {
  inferSenderWorkingHours,
  type SenderWorkingHoursInference,
} from "@/lib/agent/email/sender-norms";
import type { ToolExecutor } from "./types";

// engineer-56 — chat tool wrapping the sender-norms heuristic. Mirrors
// the surface of `infer_sender_timezone` (engineer-45 / PR #226). The
// agent calls this BEFORE drafting a counter-proposal so the proposed
// window respects the sender's day, not just the user's. Bidirectional
// intersection happens in the prompt's COUNTER-PROPOSAL PATTERN rule 3.

const args = z.object({
  senderEmail: z
    .string()
    .min(3)
    .max(254)
    .describe(
      "The sender's email address (e.g. 'recruiter@acme-travel.example.co.jp'). Used for TLD-based norm inference + sender TZ resolution."
    ),
  body: z
    .string()
    .max(8000)
    .nullable()
    .optional()
    .describe(
      "Optional email body. Body language (JP / KO / etc.) augments the domain signal for generic-domain senders. Pass the parent email body when available."
    ),
});

export type InferSenderNormsResult = SenderWorkingHoursInference & {
  reasoning: string;
  // Disclosure guidance — TRUE when the prompt MUST surface the
  // assumption to the user (confidence < 0.7). The agent should treat
  // this as a hint, not a hard rule; mid-confidence senders benefit from
  // a one-line "treating their hours as 9–18 JST by default".
  shouldDisclose: boolean;
};

export const inferSenderNormsTool: ToolExecutor<
  z.input<typeof args>,
  InferSenderNormsResult
> = {
  schema: {
    name: "infer_sender_norms",
    description:
      "Infer the sender's likely working hours from their email domain + optional body language. Returns {start, end, tz, confidence, source, reasoning, shouldDisclose}. Use when drafting a counter-proposal so your proposed window respects the sender's day, not just the user's — bidirectional intersection is the COUNTER-PROPOSAL PATTERN rule 3 requirement. Confidence drives disclosure: ≥ 0.7 = use silently; 0.4–0.7 = use AND surface the assumption ('I assumed their working hours are around 9 AM – 6 PM JST'); < 0.4 = generic fallback, definitely disclose. Heuristic buckets: JP business (.co.jp / JA body) → 09:00–18:00 Asia/Tokyo @ 0.9; government → 09:00–17:00 @ 0.9; academic (.edu / .ac.jp) → 09:00–18:00 @ 0.6 (wider for profs); business via inferred TZ → 09:00–17:00 @ 0.7; generic fallback → 09:00–18:00 @ 0.4.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        senderEmail: {
          type: "string",
          description: "Sender's email address.",
        },
        body: {
          type: ["string", "null"],
          description:
            "Optional email body. Improves accuracy when domain is generic.",
        },
      },
      required: ["senderEmail"],
      additionalProperties: false,
    },
  },
  async execute(_ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const result = inferSenderWorkingHours({
      senderEmail: parsed.senderEmail,
      body: parsed.body ?? null,
    });
    return {
      ...result,
      reasoning: buildReasoning(parsed.senderEmail, result),
      shouldDisclose: result.confidence < 0.7,
    };
  },
};

export const INFER_SENDER_NORMS_TOOLS = [inferSenderNormsTool];

function buildReasoning(
  senderEmail: string,
  inf: SenderWorkingHoursInference
): string {
  const pct = Math.round(inf.confidence * 100);
  const window = `${inf.start}–${inf.end} ${inf.tz}`;
  if (inf.source.startsWith("domain:co.jp")) {
    return `${senderEmail} is on a .co.jp domain → JP business norms (${window}, ${pct}% confidence). Use this window silently in your counter-proposal.`;
  }
  if (inf.source.startsWith("domain:ne.jp") || inf.source.startsWith("domain:or.jp")) {
    return `${senderEmail} is on a Japanese business domain → ${window} (${pct}% confidence).`;
  }
  if (inf.source.startsWith("body-lang:ja")) {
    return `${senderEmail}'s domain is generic but the body is heavily Japanese → JP business norms (${window}, ${pct}% confidence).`;
  }
  if (inf.source.startsWith("domain:go.jp") || inf.source.startsWith("domain:gov")) {
    return `${senderEmail} is a government domain → strict business hours (${window}, ${pct}% confidence).`;
  }
  if (inf.source.startsWith("domain:edu") || inf.source.startsWith("domain:ac.")) {
    return `${senderEmail} is an academic domain → professor-style window (${window}, ${pct}% confidence — wider; profs may work outside this range). Surface the assumption to the user.`;
  }
  if (inf.source.startsWith("tz-inferred:")) {
    return `${senderEmail} → ${window} (${pct}% confidence, business norms in inferred TZ).`;
  }
  return `${senderEmail} → ${window} (${pct}% confidence, generic fallback — disclose the assumption to the user before using).`;
}
