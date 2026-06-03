// Cost guardrails for the agent-eval harness — opt-in flag, usage
// accumulation, and a per-run budget cap.
//
// Why this exists: the eval harness (`harness.ts` + `run.ts`) is the one place
// that hits the *real* paid OpenAI API outside prod. Unlike every prod call
// path, it does not go through `recordUsage`, so its spend was invisible to
// `scripts/cost-audit.ts` — a ~$7.65/day gpt-5.4-mini spike (2026-06-01,
// ~2,879 untracked requests) traced back to it running unintentionally.
//
// These helpers are pure (no OpenAI, no DB) so they unit-test cleanly. The
// harness wires them in: refuse to run without the opt-in flag, sum tokens as
// it goes, abort once estimated spend crosses the ceiling, and print a
// token + USD summary at the end of a run.

import { estimateUsdCost } from "@/lib/agent/models";

// We only read a couple of keys, so accept any string→string|undefined map
// (lets unit tests pass plain `{ ALLOW_REAL_LLM: "1" }` without constructing a
// full NodeJS.ProcessEnv, which strict TS requires NODE_ENV on).
type EnvLike = Record<string, string | undefined>;

// Explicit opt-in. A bare `pnpm eval:agent` must NOT touch the paid API; the
// caller has to set this deliberately. Accepts the common truthy spellings so
// `ALLOW_REAL_LLM=1`, `=true`, `=yes` all work.
export const ALLOW_REAL_LLM_ENV = "ALLOW_REAL_LLM";

// Per-run hard ceiling on estimated spend (USD). The whole scenario set should
// cost well under a dollar at mini pricing; $2 leaves headroom for model
// overrides while still aborting a runaway loop fast. Overridable via
// EVAL_MAX_USD for an intentional larger run.
export const DEFAULT_MAX_RUN_USD = 2;
export const MAX_RUN_USD_ENV = "EVAL_MAX_USD";

export function isRealLlmAllowed(env: EnvLike = process.env): boolean {
  const raw = env[ALLOW_REAL_LLM_ENV]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export const ALLOW_REAL_LLM_REFUSAL =
  `Refusing to run the agent-eval harness: it calls the REAL paid OpenAI API ` +
  `and is not gated by cost-audit. Set ${ALLOW_REAL_LLM_ENV}=1 to opt in ` +
  `explicitly (this guard exists because an accidental run caused a billing ` +
  `spike on 2026-06-01). A bare \`pnpm eval:agent\` will never bill you.`;

export function resolveMaxRunUsd(env: EnvLike = process.env): number {
  const raw = env[MAX_RUN_USD_ENV]?.trim();
  if (!raw) return DEFAULT_MAX_RUN_USD;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_RUN_USD;
}

// Token totals across every OpenAI call the harness makes in a run. `cached`
// is the prompt-cache portion of `input` (subset, not additive) to match
// `estimateUsdCost`'s contract.
export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requests: number;
};

export function emptyUsage(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 };
}

// Pull the token counts off an OpenAI ChatCompletion `usage` block. Tolerant
// of missing fields (some models / error paths omit `usage`).
export function addCompletionUsage(
  totals: UsageTotals,
  usage:
    | {
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
        prompt_tokens_details?: { cached_tokens?: number | null } | null;
      }
    | null
    | undefined
): UsageTotals {
  totals.inputTokens += usage?.prompt_tokens ?? 0;
  totals.outputTokens += usage?.completion_tokens ?? 0;
  totals.cachedTokens += usage?.prompt_tokens_details?.cached_tokens ?? 0;
  totals.requests += 1;
  return totals;
}

export function estimateUsageUsd(totals: UsageTotals, model: string): number {
  return estimateUsdCost(model, {
    input: totals.inputTokens,
    output: totals.outputTokens,
    cached: totals.cachedTokens,
  });
}

// Budget decision: given spend so far, should the run abort before starting
// the next scenario? Pure so the harness/runner stays a thin caller.
export function isOverBudget(spentUsd: number, maxUsd: number): boolean {
  return spentUsd >= maxUsd;
}

export function formatUsageSummary(
  totals: UsageTotals,
  model: string
): string {
  const usd = estimateUsageUsd(totals, model);
  return (
    `OpenAI usage — model=${model} requests=${totals.requests} ` +
    `input=${totals.inputTokens} output=${totals.outputTokens} ` +
    `cached=${totals.cachedTokens} est=$${usd.toFixed(4)}`
  );
}
