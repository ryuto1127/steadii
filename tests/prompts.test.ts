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

describe("main system prompt — forest-rules preamble", () => {
  it("opens with the OPERATING PRINCIPLES (forest) header", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(
      /^# STEADII — OPERATING PRINCIPLES \(the forest\)/
    );
  });

  it("leads with the proactivity principle (P1 — move before you're asked)", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/MOVE BEFORE YOU'RE ASKED/);
  });

  it("carries all nine governing principles", () => {
    for (const p of ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9"]) {
      expect(MAIN_SYSTEM_PROMPT).toMatch(new RegExp(`${p} —`));
    }
  });

  it("states the principle-wins precedence over detailed instructions", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/the principle wins/);
  });

  it("keeps the existing operational body below the preamble (additive, not a replacement)", () => {
    // The detailed EMAIL REPLY WORKFLOW MUSTs still live in the prompt —
    // Stage 1 is additive; later stages consolidate the body.
    expect(MAIN_SYSTEM_PROMPT).toMatch(/EMAIL REPLY WORKFLOW/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/TIMEZONE RULES \(strict\)/);
  });
});

describe("main system prompt — canonical timezone rule (CODE CONVENTION 1)", () => {
  // Stage 2 — the timezone rule is consolidated into ONE canonical source
  // (CODE CONVENTION 1); other surfaces defer to it. These assertions pin
  // the four behavioral pillars so a future edit can't silently drop one.

  it("marks CODE CONVENTION 1 as the canonical single source of truth", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(
      /1\. Timezone \(CANONICAL — single source of truth/
    );
  });

  it("carries the infer pillar (sender TZ from domain + body, tool when uncertain)", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/INFER the sender's TZ/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/infer_sender_timezone/);
  });

  it("carries the < 0.6 low-confidence-implicit-TZ -> confirm gate", () => {
    // The gate the handoff requires to survive consolidation. Implicit TZ
    // + confidence < 0.6 + affects a cited time => route to confirmation,
    // never a silent guessed-TZ draft.
    expect(MAIN_SYSTEM_PROMPT).toMatch(/GATE/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/confidence is < 0\.6/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(
      /do NOT draft with a guessed TZ: route to confirmation/
    );
  });

  it("carries the convert pillar (tool only, no mental math, no reversed direction, both range endpoints)", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/CONVERT sender → user with the .convert_timezone. tool/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/Never do TZ math yourself/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/never reverse the direction/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(/Convert BOTH endpoints of a range/);
  });

  it("carries the display pillar (dual-TZ, sender-first ordering, friendly names)", () => {
    expect(MAIN_SYSTEM_PROMPT).toMatch(/sender-TZ FIRST then user-TZ/);
    expect(MAIN_SYSTEM_PROMPT).toMatch(
      /<sender-TZ> \/ <date>\(<day>\) HH:MM <user-TZ>/
    );
    expect(MAIN_SYSTEM_PROMPT).toMatch(/never raw IANA strings/);
  });

  it("makes the TIMEZONE RULES (strict) body defer to the canonical rule, not restate it", () => {
    // The body section keeps its (test-locked) heading but now points at
    // CODE CONVENTION 1 instead of carrying a second full copy.
    expect(MAIN_SYSTEM_PROMPT).toMatch(
      /Follow CODE CONVENTION 1 \(the canonical timezone rule/
    );
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
