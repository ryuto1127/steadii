import "server-only";
import {
  getMsAccount,
  getMsGraphForUser,
  MsNotConnectedError,
} from "./graph-client";
import type { DraftCalendarEvent } from "@/lib/integrations/google/calendar";
import { upsertFromSourceRow } from "@/lib/calendar/events-store";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";

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

// Shape returned by Graph after a successful create/patch — only the bits
// we project back into the local events mirror.
type GraphEventRow = {
  id?: string | null;
  subject?: string | null;
  body?: { content?: string | null; contentType?: string | null } | null;
  start?: { dateTime?: string | null; timeZone?: string | null } | null;
  end?: { dateTime?: string | null; timeZone?: string | null } | null;
  location?: { displayName?: string | null } | null;
  webLink?: string | null;
  isAllDay?: boolean | null;
  isCancelled?: boolean | null;
};

// Detect whether a string is a date-only marker (YYYY-MM-DD) the agent
// uses for all-day events, vs a full RFC3339 timestamp.
function isAllDayStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Translate Steadii's internal {start, end} (ISO datetime or all-day date)
// into the MS Graph event start/end shape. MS Graph wants both halves of an
// all-day event as datetime-at-midnight in some IANA zone, with the end
// being the exclusive next-day boundary — matches Google's all-day shape.
function toGraphTimeBlock(
  start: string,
  end: string,
  tz: string
): {
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  isAllDay: boolean;
} {
  if (isAllDayStr(start)) {
    // MS expects exclusive end. If caller passed the same date, advance by one.
    const endDate = isAllDayStr(end)
      ? end === start
        ? addDaysToDateStr(start, 1)
        : end
      : start; // end was bogus — fall back to next-day equivalent
    const endStr = endDate === start ? addDaysToDateStr(start, 1) : endDate;
    return {
      start: { dateTime: `${start}T00:00:00`, timeZone: tz },
      end: { dateTime: `${endStr}T00:00:00`, timeZone: tz },
      isAllDay: true,
    };
  }
  // Strip trailing Z — MS will interpret the dateTime in the zone we tell
  // it to use, not pin it to UTC. We send UTC explicitly via timeZone="UTC"
  // so this works regardless of input.
  const stripZ = (s: string) => s.replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
  return {
    start: { dateTime: stripZ(start), timeZone: "UTC" },
    end: { dateTime: stripZ(end), timeZone: "UTC" },
    isAllDay: false,
  };
}

// Mirror an MS Graph event row into the local `events` table so the
// /app/calendar surface and dedup queries see it without waiting for a
// background sync. Mirrors `writeThroughCalendarEvent` from the Google
// agent tool, but for the MS source.
async function writeThroughMsEvent(args: {
  userId: string;
  providerAccountId: string;
  ev: GraphEventRow;
}): Promise<void> {
  const { ev } = args;
  if (!ev.id) return;
  const userTz = (await getUserTimezone(args.userId)) ?? FALLBACK_TZ;
  const originTz = ev.start?.timeZone ?? userTz;

  let startsAt: Date;
  let endsAt: Date | null = null;
  const isAllDay = ev.isAllDay === true;

  if (!ev.start?.dateTime) return;
  if (isAllDay) {
    // dateTime comes back as "YYYY-MM-DDT00:00:00.0000000". Take the date
    // half and pin to local midnight in the origin tz.
    const startDate = ev.start.dateTime.slice(0, 10);
    startsAt = localMidnightAsUtc(startDate, originTz);
    const endDate = ev.end?.dateTime
      ? ev.end.dateTime.slice(0, 10)
      : addDaysToDateStr(startDate, 1);
    endsAt = localMidnightAsUtc(endDate, originTz);
  } else {
    const startIso = ev.start.dateTime.endsWith("Z")
      ? ev.start.dateTime
      : `${ev.start.dateTime.replace(/\.\d+$/, "")}Z`;
    startsAt = new Date(startIso);
    if (ev.end?.dateTime) {
      const endIso = ev.end.dateTime.endsWith("Z")
        ? ev.end.dateTime
        : `${ev.end.dateTime.replace(/\.\d+$/, "")}Z`;
      endsAt = new Date(endIso);
    }
  }

  const status = ev.isCancelled ? ("cancelled" as const) : ("confirmed" as const);

  await upsertFromSourceRow({
    userId: args.userId,
    sourceType: "microsoft_graph",
    sourceAccountId: args.providerAccountId,
    externalId: ev.id,
    externalParentId: null,
    kind: "event",
    title: ev.subject ?? "(untitled)",
    description: ev.body?.content ?? null,
    startsAt,
    endsAt,
    isAllDay,
    originTimezone: originTz,
    location: ev.location?.displayName ?? null,
    url: ev.webLink ?? null,
    status,
    sourceMetadata: {
      originalStart: { dateTime: ev.start?.dateTime ?? null, timeZone: ev.start?.timeZone ?? null },
      originalEnd: { dateTime: ev.end?.dateTime ?? null, timeZone: ev.end?.timeZone ?? null },
    },
    normalizedKey: null,
  });
}

export type MsEventCreateInput = {
  userId: string;
  summary: string;
  start: string; // RFC3339 timestamp or YYYY-MM-DD for all-day
  end: string;
  description?: string;
  location?: string;
  // MS supports a single reminder time before the event (in minutes).
  // When the agent passes Google's array of multiple reminders, we map
  // the smallest non-zero value here — closest to the original intent.
  reminderMinutesBeforeStart?: number;
  timeZone?: string;
};

// POST /me/events. Creates an event on the user's default calendar and
// mirrors the result into the local events table so the calendar UI sees
// it immediately. Throws MsNotConnectedError when the user hasn't granted
// Calendars.ReadWrite (the agent dispatcher catches and surfaces a warning).
export async function createMsEvent(
  input: MsEventCreateInput
): Promise<{ id: string; webLink: string | null }> {
  const acct = await getMsAccount(input.userId);
  if (!acct) throw new MsNotConnectedError();
  if (!acct.scope?.toLowerCase().includes("calendars.readwrite")) {
    throw new MsNotConnectedError();
  }
  const client = await getMsGraphForUser(input.userId);
  const userTz =
    input.timeZone ?? (await getUserTimezone(input.userId)) ?? FALLBACK_TZ;
  const block = toGraphTimeBlock(input.start, input.end, userTz);

  const body: Record<string, unknown> = {
    subject: input.summary,
    start: block.start,
    end: block.end,
    isAllDay: block.isAllDay,
  };
  if (input.description) {
    body.body = { contentType: "text", content: input.description };
  }
  if (input.location) {
    body.location = { displayName: input.location };
  }
  if (
    typeof input.reminderMinutesBeforeStart === "number" &&
    Number.isFinite(input.reminderMinutesBeforeStart)
  ) {
    body.reminderMinutesBeforeStart = Math.max(
      0,
      Math.floor(input.reminderMinutesBeforeStart)
    );
    body.isReminderOn = true;
  }

  const created = (await client
    .api("/me/events")
    .post(body)) as GraphEventRow;
  if (!created?.id) {
    throw new Error("MS Graph create returned no id");
  }
  await writeThroughMsEvent({
    userId: input.userId,
    providerAccountId: acct.providerAccountId,
    ev: created,
  });
  return { id: created.id, webLink: created.webLink ?? null };
}

export type MsEventPatchInput = {
  userId: string;
  eventId: string;
  patch: {
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
    reminderMinutesBeforeStart?: number;
  };
  timeZone?: string;
};

// PATCH /me/events/{id}. Returns the updated event id; the local mirror is
// refreshed from the response. Caller is expected to have read the event id
// from a prior list call (`calendar_list_events`).
export async function patchMsEvent(
  input: MsEventPatchInput
): Promise<{ id: string }> {
  const acct = await getMsAccount(input.userId);
  if (!acct) throw new MsNotConnectedError();
  if (!acct.scope?.toLowerCase().includes("calendars.readwrite")) {
    throw new MsNotConnectedError();
  }
  const client = await getMsGraphForUser(input.userId);
  const userTz =
    input.timeZone ?? (await getUserTimezone(input.userId)) ?? FALLBACK_TZ;

  const body: Record<string, unknown> = {};
  if (input.patch.summary !== undefined) body.subject = input.patch.summary;
  if (input.patch.description !== undefined) {
    body.body = { contentType: "text", content: input.patch.description };
  }
  if (input.patch.location !== undefined) {
    body.location = { displayName: input.patch.location };
  }
  if (input.patch.start !== undefined && input.patch.end !== undefined) {
    const block = toGraphTimeBlock(input.patch.start, input.patch.end, userTz);
    body.start = block.start;
    body.end = block.end;
    body.isAllDay = block.isAllDay;
  } else if (input.patch.start !== undefined) {
    // Patching only one half is rare and ambiguous (Graph wants both halves
    // updated together). Fall through with the partial update — Graph
    // accepts it but the resulting event may have a stale opposite half.
    body.start = isAllDayStr(input.patch.start)
      ? { dateTime: `${input.patch.start}T00:00:00`, timeZone: userTz }
      : { dateTime: input.patch.start.replace(/Z$/, ""), timeZone: "UTC" };
  } else if (input.patch.end !== undefined) {
    body.end = isAllDayStr(input.patch.end)
      ? { dateTime: `${input.patch.end}T00:00:00`, timeZone: userTz }
      : { dateTime: input.patch.end.replace(/Z$/, ""), timeZone: "UTC" };
  }
  if (
    typeof input.patch.reminderMinutesBeforeStart === "number" &&
    Number.isFinite(input.patch.reminderMinutesBeforeStart)
  ) {
    body.reminderMinutesBeforeStart = Math.max(
      0,
      Math.floor(input.patch.reminderMinutesBeforeStart)
    );
    body.isReminderOn = true;
  }

  const updated = (await client
    .api(`/me/events/${encodeURIComponent(input.eventId)}`)
    .patch(body)) as GraphEventRow;
  if (updated?.id) {
    await writeThroughMsEvent({
      userId: input.userId,
      providerAccountId: acct.providerAccountId,
      ev: updated,
    });
  }
  return { id: input.eventId };
}

// DELETE /me/events/{id}. Idempotent on the wire (Graph returns 404 for an
// already-deleted event) — the dispatcher catches MsNotConnectedError but
// lets through 404s as actual errors. Caller is expected to soft-delete
// the local mirror via `markDeletedByExternalId`.
export async function deleteMsEvent(args: {
  userId: string;
  eventId: string;
}): Promise<void> {
  const acct = await getMsAccount(args.userId);
  if (!acct) throw new MsNotConnectedError();
  if (!acct.scope?.toLowerCase().includes("calendars.readwrite")) {
    throw new MsNotConnectedError();
  }
  const client = await getMsGraphForUser(args.userId);
  await client
    .api(`/me/events/${encodeURIComponent(args.eventId)}`)
    .delete();
}
