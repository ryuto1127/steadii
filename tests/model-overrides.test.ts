import { describe, expect, it } from "vitest";
import {
  selectModel,
  pricingTierFor,
  estimateUsdCost,
} from "@/lib/agent/models";

describe("selectModel env overrides", () => {
  it("falls back to canonical defaults when env is empty", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(selectModel("chat", env)).toBe("gpt-5.4-mini");
    expect(selectModel("tool_call", env)).toBe("gpt-5.4-mini");
    expect(selectModel("mistake_explain", env)).toBe("gpt-5.4");
    expect(selectModel("syllabus_extract", env)).toBe("gpt-5.4");
    expect(selectModel("chat_title", env)).toBe("gpt-5.4-nano");
    expect(selectModel("tag_suggest", env)).toBe("gpt-5.4-nano");
  });

  it("honors OPENAI_CHAT_MODEL / OPENAI_COMPLEX_MODEL / OPENAI_NANO_MODEL", () => {
    const env = {
      OPENAI_CHAT_MODEL: "gpt-4o-mini",
      OPENAI_COMPLEX_MODEL: "gpt-4o",
      OPENAI_NANO_MODEL: "gpt-4o-mini",
    } as unknown as NodeJS.ProcessEnv;
    expect(selectModel("chat", env)).toBe("gpt-4o-mini");
    expect(selectModel("mistake_explain", env)).toBe("gpt-4o");
    expect(selectModel("chat_title", env)).toBe("gpt-4o-mini");
  });

  it("trims whitespace and ignores empty strings", () => {
    const env = {
      OPENAI_CHAT_MODEL: "   ",
      OPENAI_COMPLEX_MODEL: "  gpt-test  ",
    } as unknown as NodeJS.ProcessEnv;
    expect(selectModel("chat", env)).toBe("gpt-5.4-mini");
    expect(selectModel("mistake_explain", env)).toBe("gpt-test");
  });
});

describe("pricingTierFor — overridden model IDs still price correctly", () => {
  it("recognizes mini/nano substrings", () => {
    expect(pricingTierFor("gpt-4o-mini")).toBe("gpt-5.4-mini");
    expect(pricingTierFor("gpt-4o-nano")).toBe("gpt-5.4-nano");
  });
  it("defaults to the complex tier when nothing matches", () => {
    expect(pricingTierFor("some-new-model")).toBe("gpt-5.4");
  });
  it("exact matches on default IDs", () => {
    expect(pricingTierFor("gpt-5.4-mini")).toBe("gpt-5.4-mini");
    expect(pricingTierFor("gpt-5.4")).toBe("gpt-5.4");
  });
  it("estimateUsdCost still runs for an overridden ID", () => {
    const cost = estimateUsdCost("gpt-4o-mini", {
      input: 1000,
      output: 500,
      cached: 0,
    });
    expect(cost).toBeGreaterThan(0);
  });
});
