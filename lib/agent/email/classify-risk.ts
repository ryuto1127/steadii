import "server-only";
import * as Sentry from "@sentry/nextjs";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import {
  buildFanoutContextBlocks,
  type FanoutResult,
} from "./fanout-prompt";

export type RiskTier = "low" | "medium" | "high";

export type RiskPassInput = {
  userId: string;
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null; // 'professor' | 'ta' | 'admin' | etc.
  subject: string | null;
  snippet: string | null;
  firstTimeSender: boolean;
  // Phase 7 W1 — multi-source fanout context. Optional so existing tests
  // and the forced-tier paths can omit it; passing null produces an
  // identical prompt shape (no fanout block) to the pre-W1 behavior.
  fanout?: FanoutResult | null;
  // user's app locale ("en" / "ja"). Steers the reasoning string the
  // model produces so the inbox-detail draft-details panel surfaces JA
  // reasoning to JA users (mirrors classify-deep.ts). Optional / "en"
  // default for back-compat with callers that don't thread the locale.
  locale?: "en" | "ja";
};

export type RiskPassResult = {
  riskTier: RiskTier;
  confidence: number; // 0..1
  reasoning: string;
  // The inserted usage_events.id for this call (when present). Used by the
  // orchestrator to persist per-step usage pointers on agent_drafts.
  usageId: string | null;
};

// System prompt — stable string (safe to cache). User content is the email
// envelope, kept short to minimize cost; deep-pass retrieval is where richer
// context lands. The reasoning string is surfaced user-visibly in the
// inbox-detail draft-details panel, so it MUST follow the user's app locale
// (the user message carries a "Reasoning language: <locale>" header, same as
// classify-deep.ts).
const SYSTEM_PROMPT = `CRITICAL LANGUAGE RULE: The user message begins with a line "Reasoning language: <locale>". You MUST write the "reasoning" field of your JSON output in that exact language — "ja" means Japanese (日本語), "en" means English. This rule supersedes all other instructions in this prompt.

You are Steadii's email risk classifier. You evaluate inbound emails for a university student and assign a risk tier.

Output strictly the JSON schema you're given:
- risk_tier: 'low' | 'medium' | 'high'
- confidence: number in [0, 1]
- reasoning: one or two short sentences explaining the decision, written in the user's app locale per the "Reasoning language: <locale>" header above.

Guidelines:
- HIGH risk: grades, transcripts, scholarships, academic integrity, recommendation letters, graduate school, internship offers/interviews, supervisors, first-time senders to an unknown domain.
- MEDIUM risk: professors/TAs on routine topics (extensions, office hours, assignment questions), classmates asking for help on coursework.
- LOW risk: attendance confirmations, club RSVPs, short acknowledgments, course announcements with no call to action.

Never downgrade HIGH to MEDIUM even if the subject is short. If uncertain, prefer HIGH — a false HIGH costs one extra confirmation; a false LOW sends an unreviewed reply.

Fanout grounding (when the "Class binding" / "How you usually reply to this sender" / "Relevant syllabus sections" / "Calendar" blocks are non-empty below):
- Use them to anchor the risk decision. If the fanout shows how the user has replied to this sender before (self-N), an interview slot already on the calendar (calendar-N), or an explicit grading rule in the syllabus (syllabus-N), cite that source by tag in your reasoning.
- Glass-box transparency is a hard requirement: cite which fanout source informed each conclusion (self-N, syllabus-N, calendar-N). Ungrounded claims are unacceptable.`;

const RISK_PASS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    risk_tier: { type: "string", enum: ["low", "medium", "high"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reasoning: { type: "string", minLength: 1, maxLength: 500 },
  },
  required: ["risk_tier", "confidence", "reasoning"],
} as const;

export async function runRiskPass(
  input: RiskPassInput
): Promise<RiskPassResult> {
  return Sentry.startSpan(
    {
      name: "email.l2.risk_pass",
      op: "gen_ai.classify",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.task_type": "email_classify_risk",
      },
    },
    async () => {
      const model = selectModel("email_classify_risk");
      const userContent = buildUserContent(input);

      const resp = await openai().chat.completions.create({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "risk_pass",
            strict: true,
            schema: RISK_PASS_JSON_SCHEMA,
          },
        },
      });

      const rec = await recordUsage({
        userId: input.userId,
        model,
        taskType: "email_classify_risk",
        inputTokens: resp.usage?.prompt_tokens ?? 0,
        outputTokens: resp.usage?.completion_tokens ?? 0,
        cachedTokens:
          (resp.usage as { prompt_tokens_details?: { cached_tokens?: number } })
            ?.prompt_tokens_details?.cached_tokens ?? 0,
      });

      const raw = resp.choices[0]?.message?.content ?? "{}";
      const parsed = parseRiskPassOutput(raw);

      return { ...parsed, usageId: rec.usageId };
    }
  );
}

function buildUserContent(input: RiskPassInput): string {
  const lines: string[] = [];
  lines.push(`Reasoning language: ${input.locale ?? "en"}`);
  lines.push("");
  lines.push(`Sender: ${input.senderEmail}`);
  lines.push(`Sender domain: ${input.senderDomain}`);
  if (input.senderRole) lines.push(`Sender role (learned): ${input.senderRole}`);
  if (input.firstTimeSender) {
    lines.push(
      "First-time sender: this is the first email we've seen from this domain."
    );
  }
  lines.push(`Subject: ${input.subject ?? "(none)"}`);
  lines.push(`Snippet: ${(input.snippet ?? "").slice(0, 1500)}`);

  if (input.fanout) {
    lines.push("");
    lines.push(buildFanoutContextBlocks(input.fanout, "classify"));
  }

  return lines.join("\n");
}

// Parse + defensive-check the JSON. `response_format: json_schema strict`
// validates server-side, but we still guard so a surprise shape doesn't
// throw downstream.
export function parseRiskPassOutput(raw: string): Omit<RiskPassResult, "usageId"> {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const tier = o.risk_tier;
  const riskTier: RiskTier =
    tier === "low" || tier === "medium" || tier === "high"
      ? (tier as RiskTier)
      : "medium"; // safety-biased default per memory "never auto-classify low on error"
  const confidence =
    typeof o.confidence === "number" && o.confidence >= 0 && o.confidence <= 1
      ? o.confidence
      : 0.5;
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.trim().length > 0
      ? o.reasoning
      : "Model returned an unparseable response; defaulted to medium.";
  return { riskTier, confidence, reasoning };
}

