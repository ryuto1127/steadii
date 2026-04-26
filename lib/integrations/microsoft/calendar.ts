import "server-only";
import {
  getMsAccount,
  getMsGraphForUser,
  MsNotConnectedError,
} from "./graph-client";
import type { DraftCalendarEvent } from "@/lib/integrations/google/calendar";

// Mirrors `fetchUpcomingEvents` from the Google integration so the L2 fanout
// can flatten both providers into a single calendar block. Soft-fails when
// the user hasn't connected MS or hasn't granted Calendars.Read — same
// contract as Google: empty array, never throws to the caller.
export async function fetchMsUpcomingEvents(
  userId: string,
  options: { days?: number; max?: number } = {}
): Promise<DraftCalendarEvent[]> {
  const days = options.days ?? 7;
  const max = options.max ?? 25;

  const acct = await getMsAccount(userId);
  if (!acct) return [];
  if (!acct.scope?.toLowerCase().includes("calendars.read")) return [];

  let client;
  try {
    client = await getMsGraphForUser(userId);
  } catch (e) {
    if (e instanceof MsNotConnectedError) return [];
    throw e;
  }

  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  // /me/calendarView expands recurring series into single instances within
  // the window — same shape as Google's `singleEvents: true`. /me/events
  // returns the master with a `recurrence` rule, which the fanout prompt
  // would have to re-expand client-side.
  type GraphEvent = {
    subject?: string | null;
    start?: { dateTime?: string | null; timeZone?: string | null } | null;
    end?: { dateTime?: string | null; timeZone?: string | null } | null;
    location?: { displayName?: string | null } | null;
    isAllDay?: boolean | null;
  };

  const resp = (await client
    .api("/me/calendarView")
    .query({
      startDateTime: now.toISOString(),
      endDateTime: end.toISOString(),
      $top: String(max),
      $orderby: "start/dateTime",
      $select: "subject,start,end,location,isAllDay",
    })
    .header("Prefer", 'outlook.timezone="UTC"')
    .get()) as { value?: GraphEvent[] };

  return (resp.value ?? [])
    .filter((e): e is GraphEvent & { start: { dateTime: string }; end: { dateTime: string } } =>
      !!(e.start?.dateTime && e.end?.dateTime)
    )
    .map((e) => {
      // Graph returns "2026-04-25T15:30:00.0000000" with no Z. Normalise
      // to ISO so downstream Date parsing is unambiguous.
      const startIso = e.start.dateTime.endsWith("Z")
        ? e.start.dateTime
        : `${e.start.dateTime.replace(/\.\d+$/, "")}Z`;
      const endIso = e.end.dateTime.endsWith("Z")
        ? e.end.dateTime
        : `${e.end.dateTime.replace(/\.\d+$/, "")}Z`;
      return {
        title: e.subject ?? "(untitled)",
        start: startIso,
        end: endIso,
        location: e.location?.displayName ?? null,
      };
    });
}
