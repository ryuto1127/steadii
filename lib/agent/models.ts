export type TaskType =
  | "chat"
  | "tool_call"
  | "mistake_explain"
  | "syllabus_extract"
  | "chat_title"
  | "tag_suggest";

// Canonical defaults per PRD §5. These are the target IDs; the operator can
// override them at runtime with OPENAI_CHAT_MODEL / OPENAI_COMPLEX_MODEL /
// OPENAI_NANO_MODEL without a code change — useful when the listed IDs
// haven't rolled out to a particular account yet.
export type DefaultOpenAIModel = "gpt-5.4-mini" | "gpt-5.4" | "gpt-5.4-nano";

const DEFAULTS: Record<
  "chat" | "complex" | "nano",
  DefaultOpenAIModel
> = {
  chat: "gpt-5.4-mini",
  complex: "gpt-5.4",
  nano: "gpt-5.4-nano",
};

type Pricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
};

// OpenAI Standard tier pricing (USD per 1M tokens).
// Verified against OpenAI pricing page on 2026-04-21.
const PRICING: Record<DefaultOpenAIModel, Pricing> = {
  "gpt-5.4-mini": {
    inputPerMillion: 0.75,
    outputPerMillion: 4.5,
    cachedInputPerMillion: 0.075,
  },
  "gpt-5.4": {
    inputPerMillion: 2.5,
    outputPerMillion: 15,
    cachedInputPerMillion: 0.25,
  },
  "gpt-5.4-nano": {
    inputPerMillion: 0.2,
    outputPerMillion: 1.25,
    cachedInputPerMillion: 0.02,
  },
};

export function selectModel(
  taskType: TaskType,
  env: NodeJS.ProcessEnv = process.env
): string {
  switch (taskType) {
    case "chat":
    case "tool_call":
      return env.OPENAI_CHAT_MODEL?.trim() || DEFAULTS.chat;
    case "mistake_explain":
    case "syllabus_extract":
      return env.OPENAI_COMPLEX_MODEL?.trim() || DEFAULTS.complex;
    case "chat_title":
    case "tag_suggest":
      return env.OPENAI_NANO_MODEL?.trim() || DEFAULTS.nano;
  }
}

// Map any (possibly overridden) model string back to a pricing tier so
// credit accounting stays sane even when OPENAI_*_MODEL is set to a new ID.
// The heuristic: exact match first; else look for "mini" or "nano" in the
// string; default to the complex (full) tier.
export function pricingTierFor(model: string): DefaultOpenAIModel {
  if (model in PRICING) return model as DefaultOpenAIModel;
  const lower = model.toLowerCase();
  if (lower.includes("nano")) return "gpt-5.4-nano";
  if (lower.includes("mini")) return "gpt-5.4-mini";
  return "gpt-5.4";
}

export function estimateUsdCost(
  model: string,
  tokens: { input: number; output: number; cached: number }
): number {
  const p = PRICING[pricingTierFor(model)];
  const uncachedInput = Math.max(0, tokens.input - tokens.cached);
  const dollars =
    (uncachedInput * p.inputPerMillion +
      tokens.cached * p.cachedInputPerMillion +
      tokens.output * p.outputPerMillion) /
    1_000_000;
  return dollars;
}

export function usdToCredits(usd: number): number {
  return Math.floor(usd * 100);
}

// Re-export for legacy callers that imported OpenAIModel.
export type OpenAIModel = string;
