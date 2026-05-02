import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  groupProjectMembers: {},
  groupProjects: {},
}));
vi.mock("drizzle-orm", () => {
  const id = (..._args: unknown[]) => ({});
  return {
    and: id,
    eq: id,
    isNotNull: id,
    lt: id,
    sql: Object.assign(
      (strings: TemplateStringsArray) => strings.join(""),
      { raw: () => ({}) }
    ),
  };
});
vi.mock("@/lib/agent/groups/detect", () => ({
  refreshMemberActivity: vi.fn(),
}));

import { isSilent, SILENCE_THRESHOLD_DAYS } from "@/lib/agent/groups/silence";

describe("isSilent", () => {
  const now = new Date("2026-05-02T00:00:00Z");

  it("returns false when there is no last response", () => {
    expect(isSilent({ lastRespondedAt: null, now })).toBe(false);
  });

  it("returns false when the last response is within the 14-day window", () => {
    const within = new Date(
      now.getTime() - (SILENCE_THRESHOLD_DAYS - 1) * 24 * 60 * 60 * 1000
    );
    expect(isSilent({ lastRespondedAt: within, now })).toBe(false);
  });

  it("returns true when the last response is older than the 14-day window", () => {
    const past = new Date(
      now.getTime() - (SILENCE_THRESHOLD_DAYS + 1) * 24 * 60 * 60 * 1000
    );
    expect(isSilent({ lastRespondedAt: past, now })).toBe(true);
  });

  it("respects a custom threshold override", () => {
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    expect(
      isSilent({ lastRespondedAt: sevenDaysAgo, now, thresholdDays: 5 })
    ).toBe(true);
    expect(
      isSilent({ lastRespondedAt: sevenDaysAgo, now, thresholdDays: 10 })
    ).toBe(false);
  });

  it("treats the boundary as not-yet-silent (strict less-than)", () => {
    // Exactly threshold days ago should NOT be silent — silence kicks in
    // beyond the threshold per the cron's lt() comparator.
    const exact = new Date(
      now.getTime() - SILENCE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
    );
    expect(isSilent({ lastRespondedAt: exact, now })).toBe(false);
  });
});
