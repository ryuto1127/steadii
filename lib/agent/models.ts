export type TaskType =
  | "chat"
  | "tool_call"
  | "mistake_explain"
  | "syllabus_extract"
  | "chat_title"
  | "tag_suggest";

export type OpenAIModel = "gpt-5.4-mini" | "gpt-5.4" | "gpt-5.4-nano";

export function selectModel(taskType: TaskType): OpenAIModel {
  switch (taskType) {
    case "chat":
    case "tool_call":
      return "gpt-5.4-mini";
    case "mistake_explain":
    case "syllabus_extract":
      return "gpt-5.4";
    case "chat_title":
    case "tag_suggest":
      return "gpt-5.4-nano";
  }
}

type Pricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
};

const PRICING: Record<OpenAIModel, Pricing> = {
  "gpt-5.4-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6, cachedInputPerMillion: 0.075 },
  "gpt-5.4": { inputPerMillion: 2.5, outputPerMillion: 10, cachedInputPerMillion: 1.25 },
  "gpt-5.4-nano": { inputPerMillion: 0.05, outputPerMillion: 0.2, cachedInputPerMillion: 0.025 },
};

export function estimateUsdCost(
  model: OpenAIModel,
  tokens: { input: number; output: number; cached: number }
): number {
  const p = PRICING[model];
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
