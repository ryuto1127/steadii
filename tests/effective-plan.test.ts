import { describe, expect, it, beforeEach, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const state = {
    isAdmin: false,
    trialStartedAt: null as Date | null,
    subscription: null as
      | {
          status: string;
          currentPeriodEnd: Date | null;
          stripePriceId: string | null;
        }
      | null,
  };

  const chain = (rows: unknown[]) => ({
    limit: () => rows,
  });

  const db = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: () => {
          if (table.__name === "users")
            return chain([
              {
                isAdmin: state.isAdmin,
                trialStartedAt: state.trialStartedAt,
              },
            ]);
          if (table.__name === "subscriptions")
            return chain(state.subscription ? [state.subscription] : []);
          return chain([]);
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  return { state, db };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.db }));
vi.mock("@/lib/db/schema", () => ({
  users: {
    __name: "users",
    id: "id",
    plan: "plan",
    isAdmin: "isAdmin",
    trialStartedAt: "trialStartedAt",
  },
  subscriptions: {
    __name: "subscriptions",
    userId: "userId",
    status: "status",
    currentPeriodEnd: "currentPeriodEnd",
    stripePriceId: "stripePriceId",
  },
}));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    STRIPE_PRICE_STUDENT_4MO: "price_student_4mo",
  }),
}));

import { getEffectivePlan } from "@/lib/billing/effective-plan";

beforeEach(() => {
  hoist.state.isAdmin = false;
  hoist.state.trialStartedAt = null;
  hoist.state.subscription = null;
});

describe("getEffectivePlan precedence", () => {
  it("is_admin flag beats active subscription", async () => {
    hoist.state.isAdmin = true;
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      stripePriceId: "price_pro_monthly",
    };
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("admin");
    if (eff.plan === "admin") expect(eff.source).toBe("flag");
  });

  it("active Pro Stripe subscription → pro", async () => {
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      stripePriceId: "price_pro_monthly",
    };
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("pro");
    if (eff.plan === "pro") expect(eff.source).toBe("stripe");
  });

  it("Student price_id maps to student tier", async () => {
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      stripePriceId: "price_student_4mo",
    };
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("student");
    if (eff.plan === "student") expect(eff.source).toBe("stripe");
  });

  it("unknown price_id falls back to pro (fail-open)", async () => {
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      stripePriceId: "price_legacy_unknown",
    };
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("pro");
  });

  it("14-day trial grants Pro when started within window", async () => {
    // Started 3 days ago → 11 days left of 14-day window
    hoist.state.trialStartedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("pro");
    if (eff.plan === "pro") expect(eff.source).toBe("trial");
  });

  it("trial expired → falls through to free", async () => {
    hoist.state.trialStartedAt = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("free");
  });

  it("active Stripe subscription beats active trial (no double-pro)", async () => {
    hoist.state.trialStartedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      stripePriceId: "price_pro_monthly",
    };
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("pro");
    if (eff.plan === "pro") expect(eff.source).toBe("stripe");
  });

  it("defaults to free", async () => {
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("free");
  });

  it("canceled Stripe subscription falls through to free", async () => {
    hoist.state.subscription = {
      status: "canceled",
      currentPeriodEnd: null,
      stripePriceId: "price_pro_monthly",
    };
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("free");
  });
});
