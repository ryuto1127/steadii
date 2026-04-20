import "server-only";
import { db } from "@/lib/db/client";
import {
  users,
  subscriptions,
  redeemCodes,
  redemptions,
} from "@/lib/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import type { Plan } from "./plan";

export type EffectivePlan =
  | { plan: "admin"; source: "redemption"; until: Date }
  | { plan: "pro"; source: "stripe"; until: Date | null }
  | { plan: "pro"; source: "friend_redemption"; until: Date }
  | { plan: "free"; source: "default" };

export async function getEffectivePlan(userId: string): Promise<EffectivePlan> {
  const now = new Date();

  // 1. Active admin redemption takes precedence.
  const adminRows = await db
    .select({
      effectiveUntil: redemptions.effectiveUntil,
      type: redeemCodes.type,
    })
    .from(redemptions)
    .innerJoin(redeemCodes, eq(redemptions.codeId, redeemCodes.id))
    .where(
      and(
        eq(redemptions.userId, userId),
        eq(redeemCodes.type, "admin"),
        gt(redemptions.effectiveUntil, now)
      )
    )
    .orderBy(desc(redemptions.effectiveUntil))
    .limit(1);
  if (adminRows.length) {
    return {
      plan: "admin",
      source: "redemption",
      until: adminRows[0].effectiveUntil,
    };
  }

  // 2. Active Pro subscription.
  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);
  if (
    sub &&
    (sub.status === "active" || sub.status === "trialing") &&
    (!sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > now.getTime())
  ) {
    return { plan: "pro", source: "stripe", until: sub.currentPeriodEnd ?? null };
  }

  // 3. Active friend redemption.
  const friendRows = await db
    .select({
      effectiveUntil: redemptions.effectiveUntil,
      type: redeemCodes.type,
    })
    .from(redemptions)
    .innerJoin(redeemCodes, eq(redemptions.codeId, redeemCodes.id))
    .where(
      and(
        eq(redemptions.userId, userId),
        eq(redeemCodes.type, "friend"),
        gt(redemptions.effectiveUntil, now)
      )
    )
    .orderBy(desc(redemptions.effectiveUntil))
    .limit(1);
  if (friendRows.length) {
    return {
      plan: "pro",
      source: "friend_redemption",
      until: friendRows[0].effectiveUntil,
    };
  }

  // 4. Default free.
  return { plan: "free", source: "default" };
}

// Back-compat helper used by upload routes and orchestrator.
// Admin collapses to "pro" for plan-limits lookup, but credit enforcement
// also checks isUnlimitedPlan() below and skips the quota gate.
export async function getPlanForLimits(userId: string): Promise<Plan> {
  const eff = await getEffectivePlan(userId);
  return eff.plan === "free" ? "free" : "pro";
}

export async function isUnlimitedPlan(userId: string): Promise<boolean> {
  const eff = await getEffectivePlan(userId);
  return eff.plan === "admin";
}

// Keep the raw column in sync so free users' self-service billing UI shows
// the right tier when they view settings. Not load-bearing (the real source
// of truth is getEffectivePlan) but handy for the Free/Pro badge.
export async function syncUsersPlanColumn(userId: string): Promise<void> {
  const eff = await getEffectivePlan(userId);
  const target: Plan = eff.plan === "free" ? "free" : "pro";
  await db.update(users).set({ plan: target }).where(eq(users.id, userId));
}
