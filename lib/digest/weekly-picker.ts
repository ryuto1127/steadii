import "server-only";
import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hourInTimezone } from "@/lib/digest/picker";

// ---------------------------------------------------------------------------
// Weekly retrospective digest picker — mirrors the daily picker shape, but
// the eligibility window is "Sunday 17:00 in user's IANA timezone, with a
// 6-day floor between sends". The cron runs hourly; for each tick we
// resolve which users' local Sunday 5pm crossed into the current hour
// AND whose `last_weekly_digest_sent_at` is either null or older than 6d.
//
// The 6-day floor (vs 7d) gives us tolerance around DST shifts the same
// way the daily picker uses 20h vs 24h. False positives are bounded by
// the once-per-week-per-user cap; false negatives mean the user misses
// a Sunday by their own clock, which is recoverable by the next tick.
// ---------------------------------------------------------------------------

const MIN_WEEKLY_GAP_MS = 6 * 24 * 60 * 60 * 1000; // 6 days

export type WeeklyDigestCandidate = {
  userId: string;
  email: string;
  timezone: string;
  weeklyDigestDowLocal: number;
  weeklyDigestHourLocal: number;
};

export async function pickEligibleUsersForWeeklyTick(
  now: Date = new Date()
): Promise<WeeklyDigestCandidate[]> {
  const cutoff = new Date(now.getTime() - MIN_WEEKLY_GAP_MS);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      weeklyDigestDowLocal: users.weeklyDigestDowLocal,
      weeklyDigestHourLocal: users.weeklyDigestHourLocal,
      lastWeeklyDigestSentAt: users.lastWeeklyDigestSentAt,
    })
    .from(users)
    .where(
      and(
        eq(users.weeklyDigestEnabled, true),
        isNull(users.deletedAt),
        isNotNull(users.email),
        or(
          isNull(users.lastWeeklyDigestSentAt),
          lt(users.lastWeeklyDigestSentAt, cutoff)
        )
      )
    );

  const eligible: WeeklyDigestCandidate[] = [];
  for (const row of rows) {
    const tz = row.timezone || "UTC";
    const localHour = hourInTimezone(now, tz);
    if (localHour === null) continue;
    if (localHour !== row.weeklyDigestHourLocal) continue;
    const localDow = dayOfWeekInTimezone(now, tz);
    if (localDow === null) continue;
    if (localDow !== row.weeklyDigestDowLocal) continue;
    eligible.push({
      userId: row.id,
      email: row.email,
      timezone: tz,
      weeklyDigestDowLocal: row.weeklyDigestDowLocal,
      weeklyDigestHourLocal: row.weeklyDigestHourLocal,
    });
  }
  return eligible;
}

// 0=Sun..6=Sat in the given IANA timezone. Returns null on invalid tz.
export function dayOfWeekInTimezone(now: Date, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === "weekday")?.value ?? "";
    const map: Record<string, number> = {
      Sun: 0,
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
    };
    const n = map[raw];
    return typeof n === "number" ? n : null;
  } catch {
    return null;
  }
}

export async function markWeeklyDigestSent(
  userId: string,
  when: Date = new Date()
): Promise<void> {
  await db
    .update(users)
    .set({ lastWeeklyDigestSentAt: when, updatedAt: when })
    .where(eq(users.id, userId));
}
