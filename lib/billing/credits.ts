import "server-only";
import { db } from "@/lib/db/client";
import { usageEvents, users, topupBalances } from "@/lib/db/schema";
import { and, eq, gte, gt, sum } from "drizzle-orm";
import { getPlanLimits, type Plan } from "./plan";

export type CreditBalance = {
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  // Top-up is a separate bucket that stacks on top of the monthly pool.
  // It expires 90 days after purchase and each pack's credits are tracked
  // independently. For display we surface the aggregated remaining.
  topupRemaining: number;
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

// Monthly credit window anchored to the user's sign-up date-of-month, not
// the calendar. User created on the 15th → window resets on the 15th of each
// month. Sign-up on a high day (28–31) clamps to the last day of months that
// don't have it (Feb especially). See project_decisions.md.
export function creditWindowForAnchor(
  createdAt: Date,
  now: Date = new Date()
): { start: Date; end: Date } {
  const anchorDay = createdAt.getUTCDate();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();

  // Decide which month the CURRENT window starts in.
  const startMonth = today >= clampedAnchorDay(anchorDay, year, month)
    ? month
    : month - 1;

  const start = anchorMidnight(anchorDay, year, startMonth);
  const end = anchorMidnight(anchorDay, year, startMonth + 1);
  return { start, end };
}

// Last-day-of-month clamp: e.g. anchor day 31 in February → 28/29.
function clampedAnchorDay(anchorDay: number, year: number, month: number): number {
  // Day 0 of (month+1) === last day of `month` in JS Date.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.min(anchorDay, lastDay);
}

function anchorMidnight(anchorDay: number, year: number, month: number): Date {
  // Normalize month overflow/underflow; then clamp the day for short months.
  const normalized = new Date(Date.UTC(year, month, 1));
  const ny = normalized.getUTCFullYear();
  const nm = normalized.getUTCMonth();
  return new Date(Date.UTC(ny, nm, clampedAnchorDay(anchorDay, ny, nm)));
}

// Legacy name kept as a thin wrapper so older callers / tests don't break;
// new code should use creditWindowForAnchor directly. Falls back to the
// calendar month when no anchor is available (e.g. the admin Stats page
// summing across all users — aggregate view, not per-user).
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

  const [userRow] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const createdAt = userRow?.createdAt ?? new Date();
  const { start, end } = creditWindowForAnchor(createdAt);
  const now = new Date();

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

  // Sum non-expired top-up packs. For α we don't decrement per-operation —
  // top-up just extends the ceiling by its total purchased amount. When the
  // monthly pool is exhausted, users keep going against top-up until
  // monthly+topup together are exceeded. Good enough for ≤10 users; cross-
  // cycle accounting accuracy is a post-α refinement.
  const [topupRow] = await db
    .select({ total: sum(topupBalances.creditsRemaining) })
    .from(topupBalances)
    .where(
      and(
        eq(topupBalances.userId, userId),
        gt(topupBalances.expiresAt, now)
      )
    );
  const topupTotal = Number(topupRow?.total ?? 0);
  const topupUsedThisCycle = Math.min(topupTotal, Math.max(0, used - monthlyCredits));
  const topupRemaining = topupTotal - topupUsedThisCycle;

  const combinedCeiling = monthlyCredits + topupTotal;

  return {
    plan,
    used,
    limit: monthlyCredits,
    remaining,
    topupRemaining,
    windowStart: start,
    windowEnd: end,
    exceeded: used >= combinedCeiling,
    nearLimit: used >= combinedCeiling * 0.8,
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
