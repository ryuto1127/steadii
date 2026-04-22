import "server-only";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export type Plan = "free" | "student" | "pro";

export type PlanLimits = {
  monthlyCredits: number;
  maxFileBytes: number;
  maxTotalBytes: number;
};

// Credit figures are in the new unit (1 credit = $0.005 of token spend).
// Free raised from 250 → 300 to soften the 2x-per-operation cost under the
// new unit; see project_decisions.md.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    monthlyCredits: 300,
    maxFileBytes: 5 * 1024 * 1024,
    maxTotalBytes: 200 * 1024 * 1024,
  },
  student: {
    // Student capability is identical to Pro — the price difference (student
    // discount) is the only delta. Same credit pool, same storage.
    monthlyCredits: 1000,
    maxFileBytes: 50 * 1024 * 1024,
    maxTotalBytes: 2 * 1024 * 1024 * 1024,
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
  if (p === "pro") return "pro";
  if (p === "student") return "student";
  return "free";
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
