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
    // The exemplar phrase (JST + PT) must be present so the model sees
    // the format it should match.
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/JST.*PT/);
  });

  it("encodes the slot-pool rule (range + duration = pick within)", () => {
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/SCHEDULING DOMAIN RULES/);
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/slot-pool/);
  });

  it("encodes the context-reuse rule (no duplicate tool calls)", () => {
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/CONTEXT REUSE/);
    expect(AGENTIC_L2_SYSTEM_PROMPT).toMatch(/Do not call the same tool/);
  });
});
