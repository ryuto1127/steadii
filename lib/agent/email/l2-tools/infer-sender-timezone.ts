import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  agentContactPersonas,
  inboxItems,
} from "@/lib/db/schema";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { L2ToolExecutor } from "./types";

// engineer-41 — infer a contact's IANA timezone with a 3-step strategy.
//
//   1. persona_locked — agent_contact_personas.structured_facts.timezone
//      already carries a confirmedAt-stamped value → return immediately
//      at confidence 1.0. Free read of a previously-confirmed user
//      answer; never blows budget on a re-inference for a settled case.
//   2. calendar_offset_inference — look at the trailing 28 days of
//      inbound emails from this sender, compute the modal hour-of-day
//      they hit our user's inbox (Gmail received_at is the recipient's
//      local clock as long as the user's IANA is set). If there's a
//      tight cluster around business hours, infer an offset that puts
//      the cluster in 9-18. This is the cheapest signal we have that
//      doesn't burn an LLM call.
//   3. llm_body_analysis — last resort. Hand the email body + sender
//      domain to mini and ask for an inference. Empty / low-confidence
//      callers can then queue_user_confirmation.

const SAMPLE_DAYS = 28;
const SAMPLE_MIN = 4; // below this, the calendar pattern is too noisy

export type InferSenderTimezoneArgs = {
  contactEmail: string;
  body?: string | null;
};

export type InferSenderTimezoneResult = {
  timezone: string | null; // IANA when known, null when truly uncertain
  confidence: number; // 0..1
  source:
    | "persona_locked"
    | "calendar_offset_inference"
    | "domain_heuristic"
    | "llm_body_analysis"
    | "unknown";
  samples: number;
};

const SYSTEM_PROMPT = `You infer the most likely IANA timezone of an email sender from the email body + their domain. Return JSON: { "timezone": string | null, "confidence": number 0..1, "rationale": string }.

Rules:
- "timezone" is an IANA zone ("Asia/Tokyo", "America/Los_Angeles", "Europe/London") or null when you can't infer.
- Use cues like JST / EST / PT / GMT mentions; "(月)" / "(Fri)" patterns suggesting locale; signed-time markers in quoted threads; salutation language; .ac.jp / .edu / .ac.uk domain hints.
- A bare domain (.com / .org) without other cues → null, low confidence.
- Don't guess wildly. confidence 0.9+ ONLY when the body or sender explicitly references a timezone or unambiguous regional cue.
- "rationale" is a short English sentence pointing at the cue you used.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    timezone: { type: ["string", "null"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string", maxLength: 200 },
  },
  required: ["timezone", "confidence", "rationale"],
} as const;

export const inferSenderTimezoneTool: L2ToolExecutor<
  InferSenderTimezoneArgs,
  InferSenderTimezoneResult
> = {
  schema: {
    name: "infer_sender_timezone",
    description:
      "Infer the IANA timezone of the email sender. Tries (1) persona-locked value, (2) calendar-offset inference from past inbound timestamps, then (3) an LLM body analysis as a last resort. Returns null + low confidence when uncertain — caller should queue_user_confirmation rather than guess.",
    parameters: {
      type: "object",
      properties: {
        contactEmail: { type: "string", minLength: 3 },
        body: { type: ["string", "null"] },
      },
      required: ["contactEmail"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    const email = (args.contactEmail ?? "").trim().toLowerCase();
    if (!email) {
      return {
        timezone: null,
        confidence: 0,
        source: "unknown" as const,
        samples: 0,
      };
    }

    // Step 1 — persona_locked: agent already has a confirmed answer.
    const [persona] = await db
      .select({ structuredFacts: agentContactPersonas.structuredFacts })
      .from(agentContactPersonas)
      .where(
        and(
          eq(agentContactPersonas.userId, ctx.userId),
          eq(agentContactPersonas.contactEmail, email)
        )
      )
      .limit(1);
    const lockedTz = persona?.structuredFacts?.timezone;
    if (
      lockedTz &&
      typeof lockedTz.value === "string" &&
      lockedTz.confirmedAt
    ) {
      return {
        timezone: lockedTz.value,
        confidence: 1.0,
        source: "persona_locked" as const,
        samples: lockedTz.samples ?? 0,
      };
    }

    // Step 2 — calendar_offset_inference: modal hour-of-day of inbound
    // emails from this sender over the last 28 days. Steadii's user is
    // the recipient; Gmail received_at is the recipient's UTC instant.
    // We can't recover the SENDER's clock without their TZ, but we can
    // detect when the modal hour is suspiciously offset from business
    // hours and infer an offset that snaps it into 9-18.
    const since = new Date(Date.now() - SAMPLE_DAYS * 24 * 60 * 60 * 1000);
    const recent = await db
      .select({ receivedAt: inboxItems.receivedAt })
      .from(inboxItems)
      .where(
        and(
          eq(inboxItems.userId, ctx.userId),
          eq(inboxItems.senderEmail, email),
          gte(inboxItems.receivedAt, since)
        )
      )
      .orderBy(desc(inboxItems.receivedAt))
      .limit(50);
    if (recent.length >= SAMPLE_MIN) {
      const inference = inferOffsetFromTimestamps(
        recent.map((r) => r.receivedAt)
      );
      if (inference && inference.confidence >= 0.6) {
        return {
          timezone: inference.timezone,
          confidence: inference.confidence,
          source: "calendar_offset_inference" as const,
          samples: recent.length,
        };
      }
    }

    // Step 3 — llm_body_analysis: hand body + domain to mini.
    const body = (args.body ?? "").trim();
    if (body.length < 20) {
      return {
        timezone: null,
        confidence: 0,
        source: "unknown" as const,
        samples: recent.length,
      };
    }
    const domain = email.split("@")[1] ?? "";
    const userMsg = [
      `Sender email: ${email}`,
      `Sender domain: ${domain}`,
      "",
      "=== Email body ===",
      body.slice(0, 4000),
    ].join("\n");
    const model = selectModel("email_classify_risk"); // mini
    const resp = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "infer_sender_timezone",
          strict: true,
          schema: SCHEMA,
        },
      },
    });
    await recordUsage({
      userId: ctx.userId,
      model,
      taskType: "email_classify_risk",
      inputTokens: resp.usage?.prompt_tokens ?? 0,
      outputTokens: resp.usage?.completion_tokens ?? 0,
      cachedTokens:
        (resp.usage as {
          prompt_tokens_details?: { cached_tokens?: number };
        })?.prompt_tokens_details?.cached_tokens ?? 0,
    });
    const parsed = parseLLMOutput(resp.choices[0]?.message?.content ?? "{}");
    return {
      timezone: parsed.timezone,
      confidence: parsed.confidence,
      source: parsed.timezone ? ("llm_body_analysis" as const) : ("unknown" as const),
      samples: recent.length,
    };
  },
};

function parseLLMOutput(raw: string): {
  timezone: string | null;
  confidence: number;
} {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return { timezone: null, confidence: 0 };
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const timezone =
    typeof o.timezone === "string" && o.timezone.trim().length > 0
      ? o.timezone.trim().slice(0, 64)
      : null;
  const confidence = Math.max(
    0,
    Math.min(1, typeof o.confidence === "number" ? o.confidence : 0)
  );
  return { timezone, confidence };
}

// Heuristic — given timestamps in UTC, compute UTC offset that puts the
// modal hour into 9..18. Returns an IANA zone for the offset (the
// "canonical" zone for that offset — Asia/Tokyo for +9, etc.).
// confidence reflects how tight the cluster is.
export function inferOffsetFromTimestamps(
  dates: Date[]
): { timezone: string; confidence: number } | null {
  if (dates.length < 1) return null;
  const utcHours = dates.map((d) => d.getUTCHours());
  const hist = new Array(24).fill(0);
  for (const h of utcHours) hist[h] += 1;
  let modalHour = 0;
  let modalCount = 0;
  for (let h = 0; h < 24; h++) {
    if (hist[h] > modalCount) {
      modalCount = hist[h];
      modalHour = h;
    }
  }
  // The hour that puts the modal into the middle of business hours (~13).
  const targetHour = 13;
  let offset = targetHour - modalHour;
  if (offset > 12) offset -= 24;
  if (offset <= -12) offset += 24;
  // Tightness: fraction of samples in the modal ±2 window.
  const inWindow = utcHours.filter(
    (h) =>
      (h + 24 - modalHour) % 24 <= 2 || (modalHour + 24 - h) % 24 <= 2
  ).length;
  const tightness = inWindow / utcHours.length;
  if (tightness < 0.6) return null;
  return {
    timezone: ianaForOffset(offset),
    confidence: Math.min(0.85, 0.4 + tightness * 0.5),
  };
}

// Best-guess canonical IANA name for a UTC offset. Not exhaustive — this
// is a hint for the agentic loop, not a source of truth.
function ianaForOffset(offset: number): string {
  switch (offset) {
    case 9:
      return "Asia/Tokyo";
    case 8:
      return "Asia/Shanghai";
    case 5.5:
      return "Asia/Kolkata";
    case 1:
      return "Europe/Berlin";
    case 0:
      return "Europe/London";
    case -3:
      return "America/Sao_Paulo";
    case -4:
      return "America/New_York"; // DST
    case -5:
      return "America/New_York";
    case -7:
      return "America/Los_Angeles"; // DST
    case -8:
      return "America/Los_Angeles";
    default:
      // Generic Etc/GMT zones invert the sign (POSIX).
      const sign = offset >= 0 ? "-" : "+";
      const abs = Math.abs(offset);
      return `Etc/GMT${sign}${abs}`;
  }
}
