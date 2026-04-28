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
  getUserPlan: async () => "free",
}));

import {
  BillingQuotaExceededError,
  creditWindowForAnchor,
  currentMonthWindow,
} from "@/lib/billing/credits";

describe("calendar-month window (legacy, for aggregate views)", () => {
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

describe("creditWindowForAnchor (per-user sign-up-date anchored)", () => {
  it("anchors to the user's sign-up day-of-month when today is past anchor", () => {
    const createdAt = new Date("2025-01-15T00:00:00Z");
    const now = new Date("2026-04-22T10:00:00Z");
    const { start, end } = creditWindowForAnchor(createdAt, now);
    expect(start.toISOString()).toBe("2026-04-15T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-05-15T00:00:00.000Z");
  });

  it("rolls back when today is before this month's anchor day", () => {
    const createdAt = new Date("2025-01-20T00:00:00Z");
    const now = new Date("2026-04-10T10:00:00Z");
    const { start, end } = creditWindowForAnchor(createdAt, now);
    expect(start.toISOString()).toBe("2026-03-20T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });

  it("clamps high anchor days (31) to last day of short months", () => {
    const createdAt = new Date("2025-01-31T00:00:00Z");
    // Today is Feb 10, 2026. Anchor day 31 in Feb clamps to 28.
    // Today (10) < 28, so window is Jan 31 → Feb 28.
    const now = new Date("2026-02-10T00:00:00Z");
    const { start, end } = creditWindowForAnchor(createdAt, now);
    expect(start.toISOString()).toBe("2026-01-31T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-02-28T00:00:00.000Z");
  });

  it("handles leap year February for anchor day 29", () => {
    const createdAt = new Date("2025-03-29T00:00:00Z");
    const now = new Date("2028-02-15T00:00:00Z"); // 2028 is a leap year
    const { start, end } = creditWindowForAnchor(createdAt, now);
    // Jan 29 → Feb 29 (2028 has Feb 29)
    expect(start.toISOString()).toBe("2028-01-29T00:00:00.000Z");
    expect(end.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("rolls January back into December of the prior year", () => {
    const createdAt = new Date("2024-06-25T00:00:00Z");
    const now = new Date("2026-01-10T00:00:00Z");
    const { start, end } = creditWindowForAnchor(createdAt, now);
    expect(start.toISOString()).toBe("2025-12-25T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-01-25T00:00:00.000Z");
  });
});

describe("BillingQuotaExceededError", () => {
  it("carries a stable code and a balance payload", () => {
    const err = new BillingQuotaExceededError({
      plan: "free",
      used: 250,
      limit: 250,
      remaining: 0,
      topupRemaining: 0,
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
