import "server-only";
import {
  CalendarNotConnectedError,
  getCalendarForUser,
} from "@/lib/integrations/google/calendar";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  type AdapterResult,
  type CanonicalEventInput,
  getGoogleAccountId,
  registerAdapter,
  softDeleteMissing,
  upsertFromSourceRow,
} from "@/lib/calendar/events-store";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";

async function sync(
  userId: string,
  fromISO: string,
  toISO: string
): Promise<AdapterResult> {
  let cal;
  try {
    cal = await getCalendarForUser(userId);
  } catch (err) {
    if (err instanceof CalendarNotConnectedError) {
      return { ok: true, upserted: 0, softDeleted: 0 };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const accountId = (await getGoogleAccountId(userId)) ?? "unknown";
  const userTz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;

  let calendarList;
  try {
    calendarList = await cal.calendarList.list();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const calendars = (calendarList.data.items ?? []).filter(
    (c): c is typeof c & { id: string } => Boolean(c.id)
  );

  const keepIds = new Set<string>();
  let upserted = 0;

  for (const c of calendars) {
    try {
      const resp = await cal.events.list({
        calendarId: c.id,
        singleEvents: true,
        showDeleted: false,
        timeMin: fromISO,
        timeMax: toISO,
        maxResults: 2500,
      });
      for (const e of resp.data.items ?? []) {
        if (!e.id) continue;
        if (e.status === "cancelled") continue;
        const startDt = e.start?.dateTime ?? null;
        const startDate = e.start?.date ?? null;
        const endDt = e.end?.dateTime ?? null;
        const endDate = e.end?.date ?? null;
        if (!startDt && !startDate) continue;

        const originTz = e.start?.timeZone ?? userTz;
        let startsAt: Date;
        let endsAt: Date | null = null;
        let isAllDay = false;

        if (startDate) {
          isAllDay = true;
          startsAt = localMidnightAsUtc(startDate, originTz);
          const endStr = endDate ?? addDaysToDateStr(startDate, 1);
          endsAt = localMidnightAsUtc(endStr, originTz);
        } else if (startDt) {
          startsAt = new Date(startDt);
          endsAt = endDt ? new Date(endDt) : null;
        } else {
          continue;
        }

        const status =
          e.status === "tentative"
            ? ("tentative" as const)
            : ("confirmed" as const);

        const row: CanonicalEventInput = {
          userId,
          sourceType: "google_calendar",
          sourceAccountId: accountId,
          externalId: e.id,
          externalParentId: c.id,
          kind: "event",
          title: e.summary ?? "(untitled)",
          description: e.description ?? null,
          startsAt,
          endsAt,
          isAllDay,
          originTimezone: originTz,
          location: e.location ?? null,
          url: e.htmlLink ?? null,
          status,
          sourceMetadata: {
            calendarId: c.id,
            calendarSummary: c.summary ?? null,
            colorId: e.colorId ?? null,
            hangoutLink: e.hangoutLink ?? null,
            recurrence: e.recurrence ?? null,
            recurringEventId: e.recurringEventId ?? null,
            reminders: e.reminders ?? null,
            originalStart: { dateTime: startDt, date: startDate },
            originalEnd: { dateTime: endDt, date: endDate },
            // Wave 3.1 — persist organizer + attendees so the pre-brief
            // scanner doesn't need a live Google API call per event tick.
            // Attendees array follows Google Calendar's shape (email +
            // displayName + responseStatus). Skipped when empty so older
            // synced events don't carry phantom keys.
            organizer: e.organizer
              ? {
                  email: e.organizer.email ?? null,
                  displayName: e.organizer.displayName ?? null,
                }
              : null,
            attendees:
              e.attendees && e.attendees.length > 0
                ? e.attendees
                    .filter((a) => Boolean(a.email))
                    .map((a) => ({
                      email: a.email!,
                      displayName: a.displayName ?? null,
                      responseStatus: a.responseStatus ?? null,
                      organizer: a.organizer ?? false,
                      self: a.self ?? false,
                    }))
                : null,
          },
          normalizedKey: null,
        };

        await upsertFromSourceRow(row);
        keepIds.add(e.id);
        upserted += 1;
      }
    } catch (err) {
      // One calendar failing shouldn't fail the whole adapter.
      console.error(
        `[sync/google-calendar] calendar ${c.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  let softDeleted = 0;
  try {
    softDeleted = await softDeleteMissing(
      userId,
      "google_calendar",
      fromISO,
      toISO,
      keepIds
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, upserted, softDeleted };
}

registerAdapter("google_calendar", sync);

export const syncRange = sync;
