// 2026-05-19 — Phase 2b LLM fallback for the intent classifier.
//
// When the Phase 1 regex layer (lib/agent/intent-classifier.ts) returns
// confidence below the regex-trust threshold (currently 0.6), we fall
// back to gpt-5.4-nano with strict JSON-schema output. Cost: ~$0.0001
// per task at α volume. Treated as 0 credit per `taskTypeMetersCredits`.
//
// The LLM call is wrapped in `runIntentLLMClassification` so test code
// can inject a fake without going through the OpenAI client.

import "server-only";

import { openai } from "@/lib/integrations/openai/client";
import { selectModel } from "./models";
import type {
  IntentClassification,
  IntentClassificationContext,
  TaskIntent,
} from "./intent-classifier";

// Threshold below which we call the LLM fallback. Regex confidence
// at or above this trusts the regex layer's verdict.
export const REGEX_TRUST_THRESHOLD = 0.6;

const INTENT_VALUES: readonly TaskIntent[] = [
  "DRAFT_EMAIL_REPLY",
  "CALENDAR_EVENT",
  "STUDY_SESSION",
  "ASSIGNMENT_WORK",
  "OTHER",
];

const SYSTEM_PROMPT = `You classify single short task titles into ONE of five intent types:

- DRAFT_EMAIL_REPLY: the user wants to compose / respond to an email or message
- CALENDAR_EVENT: the user wants to create or schedule a meeting / event
- STUDY_SESSION: the user wants to review / study / prep material for a class
- ASSIGNMENT_WORK: the user wants to work on homework / a problem set / an essay / a lab
- OTHER: errands, personal items, shopping, vague notes, or unclear intent

Return STRICT JSON matching the response schema. Keep "reasoning" to one short sentence — it surfaces in a glass-box hover for the user.`;

const RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: INTENT_VALUES,
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
    },
    reasoning: { type: "string", minLength: 1, maxLength: 200 },
  },
  required: ["intent", "confidence", "reasoning"],
} as const;

type LLMResponse = {
  intent: TaskIntent;
  confidence: number;
  reasoning: string;
};

// The dependency-injectable runner. Default implementation calls the
// OpenAI client; tests pass a fake.
export type IntentLLMRunner = (args: {
  systemPrompt: string;
  userPrompt: string;
  responseSchema: typeof RESPONSE_SCHEMA;
}) => Promise<LLMResponse>;

const defaultRunner: IntentLLMRunner = async ({
  systemPrompt,
  userPrompt,
  responseSchema,
}) => {
  const model = selectModel("task_intent_classify");
  const resp = await openai().chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "task_intent_classification",
        strict: true,
        schema: responseSchema,
      },
    },
  });
  const raw = resp.choices[0]?.message?.content ?? "{}";
  return parseLLMResponse(raw);
};

export function parseLLMResponse(raw: string): LLMResponse {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    j = {};
  }
  const o = (j ?? {}) as Record<string, unknown>;
  const intent =
    typeof o.intent === "string" && INTENT_VALUES.includes(o.intent as TaskIntent)
      ? (o.intent as TaskIntent)
      : "OTHER";
  const rawConf = typeof o.confidence === "number" ? o.confidence : 0;
  const confidence = Math.min(1, Math.max(0, rawConf));
  const reasoning =
    typeof o.reasoning === "string" && o.reasoning.length > 0
      ? o.reasoning.slice(0, 200)
      : "";
  return { intent, confidence, reasoning };
}

export function buildIntentLLMUserPrompt(
  title: string,
  context: IntentClassificationContext,
): string {
  const lines = [`Task title: "${title}"`];

  // Surface a SHORT context block so the LLM has the same anchored
  // signals the regex layer uses. Capped to keep token cost low.
  if (context.knownEntities && context.knownEntities.length > 0) {
    const entities = context.knownEntities.slice(0, 20);
    const names = entities
      .flatMap((e) => [e.displayName, ...e.aliases])
      .filter((n) => n && n.length >= 2)
      .slice(0, 30);
    if (names.length > 0) {
      lines.push("", `Known entities: ${names.join(", ")}`);
    }
  }
  if (context.knownClassCodes && context.knownClassCodes.length > 0) {
    const codes = context.knownClassCodes.slice(0, 15);
    lines.push(`Known class codes: ${codes.join(", ")}`);
  }
  return lines.join("\n");
}

export async function runIntentLLMClassification(args: {
  title: string;
  context: IntentClassificationContext;
  runner?: IntentLLMRunner;
}): Promise<IntentClassification> {
  const runner = args.runner ?? defaultRunner;
  const userPrompt = buildIntentLLMUserPrompt(args.title, args.context);

  const result = await runner({
    systemPrompt: SYSTEM_PROMPT,
    userPrompt,
    responseSchema: RESPONSE_SCHEMA,
  });

  return {
    intent: result.intent,
    confidence: result.confidence,
    matchedPattern: "llm-fallback",
    // LLM doesn't (yet) link to entity / class code records; the regex
    // layer's anchor data takes precedence. If the LLM picks
    // DRAFT_EMAIL_REPLY and the regex layer already matched an entity
    // by substring, the regex layer's matchedEntityId would be in the
    // caller's result — but we never reach the LLM at that confidence.
  };
}

// Convenience wrapper that fuses regex + LLM-fallback. Used by the
// store helper so the call site stays a single function call.
export async function classifyWithLLMIfNeeded(args: {
  regexResult: IntentClassification;
  title: string;
  context: IntentClassificationContext;
  runner?: IntentLLMRunner;
}): Promise<IntentClassification> {
  if (args.regexResult.confidence >= REGEX_TRUST_THRESHOLD) {
    return args.regexResult;
  }
  try {
    const llm = await runIntentLLMClassification({
      title: args.title,
      context: args.context,
      runner: args.runner,
    });
    // Only adopt the LLM result if it's more confident than the regex
    // floor. Otherwise the regex's matchedPattern (even at low conf)
    // still has more debugging value than an "LLM said OTHER" tag.
    if (llm.confidence > args.regexResult.confidence) {
      return llm;
    }
    return args.regexResult;
  } catch (err) {
    // Failure (timeout, schema validation error, etc.) — degrade
    // gracefully to the regex result. Don't break task creation.
    // eslint-disable-next-line no-console
    console.warn("[intent-classifier-llm] fallback failed:", err);
    return args.regexResult;
  }
}
