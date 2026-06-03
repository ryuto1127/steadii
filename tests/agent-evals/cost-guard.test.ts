// Unit tests for the agent-eval cost guardrails. Pure functions — no OpenAI,
// no DB, no network. Covers the opt-in flag, budget resolution, the
// over-budget decision, and usage accumulation/pricing.

import { describe, expect, it } from "vitest";

import {
  ALLOW_REAL_LLM_ENV,
  DEFAULT_MAX_RUN_USD,
  MAX_RUN_USD_ENV,
  addCompletionUsage,
  emptyUsage,
  estimateUsageUsd,
  formatUsageSummary,
  isOverBudget,
  isRealLlmAllowed,
  resolveMaxRunUsd,
} from "./cost-guard";

describe("isRealLlmAllowed — opt-in flag", () => {
  it("refuses when the flag is absent (the accidental-burn guard)", () => {
    expect(isRealLlmAllowed({})).toBe(false);
  });

  it("refuses for falsey-ish values", () => {
    expect(isRealLlmAllowed({ [ALLOW_REAL_LLM_ENV]: "0" })).toBe(false);
    expect(isRealLlmAllowed({ [ALLOW_REAL_LLM_ENV]: "false" })).toBe(false);
    expect(isRealLlmAllowed({ [ALLOW_REAL_LLM_ENV]: "" })).toBe(false);
  });

  it("allows for the accepted truthy spellings", () => {
    expect(isRealLlmAllowed({ [ALLOW_REAL_LLM_ENV]: "1" })).toBe(true);
    expect(isRealLlmAllowed({ [ALLOW_REAL_LLM_ENV]: "true" })).toBe(true);
    expect(isRealLlmAllowed({ [ALLOW_REAL_LLM_ENV]: "YES" })).toBe(true);
    expect(isRealLlmAllowed({ [ALLOW_REAL_LLM_ENV]: " 1 " })).toBe(true);
  });
});

describe("resolveMaxRunUsd — budget resolution", () => {
  it("defaults when unset", () => {
    expect(resolveMaxRunUsd({})).toBe(DEFAULT_MAX_RUN_USD);
  });

  it("honors a valid positive override", () => {
    expect(resolveMaxRunUsd({ [MAX_RUN_USD_ENV]: "5" })).toBe(5);
  });

  it("falls back to the default for non-positive or junk values", () => {
    expect(resolveMaxRunUsd({ [MAX_RUN_USD_ENV]: "0" })).toBe(
      DEFAULT_MAX_RUN_USD
    );
    expect(resolveMaxRunUsd({ [MAX_RUN_USD_ENV]: "-3" })).toBe(
      DEFAULT_MAX_RUN_USD
    );
    expect(resolveMaxRunUsd({ [MAX_RUN_USD_ENV]: "nope" })).toBe(
      DEFAULT_MAX_RUN_USD
    );
  });
});

describe("isOverBudget — cap decision", () => {
  it("aborts at or above the ceiling", () => {
    expect(isOverBudget(2, 2)).toBe(true);
    expect(isOverBudget(2.5, 2)).toBe(true);
  });

  it("continues below the ceiling", () => {
    expect(isOverBudget(1.99, 2)).toBe(false);
    expect(isOverBudget(0, 2)).toBe(false);
  });
});

describe("usage accumulation + pricing", () => {
  it("sums prompt/completion/cached tokens across calls", () => {
    const u = emptyUsage();
    addCompletionUsage(u, {
      prompt_tokens: 100,
      completion_tokens: 40,
      prompt_tokens_details: { cached_tokens: 20 },
    });
    addCompletionUsage(u, { prompt_tokens: 50, completion_tokens: 10 });
    expect(u.inputTokens).toBe(150);
    expect(u.outputTokens).toBe(50);
    expect(u.cachedTokens).toBe(20);
    expect(u.requests).toBe(2);
  });

  it("tolerates a missing usage block", () => {
    const u = emptyUsage();
    addCompletionUsage(u, undefined);
    addCompletionUsage(u, null);
    expect(u.inputTokens).toBe(0);
    expect(u.outputTokens).toBe(0);
    expect(u.requests).toBe(2);
  });

  it("estimates USD via the shared cost-audit pricing helper", () => {
    const u = emptyUsage();
    // 1,000,000 input + 1,000,000 output at gpt-5.4-mini ($0.75 / $4.50 per 1M).
    addCompletionUsage(u, {
      prompt_tokens: 1_000_000,
      completion_tokens: 1_000_000,
    });
    expect(estimateUsageUsd(u, "gpt-5.4-mini")).toBeCloseTo(0.75 + 4.5, 5);
  });

  it("formats a single-line summary with model + tokens + USD", () => {
    const u = emptyUsage();
    addCompletionUsage(u, { prompt_tokens: 200, completion_tokens: 30 });
    const line = formatUsageSummary(u, "gpt-5.4-mini");
    expect(line).toContain("model=gpt-5.4-mini");
    expect(line).toContain("requests=1");
    expect(line).toContain("input=200");
    expect(line).toContain("output=30");
    expect(line).toContain("est=$");
  });
});
