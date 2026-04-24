import { describe, expect, it } from "vitest";
import { usdToCredits } from "@/lib/agent/models";

// 2026-04-23 C7 fix: floor → round. These are the boundary cases we care
// about; see phase6-w2 prompt §17 and project_decisions.md.
describe("usdToCredits (round, 1 credit = $0.005)", () => {
  it("rounds half-up (0.003 → 1, was 0 under floor)", () => {
    // 0.003 * 200 = 0.6 → round = 1
    expect(usdToCredits(0.003)).toBe(1);
  });

  it("still rounds small sub-boundary costs to 0", () => {
    // 0.001 * 200 = 0.2 → round = 0
    expect(usdToCredits(0.001)).toBe(0);
    // 0.002 * 200 = 0.4 → round = 0
    expect(usdToCredits(0.002)).toBe(0);
  });

  it("exact boundary rounds to 1", () => {
    // 0.0025 * 200 = 0.5 → round = 1 (banker's would round to 0)
    expect(usdToCredits(0.0025)).toBe(1);
  });

  it("draft-sized task now rounds to 4, not 3", () => {
    // Memory target for L2 draft: ~3.9 credits → used to floor to 3.
    // 0.0195 * 200 = 3.9 → round = 4
    expect(usdToCredits(0.0195)).toBe(4);
  });

  it("classify-sized task still rounds to 0 on low inputs", () => {
    // Risk-pass "small" cost example from the prompt: ~0.24 credits.
    // 0.0012 * 200 = 0.24 → round = 0. Classify continues for free.
    expect(usdToCredits(0.0012)).toBe(0);
  });

  it("whole-number passthrough", () => {
    expect(usdToCredits(0)).toBe(0);
    expect(usdToCredits(1)).toBe(200);
  });
});
