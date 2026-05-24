import "server-only";

// 2026-05-24 — Round-3 propose-confirm auto-cal cleanup. Untouched
// proposals (status='proposed' AND grace_expires_at < now) get
// flipped to 'cancelled'. NO calendar API call — the proposed-event
// flow never wrote anything to the user's calendar.
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
// This sweep just acts on rows whose expiry has elapsed.

import { and, eq, lt } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { autoCreatedCalendarEvents } from "@/lib/db/schema";

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

  // Find expired proposals first so we can report the scanned count
  // accurately. A single UPDATE ... WHERE would be cheaper at scale
  // but the SELECT-then-UPDATE pattern matches the rest of the
  // codebase's sweep modules (which need the row ids to log to
  // audit_log per row when applicable).
  const rows = await db
    .select({ id: autoCreatedCalendarEvents.id })
    .from(autoCreatedCalendarEvents)
    .where(
      and(
        eq(autoCreatedCalendarEvents.status, "proposed"),
        lt(autoCreatedCalendarEvents.graceExpiresAt, now),
      ),
    )
    .limit(limit);

  if (rows.length === 0) {
    return { scanned: 0, cancelled: 0 };
  }

  let cancelled = 0;
  for (const row of rows) {
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
