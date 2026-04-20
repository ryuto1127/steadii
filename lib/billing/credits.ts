import "server-only";
import { db } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { and, eq, gte, sum } from "drizzle-orm";
import { getPlanLimits } from "./plan";

export type CreditBalance = {
  plan: "free" | "pro";
  used: number;
  limit: number;
  remaining: number;
  windowStart: Date;
  windowEnd: Date;
  exceeded: boolean;
  nearLimit: boolean;
};

export class BillingQuotaExceededError extends Error {
  code = "BILLING_QUOTA_EXCEEDED" as const;
  constructor(public balance: CreditBalance) {
    super("Monthly credit quota exceeded.");
  }
}

export function currentMonthWindow(now: Date = new Date()): {
  start: Date;
  end: Date;
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start, end };
}

export async function getCreditBalance(userId: string): Promise<CreditBalance> {
  const { plan, monthlyCredits } = await getPlanLimits(userId);
  const { start, end } = currentMonthWindow();

  const [row] = await db
    .select({ total: sum(usageEvents.creditsUsed) })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, start)
      )
    );

  const used = Number(row?.total ?? 0);
  const remaining = Math.max(0, monthlyCredits - used);

  return {
    plan,
    used,
    limit: monthlyCredits,
    remaining,
    windowStart: start,
    windowEnd: end,
    exceeded: used >= monthlyCredits,
    nearLimit: used >= monthlyCredits * 0.8,
  };
}

export async function assertCreditsAvailable(
  userId: string
): Promise<CreditBalance> {
  // Admin redemptions bypass quota entirely.
  const { isUnlimitedPlan } = await import("./effective-plan");
  const unlimited = await isUnlimitedPlan(userId);
  const balance = await getCreditBalance(userId);
  if (unlimited) return balance;
  if (balance.exceeded) throw new BillingQuotaExceededError(balance);
  return balance;
}
