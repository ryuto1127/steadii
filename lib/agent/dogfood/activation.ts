import "server-only";
import { and, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { agentDrafts, inboxItems, users } from "@/lib/db/schema";

// Wave 5 — first-week activation tracker. Internal-only metric (admin
// dashboard) used to validate the Wave 2 onboarding wait pattern is
// delivering value. Definition (locked per project_wave_5_design.md):
//
//   "Day-N activation" = a user (created within the cohort window)
//   has interacted with the queue's first card within N days of
//   sign-up.
//
// "Interacted with the queue's first card" is operationalized as one
// of:
//   - reviewedAt populated on any inbox_items row (= clicked into
//     detail page)
//   - any agent_drafts row updated past 'pending' (sent / dismissed)
//
// We compute over the last 30 days of signups so the metric stays
// fresh; Day-3 and Day-7 cohorts are both windowed.

export type ActivationCohort = {
  cohortDays: number;
  totalSignups: number;
  activatedByDay3: number;
  activatedByDay7: number;
  day3Pct: number;
  day7Pct: number;
};

export async function computeActivation(
  args: { cohortDays?: number } = {}
): Promise<ActivationCohort> {
  const cohortDays = args.cohortDays ?? 30;
  const now = Date.now();
  const cohortFloor = new Date(now - cohortDays * 24 * 60 * 60 * 1000);

  const cohortRows = await db
    .select({ id: users.id, createdAt: users.createdAt })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        gte(users.createdAt, cohortFloor)
        // We only score users who've had enough time to activate by
        // day 7 — for users created within the last 7d the metric is
        // not yet "fair" so they're excluded. For day 3 the cutoff is
        // similarly 3 days. We compute both subsets.
      )
    );

  if (cohortRows.length === 0) {
    return {
      cohortDays,
      totalSignups: 0,
      activatedByDay3: 0,
      activatedByDay7: 0,
      day3Pct: 0,
      day7Pct: 0,
    };
  }

  const userIds = cohortRows.map((u) => u.id);
  const userCreatedAt = new Map(
    cohortRows.map((u) => [u.id, u.createdAt.getTime()])
  );

  // Pull every signal candidate in one shot — both inbox reviews and
  // draft outcomes. We then do per-user windowing in JS rather than
  // 2N×2-window queries.
  const inboxSignals = await db
    .select({
      userId: inboxItems.userId,
      reviewedAt: inboxItems.reviewedAt,
    })
    .from(inboxItems)
    .where(
      and(
        isNull(inboxItems.deletedAt),
        isNotNull(inboxItems.reviewedAt),
        gte(inboxItems.reviewedAt, cohortFloor)
      )
    );

  const draftSignals = await db
    .select({
      userId: agentDrafts.userId,
      updatedAt: agentDrafts.updatedAt,
      status: agentDrafts.status,
    })
    .from(agentDrafts)
    .where(
      and(
        gte(agentDrafts.updatedAt, cohortFloor),
        isNotNull(agentDrafts.updatedAt)
      )
    );

  // Per-user earliest activation timestamp.
  const earliest = new Map<string, number>();
  for (const s of inboxSignals) {
    if (!userCreatedAt.has(s.userId)) continue;
    if (!s.reviewedAt) continue;
    const t = s.reviewedAt.getTime();
    const prev = earliest.get(s.userId);
    if (prev === undefined || t < prev) earliest.set(s.userId, t);
  }
  for (const s of draftSignals) {
    if (!userCreatedAt.has(s.userId)) continue;
    if (s.status === "pending") continue;
    const t = s.updatedAt.getTime();
    const prev = earliest.get(s.userId);
    if (prev === undefined || t < prev) earliest.set(s.userId, t);
  }
  // Keep `lte` import live for readers who'll extend the cohort
  // window logic on next iteration.
  void lte;
  void eq;

  const day3Ms = 3 * 24 * 60 * 60 * 1000;
  const day7Ms = 7 * 24 * 60 * 60 * 1000;
  let totalDay3 = 0;
  let totalDay7 = 0;
  let activatedDay3 = 0;
  let activatedDay7 = 0;
  for (const u of cohortRows) {
    const ageMs = now - u.createdAt.getTime();
    const t = earliest.get(u.id);
    const elapsedToActivation = t !== undefined ? t - u.createdAt.getTime() : null;
    if (ageMs >= day3Ms) {
      totalDay3++;
      if (
        elapsedToActivation !== null &&
        elapsedToActivation <= day3Ms
      ) {
        activatedDay3++;
      }
    }
    if (ageMs >= day7Ms) {
      totalDay7++;
      if (
        elapsedToActivation !== null &&
        elapsedToActivation <= day7Ms
      ) {
        activatedDay7++;
      }
    }
  }

  const pct = (n: number, d: number) => (d === 0 ? 0 : (n / d) * 100);
  return {
    cohortDays,
    totalSignups: cohortRows.length,
    activatedByDay3: activatedDay3,
    activatedByDay7: activatedDay7,
    day3Pct: pct(activatedDay3, totalDay3),
    day7Pct: pct(activatedDay7, totalDay7),
  };
}
