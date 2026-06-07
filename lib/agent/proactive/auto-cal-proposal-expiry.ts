import "server-only";

// 2026-05-24 — Round-3 propose-confirm auto-cal cleanup. Untouched
// 'proposed' rows whose grace window has elapsed get flipped to
// 'cancelled'. NO calendar API call — the proposed-event flow never
// wrote anything to the user's calendar.
//
// Replaces the legacy auto-cal-grace sub-sweep, which promoted
// `provisional` → `confirmed` after a 24h grace and PATCHed the
// calendar event title to drop the [Steadii] prefix. That entire
// path is obsolete now: events only land on the calendar after
// explicit per-event user confirmation, so there's no prefix and
// no grace promotion to do.
//
// Default expiry window is 7 days (set at insert time on the
// row's grace_expires_at column by the propose orchestrators).
// This sweep acts on rows whose expiry has elapsed.
//
// 2026-06-07 — ALSO cancels date-stale proposals (deadline past, timed
// event already ended) even when their 7d grace hasn't elapsed yet, so a
// proposal due on the 5th doesn't linger in the DB until the 12th and
// leak into the digest. Staleness is judged by the shared
// `isAutoCalProposalStale` helper — the same predicate the queue display
// filter uses, so the two surfaces can't drift. Because date-stale rows
// can carry a future grace_expires_at, the SELECT can no longer filter on
// `grace_expires_at < now`; it fetches the proposed set (ordered by
// grace_expires_at ASC so the oldest/soonest-expiring rows are scanned
// first) and applies the OR predicate in code.

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { autoCreatedCalendarEvents } from "@/lib/db/schema";
import { isAutoCalProposalStale } from "./auto-cal-slot";

export type AutoCalProposalExpirySweepResult = {
  scanned: number;
  cancelled: number;
};

export async function runAutoCalProposalExpirySweep(args: {
  // ms epoch for "now" — pass Date.now() in production, fixed value
  // in tests for determinism.
  nowMs: number;
  // Cap on rows processed in one sweep so a backlog doesn't time out
  // the cron. Default 200.
  limit?: number;
}): Promise<AutoCalProposalExpirySweepResult> {
  const { nowMs, limit = 200 } = args;
  const now = new Date(nowMs);

  // Fetch the proposed set ordered by grace_expires_at ASC (oldest /
  // soonest-expiring first). We pull `kind` + `agreed_slot` too so the
  // date-staleness predicate can run in code. A single UPDATE ... WHERE
  // would be cheaper at scale but the SELECT-then-UPDATE pattern matches
  // the rest of the codebase's sweep modules (which need the row ids to
  // log to audit_log per row when applicable), and the date-stale branch
  // can't be expressed as a SQL WHERE without re-implementing the tz-aware
  // staleness logic in SQL. Fine at α volume.
  const rows = await db
    .select({
      id: autoCreatedCalendarEvents.id,
      kind: autoCreatedCalendarEvents.kind,
      agreedSlot: autoCreatedCalendarEvents.agreedSlot,
      graceExpiresAt: autoCreatedCalendarEvents.graceExpiresAt,
    })
    .from(autoCreatedCalendarEvents)
    .where(eq(autoCreatedCalendarEvents.status, "proposed"))
    .orderBy(asc(autoCreatedCalendarEvents.graceExpiresAt))
    .limit(limit);

  if (rows.length === 0) {
    return { scanned: 0, cancelled: 0 };
  }

  // Cancel a row when its grace window has elapsed OR it's date-stale
  // (deadline past / timed event already ended).
  const expired = rows.filter(
    (row) =>
      row.graceExpiresAt < now ||
      isAutoCalProposalStale(
        { kind: row.kind, agreedSlot: row.agreedSlot },
        nowMs,
      ),
  );

  let cancelled = 0;
  for (const row of expired) {
    await db
      .update(autoCreatedCalendarEvents)
      .set({
        status: "cancelled",
        cancelledAt: now,
      })
      .where(eq(autoCreatedCalendarEvents.id, row.id));
    cancelled++;
  }

  return { scanned: rows.length, cancelled };
}
