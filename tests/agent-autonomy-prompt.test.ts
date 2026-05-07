import { describe, expect, it } from "vitest";
import { MAIN_SYSTEM_PROMPT } from "@/lib/agent/prompts/main";

// Engineer-37 Part A — agent autonomy on reversible 1-target writes.
// Pure prompt-string presence tests. True behavioral verification needs
// LLM eval (out of scope); this catches accidental regression of the
// new policy block via a prompt edit elsewhere.

describe("MAIN_SYSTEM_PROMPT — reversible 1-target autonomy", () => {
  it("contains the new section heading", () => {
    expect(MAIN_SYSTEM_PROMPT).toContain(
      "Reversible single-target writes — execute, don't confirm"
    );
  });

  it("calls out the unambiguous verb + single target + reversible triple", () => {
    expect(MAIN_SYSTEM_PROMPT).toContain(
      "exactly ONE matching target after read-tool lookup"
    );
    expect(MAIN_SYSTEM_PROMPT).toContain("the action is reversible");
  });

  it("instructs the agent to execute in the SAME assistant turn", () => {
    expect(MAIN_SYSTEM_PROMPT).toContain(
      "execute the tool directly in the SAME assistant turn"
    );
  });

  it("preserves explicit confirm-on-destructive carve-out", () => {
    // The new section MUST sit ABOVE the existing destructive block —
    // destructive deletes still require confirmation.
    const autonomyIdx = MAIN_SYSTEM_PROMPT.indexOf(
      "Reversible single-target writes"
    );
    const destructiveIdx = MAIN_SYSTEM_PROMPT.indexOf(
      "Destructive operations:"
    );
    expect(autonomyIdx).toBeGreaterThan(-1);
    expect(destructiveIdx).toBeGreaterThan(-1);
    expect(autonomyIdx).toBeLessThan(destructiveIdx);
  });

  it("lists confirm-only carve-outs (destructive / ambiguous / guess)", () => {
    expect(MAIN_SYSTEM_PROMPT).toContain("destructive (delete)");
    expect(MAIN_SYSTEM_PROMPT).toContain(
      "target is ambiguous (multiple candidates)"
    );
    expect(MAIN_SYSTEM_PROMPT).toContain('verb is reversal-prone');
  });
});
