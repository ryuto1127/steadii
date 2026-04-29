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

describe("main system prompt — eager-read rule", () => {
  // The orchestrator+OpenAI live-call intercept harness for asserting actual
  // tool invocations on "5/16学校休む" / "明日大学行けない" / "疲れた" is a
  // follow-up (would ~2x this PR). For now: assert the prompt string
  // contains the rules that drive the right behavior.

  it("declares that read tools execute eagerly and writes are proposed", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/Read tools execute eagerly/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/only write tools are proposed/);
  });

  it("references read mutability by tag", () => {
    expect(MAIN_SYSTEM_PROMPT).toContain('mutability: "read"');
    expect(MAIN_SYSTEM_PROMPT).toContain('mutability: "write"');
  });

  it("surfaces 5/16学校休む as an eager-read example, not a proposal", () => {
    // The repro scenario from the handoff. The example must show the read
    // path (calendar list / tasks list) firing before any proposal.
    expect(MAIN_SYSTEM_PROMPT).toMatch(/5\/16学校休む/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(
      /5\/16学校休む.*eagerly[\s\S]*propose/
    );
  });

  it("does not retain the old offer-everything-as-buttons example phrasing", () => {
    // Pre-fix examples opened with "offer drafts...". The fix must reframe
    // those as "eagerly: ...; then propose: ..." so the model's pattern-
    // matching changes.
    expect(MAIN_SYSTEM_PROMPT).not.toMatch(
      /明日大学に行けないかも.*→ look up tomorrow's classes\/events; offer drafts/
    );
  });

  it("forbids listing read tools in the Proposed actions block", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/Never list a read tool in this block/);
  });

  it("extends Action commitment to read intent", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/applies in reverse for read intent/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(
      /invoke the read tool in the SAME assistant turn/
    );
  });

  it("still tells the agent to stay quiet on pure venting", () => {
    // Existing rule must survive the rewrite — venting messages get no
    // tool calls and no proposals.
    expect(MAIN_SYSTEM_PROMPT).toMatch(/疲れた/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/No buttons. Just listen/);
  });
});
