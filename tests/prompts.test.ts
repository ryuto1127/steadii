import { describe, expect, it } from "vitest";
import { MAIN_SYSTEM_PROMPT } from "@/lib/agent/prompts/main";

describe("main system prompt", () => {
  it("is a stable exported constant string (for prompt caching)", () => {
    expect(typeof MAIN_SYSTEM_PROMPT).toBe("string");
    expect(MAIN_SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });

  it("does not interpolate user-specific data", () => {
    // Class-centric language model note (AGENTS.md §4.1) should be present,
    // but no template placeholders.
    expect(MAIN_SYSTEM_PROMPT).not.toMatch(/\{\{/);
    expect(MAIN_SYSTEM_PROMPT).not.toMatch(/\$\{/);
  });

  it("instructs on class-centric model", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/Class relation/);
  });

  it("instructs to match user language", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/language/);
  });
});
