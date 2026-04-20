import { describe, expect, it, beforeEach, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const state = { isUnlimited: false };
  return { state };
});

vi.mock("@/lib/billing/effective-plan", () => ({
  isUnlimitedPlan: async () => hoist.state.isUnlimited,
}));

import { isUnlimitedPlan } from "@/lib/billing/effective-plan";

beforeEach(() => {
  hoist.state.isUnlimited = false;
});

describe("admin gate uses isUnlimitedPlan", () => {
  it("returns true only while an admin redemption is active", async () => {
    expect(await isUnlimitedPlan("u")).toBe(false);
    hoist.state.isUnlimited = true;
    expect(await isUnlimitedPlan("u")).toBe(true);
  });
});
