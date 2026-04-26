import "server-only";
import { and, asc, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { events } from "@/lib/db/schema";
import type { DraftCalendarEvent } from "@/lib/integrations/google/calendar";

// Read iCal-source events from the `events` mirror table. Unlike Google
// (which is fetched live every fanout invocation) iCal is cron-synced
// every 6h, so the freshest the prompt sees is "up to 6h stale" — that's
// fine for the fixed timetables iCal subscriptions typically carry.
export async function fetchUpcomingIcalEvents(
  userId: string,
  options: { days?: number; max?: number } = {}
): Promise<DraftCalendarEvent[]> {
  const days = options.days ?? 7;
  const max = options.max ?? 25;
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      location: events.location,
      isAllDay: events.isAllDay,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.sourceType, "ical_subscription"),
        isNull(events.deletedAt),
        gte(events.startsAt, now),
        lt(events.startsAt, end)
      )
    )
    .orderBy(asc(events.startsAt))
    .limit(max);

  return rows.map((r) => ({
    title: r.title,
    start: r.startsAt.toISOString(),
    end: (r.endsAt ?? r.startsAt).toISOString(),
    location: r.location,
  }));
}
