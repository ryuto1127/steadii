import { describe, expect, it, beforeEach, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const state = {
    isAdmin: false,
    friendRedemptions: [] as Array<{ effectiveUntil: Date; type: "admin" | "friend" }>,
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
    orderBy: () => ({ limit: () => rows }),
    innerJoin: () => ({
      where: () => ({
        orderBy: () => ({ limit: () => rows }),
      }),
    }),
  });

  const db = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: () => {
          if (table.__name === "users")
            return chain([{ isAdmin: state.isAdmin }]);
          if (table.__name === "subscriptions")
            return chain(state.subscription ? [state.subscription] : []);
          return chain([]);
        },
        innerJoin: () => ({
          where: (filter: unknown) => {
            const s = JSON.stringify(filter ?? {});
            const rows = s.includes('"val":"friend"')
              ? state.friendRedemptions
              : [];
            return {
              orderBy: () => ({ limit: () => rows }),
            };
          },
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
  };
  return { state, db };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.db }));
vi.mock("@/lib/db/schema", () => ({
  users: { __name: "users", id: "id", plan: "plan", isAdmin: "isAdmin" },
  subscriptions: {
    __name: "subscriptions",
    userId: "userId",
    status: "status",
    currentPeriodEnd: "currentPeriodEnd",
    stripePriceId: "stripePriceId",
  },
  redemptions: {
    __name: "redemptions",
    userId: "userId",
    codeId: "codeId",
    effectiveUntil: "effectiveUntil",
  },
  redeemCodes: { __name: "redeem_codes", id: "id", type: "type" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (_c: unknown, val: unknown) => ({ __op: "eq", val }),
  and: (...children: unknown[]) => ({ __op: "and", children }),
  gt: (_c: unknown, val: unknown) => ({ __op: "gt", val }),
  desc: () => ({}),
}));
vi.mock("@/lib/env", () => ({
  env: () => ({
    STRIPE_PRICE_STUDENT_4MO: "price_student_4mo",
  }),
}));

import { getEffectivePlan } from "@/lib/billing/effective-plan";

beforeEach(() => {
  hoist.state.isAdmin = false;
  hoist.state.friendRedemptions = [];
  hoist.state.subscription = null;
});

describe("getEffectivePlan precedence", () => {
  it("is_admin flag beats everything", async () => {
    hoist.state.isAdmin = true;
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      stripePriceId: "price_pro_monthly",
    };
    hoist.state.friendRedemptions = [
      { effectiveUntil: new Date(Date.now() + 86_400_000), type: "friend" },
    ];
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("admin");
    if (eff.plan === "admin") expect(eff.source).toBe("flag");
  });

  it("active Pro Stripe subscription beats friend redemption", async () => {
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
      stripePriceId: "price_pro_monthly",
    };
    hoist.state.friendRedemptions = [
      { effectiveUntil: new Date(Date.now() + 86_400_000), type: "friend" },
    ];
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

  it("friend redemption gives Pro when no Stripe subscription", async () => {
    hoist.state.friendRedemptions = [
      { effectiveUntil: new Date(Date.now() + 86_400_000), type: "friend" },
    ];
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("pro");
    if (eff.plan === "pro") expect(eff.source).toBe("friend_redemption");
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
