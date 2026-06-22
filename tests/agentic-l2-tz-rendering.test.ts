import { describe, expect, it, vi } from "vitest";

// engineer-45 — regression: the agentic L2 system prompt MUST carry the
// TZ rules, scheduling-domain rules, draft-body dual-TZ rule, and
// context-reuse block. Stripping any of these has historically caused
// the agent to silently mis-render timezones in the final draft body
// (see 2026-05-12 Ryuto dogfood transcript).

vi.mock("server-only", () => ({}));

import { AGENTIC_L2_SYSTEM_PROMPT } from "@/lib/agent/email/agentic-l2-prompt";

describe("AGENTIC_L2_SYSTEM_PROMPT — timezone + scheduling rules", () => {
  it("contains the TIMEZONE RULES block", () => {
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/TIMEZONE RULES/);
  });

  it("forbids LLM-side TZ math", () => {
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/do not compute timezone offsets yourself/i);
  });

  it("references the infer_sender_timezone tool for TZ inference", () => {
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/infer_sender_timezone/);
  });

  it("requires dual-TZ rendering in the draft body when sender TZ differs", () => {
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/DRAFT BODY TZ DISPLAY/);
    // 2026-05-18 — was /JST.*PT/. The prompt was rewritten to use
    // abstract <sender-TZ> / <user-TZ> placeholders so the example
    // doesn't bake the maintainer's actual case (JP↔Pacific) into
    // the agent's reasoning prior. The behavioral rule (sender-side
    // first, user-side second, separated by " / ") is still asserted —
    // just via the placeholder shape rather than literal abbreviations.
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(
      /<sender-TZ>.*<user-TZ>|sender-TZ.*\/ .*user-TZ/
    );
  });

  it("encodes the slot-pool rule (range + duration = pick within)", () => {
    // Stage 3 — the heading was renamed from "SCHEDULING DOMAIN RULES" to
    // "SCHEDULING FEASIBILITY & RANGE" when scheduling rules were
    // consolidated under the canonical block; the slot-pool behavior is
    // unchanged.
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/SCHEDULING FEASIBILITY & RANGE/);
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/slot-pool/);
  });

  it("encodes the context-reuse rule (no duplicate tool calls)", () => {
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/CONTEXT REUSE/);
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/Do not call the same tool/);
  });

  it("preserves the low-confidence (<0.6) implicit-TZ -> confirm gate (stage-2 consolidation)", () => {
    // The canonical gate also lives here at decision rule 3 — implicit TZ
    // + null/low-confidence + affects a cited time => queue_user_confirmation
    // before write_draft. Consolidation must not drop it.
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/confidence < 0\.6/);
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(
      /queue_user_confirmation for the timezone before write_draft/
    );
  });
});
