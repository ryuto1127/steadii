import "server-only";
import { db } from "@/lib/db/client";
import {
  users,
  subscriptions,
  redeemCodes,
  redemptions,
} from "@/lib/db/schema";
import { and, desc, eq, gt } from "drizzle-orm";
import { env } from "@/lib/env";
import type { Plan } from "./plan";

export type EffectivePlan =
  | { plan: "admin"; source: "flag" }
  | { plan: "pro"; source: "stripe"; until: Date | null }
  | { plan: "student"; source: "stripe"; until: Date | null }
  // Transitional: populated from the legacy redeemCodes/redemptions tables.
  // Friend codes are moving to Stripe Coupons (100% off 3mo); once the last
  // pre-migration friend redemption expires, this path and the underlying
  // tables are removed (Commit 7).
  | { plan: "pro"; source: "friend_redemption"; until: Date }
  | { plan: "free"; source: "default" };

export async function getEffectivePlan(userId: string): Promise<EffectivePlan> {
  const now = new Date();

  // 1. Admin flag — direct bypass of everything, checked first.
  // Replaces the older "admin redemption" mechanism; run scripts/backfill-
  // admin-flag.ts once to populate is_admin for pre-existing admin redemptions.
  const [userRow] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (userRow?.isAdmin) {
    return { plan: "admin", source: "flag" };
  }

  // 2. Active Stripe subscription. price_id tells us which tier.
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
    const tier = planFromStripePriceId(sub.stripePriceId);
    if (tier === "student") {
      return {
        plan: "student",
        source: "stripe",
        until: sub.currentPeriodEnd ?? null,
      };
    }
    return {
      plan: "pro",
      source: "stripe",
      until: sub.currentPeriodEnd ?? null,
    };
  }

  // 3. Active friend redemption — transitional, see comment on EffectivePlan.
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

// Map a Stripe price_id to the plan tier it represents. Falls back to "pro"
// for any unknown price (legacy STRIPE_PRICE_ID_PRO, manual promotional
// prices, etc.) so we fail open rather than downgrade a paying user.
export function planFromStripePriceId(
  priceId: string | null
): "pro" | "student" {
  if (!priceId) return "pro";
  const e = env();
  if (e.STRIPE_PRICE_STUDENT_4MO && priceId === e.STRIPE_PRICE_STUDENT_4MO) {
    return "student";
  }
  return "pro";
}

// Quota lookup — admin is a bypass, not a tier, so it collapses to "pro"
// for limit purposes (we still gate on isUnlimitedPlan() below to skip the
// quota check entirely for admins).
export async function getPlanForLimits(userId: string): Promise<Plan> {
  const eff = await getEffectivePlan(userId);
  if (eff.plan === "free") return "free";
  if (eff.plan === "student") return "student";
  return "pro";
}

export async function isUnlimitedPlan(userId: string): Promise<boolean> {
  // Cheaper than getEffectivePlan: just check the flag directly. Keeps
  // credit-gate hot paths fast.
  const [row] = await db
    .select({ isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.isAdmin === true;
}

// Keep users.plan in sync with the effective plan so Settings shows the
// right tier. Admin doesn't flip the column (it's orthogonal — an admin may
// or may not also hold a paid subscription). Source of truth for gating is
// still getEffectivePlan(); this column is display-only.
export async function syncUsersPlanColumn(userId: string): Promise<void> {
  const eff = await getEffectivePlan(userId);
  let target: Plan;
  if (eff.plan === "admin") {
    // Don't overwrite whatever the admin's underlying paid/free tier is.
    return;
  } else if (eff.plan === "student") {
    target = "student";
  } else if (eff.plan === "free") {
    target = "free";
  } else {
    target = "pro";
  }
  await db.update(users).set({ plan: target }).where(eq(users.id, userId));
}
