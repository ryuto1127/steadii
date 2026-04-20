import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type Plan = "free" | "pro";

export type PlanLimits = {
  monthlyCredits: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    monthlyCredits: 250,
    maxFileBytes: 5 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
  },
  pro: {
    monthlyCredits: 1000,
    maxFileBytes: 50 * 1024 * 1024,
    maxTotalBytes: 2 * 1024 * 1024 * 1024,
  },
};

export async function getUserPlan(userId: string): Promise<Plan> {
  // Effective plan respects active admin / Pro / friend-redemption sources.
  // Import lazily to avoid a circular dep with effective-plan.ts.
  const { getPlanForLimits } = await import("./effective-plan");
  return getPlanForLimits(userId);
}

export async function getUsersPlanColumn(userId: string): Promise<Plan> {
  const [row] = await db
    .select({ plan: users.plan })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const p = row?.plan;
  return p === "pro" ? "pro" : "free";
}

export async function getPlanLimits(userId: string): Promise<PlanLimits & { plan: Plan }> {
  const plan = await getUserPlan(userId);
  return { plan, ...PLAN_LIMITS[plan] };
}

export function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
