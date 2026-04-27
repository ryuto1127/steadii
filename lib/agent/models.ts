export type TaskType =
  | "chat"
  | "tool_call"
  | "mistake_explain"
  | "syllabus_extract"
  | "chat_title"
  | "tag_suggest"
  // Phase 6 W2 email agent.
  // `email_classify_risk` — GPT-5.4 Mini risk-tier classification, always
  //   called for l2_pending inbox_items. Memory: "classify continues on
  //   exhaustion".
  // `email_classify_deep` — GPT-5.4 Full, called only when the risk pass
  //   returns `risk_tier === 'high'`. Uses retrieval context.
  // `email_draft` — GPT-5.4 Full, called when the pipeline decides
  //   action === 'draft_reply'.
  // `email_embed` — OpenAI `text-embedding-3-small` per inbox_item at ingest
  //   time. Pricing tier is separate from chat/complex/nano (see PRICING
  //   "embedding" tier below).
  | "email_classify_risk"
  | "email_classify_deep"
  | "email_draft"
  | "email_embed"
  // Phase 7 W-Notes: vision OCR for handwritten / scanned notes.
  // Routes to GPT-5.4 complex tier — same shape and pricing as
  // syllabus_extract. Always meters credits.
  | "notes_extract"
  // Phase 8 — proactive proposal generation. Picks GPT-5.4 Mini for
  // routine issues; the scanner can override to "complex" via the
  // selectModel env when an issue is high-stakes. Meters credits.
  | "proactive_proposal";

// Canonical model defaults. These are the target IDs; the operator can
// override them at runtime with OPENAI_CHAT_MODEL / OPENAI_COMPLEX_MODEL /
// OPENAI_NANO_MODEL without a code change — useful when the listed IDs
// haven't rolled out to a particular account yet. The full routing policy
// (which task type uses which tier) lives in memory/project_decisions.md.
export type DefaultOpenAIModel =
  | "gpt-5.4-mini"
  | "gpt-5.4"
  | "gpt-5.4-nano"
  | "text-embedding-3-small";

const DEFAULTS: Record<
  "chat" | "complex" | "nano" | "embedding",
  DefaultOpenAIModel
> = {
  chat: "gpt-5.4-mini",
  complex: "gpt-5.4",
  nano: "gpt-5.4-nano",
  embedding: "text-embedding-3-small",
};

type Pricing = {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion: number;
};

// OpenAI Standard tier pricing (USD per 1M tokens).
// Chat/complex/nano verified 2026-04-21. Embedding tier added 2026-04-23:
// text-embedding-3-small = $0.02 per 1M input tokens, no output.
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
  "text-embedding-3-small": {
    inputPerMillion: 0.02,
    outputPerMillion: 0,
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
    case "email_classify_risk":
    case "proactive_proposal":
      return env.OPENAI_CHAT_MODEL?.trim() || DEFAULTS.chat;
    case "mistake_explain":
    case "syllabus_extract":
    case "notes_extract":
    case "email_classify_deep":
    case "email_draft":
      return env.OPENAI_COMPLEX_MODEL?.trim() || DEFAULTS.complex;
    case "chat_title":
    case "tag_suggest":
      return env.OPENAI_NANO_MODEL?.trim() || DEFAULTS.nano;
    case "email_embed":
      return env.OPENAI_EMBEDDING_MODEL?.trim() || DEFAULTS.embedding;
  }
}

// Map any (possibly overridden) model string back to a pricing tier so
// credit accounting stays sane even when OPENAI_*_MODEL is set to a new ID.
// The heuristic: exact match first; else look for "embedding" / "nano" /
// "mini" in the string; default to the complex (full) tier.
export function pricingTierFor(model: string): DefaultOpenAIModel {
  if (model in PRICING) return model as DefaultOpenAIModel;
  const lower = model.toLowerCase();
  if (lower.includes("embedding")) return "text-embedding-3-small";
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

// 1 credit = $0.005 of token spend (revised 2026-04-21; was $0.01). Per-
// operation credit cost doubles under this unit so Pro Student ($10 / 1000
// credits) and free-tier loss become sustainable — see project_decisions.md.
// Math: usd / 0.005 === usd * 200.
//
// 2026-04-23 (C7 fix in Phase 6 W2): switched from Math.floor → Math.round.
// Under floor, a 3.9-credit draft silently rounded to 3 (and a 0.75-credit
// classify to 0). Half-up rounding keeps the integer pool honest without
// inventing sub-unit credits. Sub-rounding-boundary tasks (< 0.5 credits)
// still round to 0 and remain free — fine for embedding + risk-pass.
export function usdToCredits(usd: number): number {
  return Math.round(usd * 200);
}

// Task types that CONSUME credits. Chat and meta/title/tag work are tracked
// for analytics but don't deduct from the monthly credit pool — chat gets
// rate-limited by plan tier instead, and nano work is negligible.
// See project_decisions.md "Chat is NOT credit-metered".
export function taskTypeMetersCredits(t: TaskType): boolean {
  switch (t) {
    case "mistake_explain":
    case "syllabus_extract":
    case "notes_extract":
    case "email_classify_risk":
    case "email_classify_deep":
    case "email_draft":
    case "email_embed":
    case "proactive_proposal":
      return true;
    case "chat":
    case "tool_call":
    case "chat_title":
    case "tag_suggest":
      return false;
  }
}

// Re-export for legacy callers that imported OpenAIModel.
export type OpenAIModel = string;
