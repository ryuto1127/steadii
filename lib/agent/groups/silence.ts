import "server-only";
import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  groupProjectMembers,
  groupProjects,
  type GroupProjectMemberStatus,
} from "@/lib/db/schema";
import { refreshMemberActivity } from "./detect";

// Silence threshold: 14 days as locked in `project_wave_3_design.md`.
// Beyond this window without a member-reply, the member status flips to
// 'silent'. The queue surfaces a Type C card per silent member; user
// click upgrades to a Type B drafted check-in.
export const SILENCE_THRESHOLD_DAYS = 14;

export type SilenceTickReport = {
  groupsScanned: number;
  membersTransitioned: number;
};

export async function runGroupSilenceTick(
  now: Date = new Date()
): Promise<SilenceTickReport> {
  const allGroups = await db
    .select({ id: groupProjects.id, userId: groupProjects.userId })
    .from(groupProjects)
    .where(eq(groupProjects.status, "active"));
  let transitioned = 0;
  for (const g of allGroups) {
    try {
      // Refresh activity FIRST so a member who just emailed today
      // doesn't get tagged silent based on yesterday's snapshot.
      await refreshMemberActivity(g.id, g.userId);
      const updated = await applySilenceForGroup(g.id, now);
      transitioned += updated;
    } catch {
      // One group failing shouldn't stop the rest.
    }
  }
  return { groupsScanned: allGroups.length, membersTransitioned: transitioned };
}

export async function applySilenceForGroup(
  groupProjectId: string,
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(
    now.getTime() - SILENCE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
  );
  // Members whose last-responded is older than cutoff AND still 'active'
  // → flip to 'silent'. The reverse (silent → active) fires when the
  // member replies again, handled in refreshMemberActivity by leaving
  // lastRespondedAt fresh and a separate update below.

  // Step 1: silent members whose last activity is now fresh → active
  const reactivated = await db
    .update(groupProjectMembers)
    .set({ status: "active" as GroupProjectMemberStatus })
    .where(
      and(
        eq(groupProjectMembers.groupProjectId, groupProjectId),
        eq(groupProjectMembers.status, "silent" as GroupProjectMemberStatus),
        isNotNull(groupProjectMembers.lastRespondedAt),
        sql`${groupProjectMembers.lastRespondedAt} >= ${cutoff}`
      )
    )
    .returning({ email: groupProjectMembers.email });

  // Step 2: active members whose last activity is older than cutoff → silent
  const silenced = await db
    .update(groupProjectMembers)
    .set({ status: "silent" as GroupProjectMemberStatus })
    .where(
      and(
        eq(groupProjectMembers.groupProjectId, groupProjectId),
        eq(groupProjectMembers.status, "active" as GroupProjectMemberStatus),
        isNotNull(groupProjectMembers.lastRespondedAt),
        lt(groupProjectMembers.lastRespondedAt, cutoff)
      )
    )
    .returning({ email: groupProjectMembers.email });

  return reactivated.length + silenced.length;
}

// Pure helper used by the test suite to verify the silence rule without
// touching the DB.
export function isSilent(args: {
  lastRespondedAt: Date | null;
  now: Date;
  thresholdDays?: number;
}): boolean {
  const { lastRespondedAt, now, thresholdDays = SILENCE_THRESHOLD_DAYS } = args;
  if (!lastRespondedAt) return false;
  const cutoff = new Date(
    now.getTime() - thresholdDays * 24 * 60 * 60 * 1000
  );
  return lastRespondedAt < cutoff;
}
