import "server-only";
import { and, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

// ---------------------------------------------------------------------------
// Cron user picker — for a given wall-clock moment, which users are due to
// receive their morning digest in the next 30-minute slice?
//
// Memory: "one morning digest at 7am local". A single cron fires every 30
// minutes at :00 and :30; for each tick we find users whose `digest_hour_local`
// in their IANA timezone matches the current hour-in-their-tz AND whose
// `last_digest_sent_at` was either never set or is older than 20 hours ago
// (prevents double-sends from overlapping ticks; 20h < 24h gives us tolerance
// around DST shifts without risking a skip).
//
// We fan this out in two steps to stay SQL-agnostic:
// 1. SELECT all digest-enabled users with the eligibility window filter.
// 2. For each, compute the hour-in-their-tz in JS and compare against
//    `digest_hour_local`. (Doing this in Postgres would require AT TIME ZONE
//    plumbing per-row — fine for α volume to do in JS.)
// ---------------------------------------------------------------------------

const MIN_DIGEST_GAP_MS = 20 * 60 * 60 * 1000; // 20h

export type DigestCandidate = {
  userId: string;
  email: string;
  timezone: string;
  digestHourLocal: number;
};

export async function pickEligibleUsersForTick(
  now: Date = new Date()
): Promise<DigestCandidate[]> {
  const cutoff = new Date(now.getTime() - MIN_DIGEST_GAP_MS);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      timezone: users.timezone,
      digestHourLocal: users.digestHourLocal,
      lastDigestSentAt: users.lastDigestSentAt,
    })
    .from(users)
    .where(
      and(
        eq(users.digestEnabled, true),
        isNull(users.deletedAt),
        isNotNull(users.email),
        or(
          isNull(users.lastDigestSentAt),
          lt(users.lastDigestSentAt, cutoff)
        )
      )
    );

  const eligible: DigestCandidate[] = [];
  for (const row of rows) {
    const tz = row.timezone || "UTC";
    const localHour = hourInTimezone(now, tz);
    if (localHour === null) continue;
    if (localHour === row.digestHourLocal) {
      eligible.push({
        userId: row.id,
        email: row.email,
        timezone: tz,
        digestHourLocal: row.digestHourLocal,
      });
    }
  }
  return eligible;
}

// Hour 0-23 in the given IANA timezone. Returns null on invalid tz.
export function hourInTimezone(now: Date, tz: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === "hour")?.value ?? "";
    // Intl emits "24" for midnight in some implementations — normalize.
    const n = Number(raw) % 24;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

// Record that the digest was sent. Called by the cron after a successful
// Resend dispatch. Failure to record is non-fatal (Sentry handles it)
// because at worst the user gets a duplicate digest on the next tick
// within the 20h window.
export async function markDigestSent(
  userId: string,
  when: Date = new Date()
): Promise<void> {
  await db
    .update(users)
    .set({ lastDigestSentAt: when, updatedAt: when })
    .where(eq(users.id, userId));
  void sql; // keep sql import if unused in this file — reserved for future
}
