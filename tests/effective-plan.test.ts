import { describe, expect, it, beforeEach, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const state = {
    adminRedemptions: [] as Array<{ effectiveUntil: Date; type: "admin" | "friend" }>,
    friendRedemptions: [] as Array<{ effectiveUntil: Date; type: "admin" | "friend" }>,
    subscription: null as
      | {
          status: string;
          currentPeriodEnd: Date | null;
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
          if (table.__name === "subscriptions")
            return chain(state.subscription ? [state.subscription] : []);
          return chain([]);
        },
        innerJoin: () => ({
          where: (filter: unknown) => {
            // Determine which redemption type from filter string
            const s = JSON.stringify(filter ?? {});
            const rows = s.includes('"val":"admin"')
              ? state.adminRedemptions
              : state.friendRedemptions;
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
  users: { __name: "users", id: "id", plan: "plan" },
  subscriptions: {
    __name: "subscriptions",
    userId: "userId",
    status: "status",
    currentPeriodEnd: "currentPeriodEnd",
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

import { getEffectivePlan } from "@/lib/billing/effective-plan";

beforeEach(() => {
  hoist.state.adminRedemptions = [];
  hoist.state.friendRedemptions = [];
  hoist.state.subscription = null;
});

describe("getEffectivePlan precedence", () => {
  it("admin redemption beats everything", async () => {
    hoist.state.adminRedemptions = [
      { effectiveUntil: new Date(Date.now() + 86_400_000), type: "admin" },
    ];
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    };
    hoist.state.friendRedemptions = [
      { effectiveUntil: new Date(Date.now() + 86_400_000), type: "friend" },
    ];
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("admin");
  });

  it("active Pro subscription beats friend redemption", async () => {
    hoist.state.subscription = {
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    };
    hoist.state.friendRedemptions = [
      { effectiveUntil: new Date(Date.now() + 86_400_000), type: "friend" },
    ];
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("pro");
    if (eff.plan === "pro") expect(eff.source).toBe("stripe");
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
    };
    const eff = await getEffectivePlan("u");
    expect(eff.plan).toBe("free");
  });
});
