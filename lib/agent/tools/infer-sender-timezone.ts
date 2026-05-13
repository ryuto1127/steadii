import "server-only";
import { z } from "zod";
import {
  inferSenderTimezone,
  type SenderTimezoneInference,
} from "@/lib/agent/email/sender-timezone-heuristic";
import type { ToolExecutor } from "./types";

// 2026-05-12 (sparring inline post-engineer-51) — chat tool wrapping the
// existing inferSenderTimezone heuristic. Previously this lived only
// inside the agentic L2 pipeline; the chat orchestrator had no way to
// call it on-demand, so when a user asked "I'm in Vancouver — what
// about the TZ?" the chat agent had to LLM-guess. Dogfood transcript
// 2026-05-12 showed two failures:
//   1. Initial response cited email slots without TZ annotation
//      because the agent never inferred the sender's TZ.
//   2. When prompted, agent converted in the WRONG direction (assumed
//      slots were in the user's local TZ instead of the sender's).
//
// Exposing the heuristic as a tool with both domain + body signal
// means the agent can deterministically decide "this email is from a
// JP company → times are JST by default" — no LLM guessing.
//
// The heuristic combines domain match (.co.jp → Asia/Tokyo @ 0.95) +
// body-language detection (≥30% Japanese characters → Asia/Tokyo @
// 0.8). When both signals agree, confidence boosts to 0.98.

const args = z.object({
  senderEmail: z
    .string()
    .min(3)
    .max(254)
    .describe(
      "The sender's email address (e.g. 'recruiter@reiwa-travel.co.jp'). Used for TLD-based TZ inference."
    ),
  emailBody: z
    .string()
    .max(8000)
    .optional()
    .describe(
      "Optional email body content. If provided, body language detection augments the domain signal — useful for JP companies sending from generic domains like gmail.com or .com."
    ),
});

export type InferSenderTimezoneResult = SenderTimezoneInference & {
  // Human-readable reasoning the agent can quote back to the user
  // verbatim ("This email is from a .co.jp domain, so I'm assuming JST")
  // so the inference stays glass-box.
  reasoning: string;
};

export const inferSenderTimezoneTool: ToolExecutor<
  z.input<typeof args>,
  InferSenderTimezoneResult
> = {
  schema: {
    name: "infer_sender_timezone",
    description:
      "Infer the most likely timezone of an email sender from their email address (domain) + optional body content. Use this whenever you're about to present times from an email to the user — knowing the sender's TZ is required to render slots correctly. Returns an IANA timezone name (e.g. 'Asia/Tokyo'), a confidence 0..1, and a reasoning string you should quote verbatim to the user when explaining the inference. The heuristic combines: (1) sender's email domain (.co.jp → Asia/Tokyo @ 0.95, .ac.uk → Europe/London @ 0.9, etc.), (2) email body language detection (≥15% Japanese characters → Asia/Tokyo @ 0.8). When both agree, confidence boosts to 0.98. Returns `tz: null` when nothing reliable can be inferred (multi-TZ countries like .ca, .us, .au, or generic domains with English-only bodies). Call this BEFORE `convert_timezone` when working with email-sourced times — it tells you which TZ the email times are anchored in.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        senderEmail: {
          type: "string",
          description: "Sender's email address.",
        },
        emailBody: {
          type: "string",
          description:
            "Optional email body. Improves accuracy when the domain is generic (gmail.com, .com).",
        },
      },
      required: ["senderEmail"],
      additionalProperties: false,
    },
  },
  async execute(_ctx, rawArgs) {
    const parsed = args.parse(rawArgs);
    const domain = parsed.senderEmail.includes("@")
      ? parsed.senderEmail.split("@").pop() ?? null
      : null;
    const result = inferSenderTimezone({
      domain,
      body: parsed.emailBody ?? null,
    });

    const reasoning = buildReasoning(parsed.senderEmail, result);
    return { ...result, reasoning };
  },
};

export const INFER_SENDER_TIMEZONE_TOOLS = [inferSenderTimezoneTool];

function buildReasoning(
  senderEmail: string,
  inference: SenderTimezoneInference
): string {
  if (!inference.tz) {
    return `Cannot reliably infer the sender's timezone from ${senderEmail}${
      inference.source ? ` (${inference.source})` : ""
    }. Ask the user which TZ the email's times are in, or look for explicit markers (JST/PT/GMT/etc.) in the body.`;
  }
  const pct = Math.round(inference.confidence * 100);
  if (inference.source?.startsWith("tld:")) {
    return `${senderEmail} is on a ${inference.source.replace(
      "tld:",
      "."
    )} domain → ${inference.tz} (${pct}% confidence).`;
  }
  if (inference.source?.startsWith("body-lang:")) {
    return `${senderEmail}'s domain is generic but the email body is heavily ${inference.source.replace(
      "body-lang:",
      ""
    )} → ${inference.tz} (${pct}% confidence).`;
  }
  if (inference.source?.includes("+")) {
    return `${senderEmail}: both the domain and the email body language point to ${inference.tz} (${pct}% confidence — both signals agree).`;
  }
  return `${senderEmail} → ${inference.tz} (${pct}% confidence, ${inference.source ?? "unknown source"}).`;
}
