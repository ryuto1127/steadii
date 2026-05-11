import "server-only";
import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "@/lib/agent/models";
import { recordUsage } from "@/lib/agent/usage";
import type { L2ToolExecutor } from "./types";

// engineer-41 — LLM judge for "should I ask the user before acting?".
//
// The agentic loop hits this whenever it considers committing to a
// decision with moderate confidence (e.g. picking one of three proposed
// slots when the persona block doesn't disambiguate). The judge returns
// ambiguous=true + a suggested question, the loop calls
// queue_user_confirmation, then continues with its best-guess inferred
// value. ambiguous=false → the loop proceeds without asking.

export type DetectAmbiguityArgs = {
  // Short summary of the situation the LLM is judging (current draft
  // approach, what's known, what's still inferred).
  context: string;
  // The candidate decision being considered.
  decision: string;
  // 0..1 confidence the loop has in `decision`.
  confidence: number;
};

export type DetectAmbiguityResult = {
  ambiguous: boolean;
  suggestedQuestion: string | null;
  rationale: string;
};

const SYSTEM_PROMPT = `You judge whether an agent should ASK a user before committing to a decision, or just go ahead.

Inputs: a context summary, the candidate decision, and the agent's own confidence (0..1).

Return JSON: { "ambiguous": boolean, "suggestedQuestion": string | null, "rationale": string }.

Rules:
- ambiguous=true ONLY when ALL of these hold:
  - The decision affects something the user will care about (date, recipient, tone, language, scheduling).
  - The cost of being wrong is non-trivial (missed meeting, wrong recipient, wrong language, wrong day).
  - The agent's confidence is < 0.8 OR the inputs themselves are internally inconsistent.
- ambiguous=false when the decision is reversible by the user with one click (drafts can be edited; the user always reviews).
- ambiguous=false when confidence ≥ 0.8 and the inputs are consistent.
- When ambiguous=true, suggestedQuestion is one short sentence in user-friendly language, English. It should be answerable in one tap (yes/no or pick-from-list). Avoid over-explaining.
- rationale is one sentence pointing at the decision factor.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ambiguous: { type: "boolean" },
    suggestedQuestion: { type: ["string", "null"] },
    rationale: { type: "string", maxLength: 240 },
  },
  required: ["ambiguous", "suggestedQuestion", "rationale"],
} as const;

export const detectAmbiguityTool: L2ToolExecutor<
  DetectAmbiguityArgs,
  DetectAmbiguityResult
> = {
  schema: {
    name: "detect_ambiguity",
    description:
      "Judge whether the agent should queue_user_confirmation before committing to a decision. Returns ambiguous=true when the decision is consequential, the inputs are inconsistent, or the agent's confidence is < 0.8. Use this to gate user-asks — over-asking trains the user to ignore Steadii.",
    parameters: {
      type: "object",
      properties: {
        context: { type: "string", minLength: 1, maxLength: 2000 },
        decision: { type: "string", minLength: 1, maxLength: 500 },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: ["context", "decision", "confidence"],
      additionalProperties: false,
    },
  },
  async execute(ctx, args) {
    const model = selectModel("email_classify_risk"); // mini
    const userMsg = [
      `Confidence: ${args.confidence.toFixed(2)}`,
      "",
      "=== Context ===",
      args.context.slice(0, 4000),
      "",
      "=== Decision being considered ===",
      args.decision.slice(0, 1000),
    ].join("\n");
    const resp = await openai().chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMsg },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "detect_ambiguity",
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
    return parseDetectAmbiguityOutput(
      resp.choices[0]?.message?.content ?? "{}"
    );
  },
};

export function parseDetectAmbiguityOutput(
  raw: string
): DetectAmbiguityResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ambiguous: false, suggestedQuestion: null, rationale: "" };
  }
  const o = (parsed ?? {}) as Record<string, unknown>;
  const ambiguous = o.ambiguous === true;
  const suggestedQuestion =
    typeof o.suggestedQuestion === "string" && o.suggestedQuestion.trim()
      ? o.suggestedQuestion.trim().slice(0, 500)
      : null;
  const rationale =
    typeof o.rationale === "string" ? o.rationale.trim().slice(0, 240) : "";
  return { ambiguous, suggestedQuestion, rationale };
}
