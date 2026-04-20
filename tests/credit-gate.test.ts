import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ usageEvents: {}, users: {}, blobAssets: {} }));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  gte: () => ({}),
  isNull: () => ({}),
  sum: (col: unknown) => col,
}));
vi.mock("@/lib/billing/plan", () => ({
  getPlanLimits: async () => ({
    plan: "free",
    monthlyCredits: 250,
    maxFileBytes: 0,
    maxTotalBytes: 0,
  }),
  PLAN_LIMITS: {
    free: { monthlyCredits: 250, maxFileBytes: 0, maxTotalBytes: 0 },
    pro: { monthlyCredits: 1000, maxFileBytes: 0, maxTotalBytes: 0 },
  },
  prettyBytes: (n: number) => `${n} B`,
  getUserPlan: async () => "free",
}));

import {
  BillingQuotaExceededError,
  currentMonthWindow,
} from "@/lib/billing/credits";

describe("credit window math", () => {
  it("returns a window starting on the first of the UTC month", () => {
    const now = new Date("2026-04-19T10:00:00Z");
    const { start, end } = currentMonthWindow(now);
    expect(start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });

  it("handles December→January rollover", () => {
    const now = new Date("2026-12-31T23:59:00Z");
    const { end } = currentMonthWindow(now);
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("BillingQuotaExceededError", () => {
  it("carries a stable code and a balance payload", () => {
    const err = new BillingQuotaExceededError({
      plan: "free",
      used: 250,
      limit: 250,
      remaining: 0,
      windowStart: new Date(),
      windowEnd: new Date(),
      exceeded: true,
      nearLimit: true,
    });
    expect(err.code).toBe("BILLING_QUOTA_EXCEEDED");
    expect(err.balance.plan).toBe("free");
    expect(err.balance.used).toBe(250);
  });
});
