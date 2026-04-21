import "server-only";
import { z } from "zod";
import { getCalendarForUser } from "@/lib/integrations/google/calendar";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
import {
  getGoogleAccountId,
  listEventsInRange,
  markDeletedByExternalId,
  shouldSync,
  syncAllForRange,
  upsertFromSourceRow,
} from "@/lib/calendar/events-store";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";
import type { ToolExecutor } from "./types";

async function logAudit(args: {
  userId: string;
  action: string;
  toolName: string;
  resourceId?: string | null;
  result: "success" | "failure";
  detail?: Record<string, unknown>;
}) {
  await db.insert(auditLog).values({
    userId: args.userId,
    action: args.action,
    toolName: args.toolName,
    resourceType: "google_calendar_event",
    resourceId: args.resourceId ?? null,
    result: args.result,
    detail: args.detail ?? null,
  });
}

// ---------- calendar_list_events ----------
const listArgs = z.object({
  timeMin: z.string().optional(),
  timeMax: z.string().optional(),
  q: z.string().optional(),
  calendarId: z.string().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

export type CalendarListedEvent = {
  id: string | null | undefined;
  summary: string | null | undefined;
  start: string | null | undefined;
  end: string | null | undefined;
  location?: string | null;
  description?: string | null;
  recurrence?: string[] | null;
  recurringEventId?: string | null;
  reminders?: { minutes: number } | null;
};

export const calendarListEvents: ToolExecutor<
  z.infer<typeof listArgs>,
  { events: CalendarListedEvent[] }
> = {
  schema: {
    name: "calendar_list_events",
    description:
      "List Google Calendar events. `timeMin`/`timeMax` must be RFC3339 timestamps. Defaults to the primary calendar over the next 7 days. Reads from the unified event store (synced from Google on demand).",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        timeMin: { type: "string" },
        timeMax: { type: "string" },
        q: { type: "string" },
        calendarId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = listArgs.parse(rawArgs);
    const now = new Date();
    const timeMin = args.timeMin ?? now.toISOString();
    const timeMax =
      args.timeMax ??
      new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    if (shouldSync(ctx.userId, timeMin, timeMax)) {
      await syncAllForRange(ctx.userId, timeMin, timeMax);
    }
    const rows = await listEventsInRange(ctx.userId, timeMin, timeMax, {
      sourceTypes: ["google_calendar"],
    });
    const q = args.q?.toLowerCase();
    const limit = args.limit ?? 25;
    const events: CalendarListedEvent[] = [];
    for (const r of rows) {
      if (args.calendarId && r.externalParentId !== args.calendarId) continue;
      if (q) {
        const hay = `${r.title} ${r.description ?? ""} ${r.location ?? ""}`.toLowerCase();
        if (!hay.includes(q)) continue;
      }
      const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>;
      const origStart = meta.originalStart as
        | { dateTime?: string | null; date?: string | null }
        | undefined;
      const origEnd = meta.originalEnd as
        | { dateTime?: string | null; date?: string | null }
        | undefined;
      const start = r.isAllDay
        ? origStart?.date ?? null
        : origStart?.dateTime ?? r.startsAt.toISOString();
      const end = r.isAllDay
        ? origEnd?.date ?? null
        : origEnd?.dateTime ?? r.endsAt?.toISOString() ?? null;
      const reminders =
        (meta.reminders as { overrides?: Array<{ method?: string; minutes?: number }> } | null)
          ?.overrides;
      const popup = reminders?.find((o) => o.method === "popup") ?? reminders?.[0];
      events.push({
        id: r.externalId,
        summary: r.title,
        start,
        end,
        location: r.location,
        description: r.description,
        recurrence: (meta.recurrence as string[] | null) ?? null,
        recurringEventId: (meta.recurringEventId as string | null) ?? null,
        reminders:
          popup && typeof popup.minutes === "number"
            ? { minutes: popup.minutes }
            : null,
      });
      if (events.length >= limit) break;
    }
    return { events };
  },
};

// ---------- calendar_create_event ----------
const remindersArg = z.object({ minutes: z.number().int().min(0).max(40320) });

const createArgs = z.object({
  summary: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  calendarId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  reminders: remindersArg.optional(),
});

function isAllDayStr(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export const calendarCreateEvent: ToolExecutor<
  z.infer<typeof createArgs>,
  { eventId: string; htmlLink: string | null }
> = {
  schema: {
    name: "calendar_create_event",
    description:
      "Create a Google Calendar event. `start`/`end` must be RFC3339 timestamps (with timezone) or all-day YYYY-MM-DD strings. `recurrence` is an array of RRULE strings (e.g. ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE']). `reminders.minutes` sets a single popup reminder that many minutes before the event.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        calendarId: { type: "string" },
        recurrence: { type: "array", items: { type: "string" } },
        reminders: {
          type: "object",
          properties: { minutes: { type: "integer", minimum: 0, maximum: 40320 } },
          required: ["minutes"],
          additionalProperties: false,
        },
      },
      required: ["summary", "start", "end"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = createArgs.parse(rawArgs);
    const cal = await getCalendarForUser(ctx.userId);
    try {
      const body: Record<string, unknown> = {
        summary: args.summary,
        description: args.description,
        location: args.location,
        start: isAllDayStr(args.start) ? { date: args.start } : { dateTime: args.start },
        end: isAllDayStr(args.end) ? { date: args.end } : { dateTime: args.end },
      };
      if (args.recurrence && args.recurrence.length > 0) {
        body.recurrence = args.recurrence;
      }
      if (args.reminders) {
        body.reminders = {
          useDefault: false,
          overrides: [{ method: "popup", minutes: args.reminders.minutes }],
        };
      }
      const calendarId = args.calendarId ?? "primary";
      const resp = await cal.events.insert({
        calendarId,
        requestBody: body,
      });
      const id = resp.data.id ?? "";
      await writeThroughCalendarEvent(ctx.userId, calendarId, resp.data);
      await logAudit({
        userId: ctx.userId,
        action: "calendar.event.create",
        toolName: "calendar_create_event",
        resourceId: id,
        result: "success",
        detail: { summary: args.summary },
      });
      return { eventId: id, htmlLink: resp.data.htmlLink ?? null };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "calendar.event.create",
        toolName: "calendar_create_event",
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

// ---------- calendar_update_event ----------
const updateArgs = z.object({
  eventId: z.string().min(1),
  summary: z.string().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  description: z.string().optional(),
  location: z.string().optional(),
  calendarId: z.string().optional(),
  recurrence: z.array(z.string()).optional(),
  reminders: remindersArg.optional(),
});

export const calendarUpdateEvent: ToolExecutor<
  z.infer<typeof updateArgs>,
  { eventId: string }
> = {
  schema: {
    name: "calendar_update_event",
    description:
      "Patch fields on an existing calendar event. `recurrence` and `reminders` have the same shape as on calendar_create_event. When editing a single recurring instance, pass the instance's eventId — the change applies to that instance only.",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        summary: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        description: { type: "string" },
        location: { type: "string" },
        calendarId: { type: "string" },
        recurrence: { type: "array", items: { type: "string" } },
        reminders: {
          type: "object",
          properties: { minutes: { type: "integer", minimum: 0, maximum: 40320 } },
          required: ["minutes"],
          additionalProperties: false,
        },
      },
      required: ["eventId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = updateArgs.parse(rawArgs);
    const cal = await getCalendarForUser(ctx.userId);
    const body: Record<string, unknown> = {};
    if (args.summary !== undefined) body.summary = args.summary;
    if (args.description !== undefined) body.description = args.description;
    if (args.location !== undefined) body.location = args.location;
    if (args.start)
      body.start = isAllDayStr(args.start) ? { date: args.start } : { dateTime: args.start };
    if (args.end)
      body.end = isAllDayStr(args.end) ? { date: args.end } : { dateTime: args.end };
    if (args.recurrence !== undefined) body.recurrence = args.recurrence;
    if (args.reminders !== undefined) {
      body.reminders = {
        useDefault: false,
        overrides: [{ method: "popup", minutes: args.reminders.minutes }],
      };
    }

    try {
      const calendarId = args.calendarId ?? "primary";
      const resp = await cal.events.patch({
        calendarId,
        eventId: args.eventId,
        requestBody: body,
      });
      await writeThroughCalendarEvent(ctx.userId, calendarId, resp.data);
      await logAudit({
        userId: ctx.userId,
        action: "calendar.event.update",
        toolName: "calendar_update_event",
        resourceId: args.eventId,
        result: "success",
      });
      return { eventId: args.eventId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "calendar.event.update",
        toolName: "calendar_update_event",
        resourceId: args.eventId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

// ---------- calendar_delete_event ----------
const deleteArgs = z.object({
  eventId: z.string().min(1),
  calendarId: z.string().optional(),
});

export const calendarDeleteEvent: ToolExecutor<
  z.infer<typeof deleteArgs>,
  { eventId: string }
> = {
  schema: {
    name: "calendar_delete_event",
    description: "Delete a calendar event. DESTRUCTIVE: requires user confirmation.",
    mutability: "destructive",
    parameters: {
      type: "object",
      properties: {
        eventId: { type: "string" },
        calendarId: { type: "string" },
      },
      required: ["eventId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = deleteArgs.parse(rawArgs);
    const cal = await getCalendarForUser(ctx.userId);
    try {
      await cal.events.delete({
        calendarId: args.calendarId ?? "primary",
        eventId: args.eventId,
      });
      await markDeletedByExternalId(
        ctx.userId,
        "google_calendar",
        args.eventId
      );
      await logAudit({
        userId: ctx.userId,
        action: "calendar.event.delete",
        toolName: "calendar_delete_event",
        resourceId: args.eventId,
        result: "success",
      });
      return { eventId: args.eventId };
    } catch (err) {
      await logAudit({
        userId: ctx.userId,
        action: "calendar.event.delete",
        toolName: "calendar_delete_event",
        resourceId: args.eventId,
        result: "failure",
        detail: { message: err instanceof Error ? err.message : String(err) },
      });
      throw err;
    }
  },
};

// Write-through helper: project a Google Calendar event into canonical and
// upsert it into L4 so readers see the mutation without a full sync.
async function writeThroughCalendarEvent(
  userId: string,
  calendarId: string,
  e: unknown
): Promise<void> {
  if (!e || typeof e !== "object") return;
  const ev = e as {
    id?: string | null;
    summary?: string | null;
    description?: string | null;
    location?: string | null;
    htmlLink?: string | null;
    status?: string | null;
    colorId?: string | null;
    hangoutLink?: string | null;
    recurrence?: string[] | null;
    recurringEventId?: string | null;
    reminders?: unknown;
    start?: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
    end?: { date?: string | null; dateTime?: string | null; timeZone?: string | null };
  };
  if (!ev.id) return;

  const accountId = (await getGoogleAccountId(userId)) ?? "unknown";
  const userTz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;
  const originTz = ev.start?.timeZone ?? userTz;

  let startsAt: Date;
  let endsAt: Date | null = null;
  let isAllDay = false;

  if (ev.start?.date) {
    isAllDay = true;
    startsAt = localMidnightAsUtc(ev.start.date, originTz);
    const endStr = ev.end?.date ?? addDaysToDateStr(ev.start.date, 1);
    endsAt = localMidnightAsUtc(endStr, originTz);
  } else if (ev.start?.dateTime) {
    startsAt = new Date(ev.start.dateTime);
    endsAt = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
  } else {
    return;
  }

  const status =
    ev.status === "cancelled"
      ? ("cancelled" as const)
      : ev.status === "tentative"
        ? ("tentative" as const)
        : ("confirmed" as const);

  await upsertFromSourceRow({
    userId,
    sourceType: "google_calendar",
    sourceAccountId: accountId,
    externalId: ev.id,
    externalParentId: calendarId,
    kind: "event",
    title: ev.summary ?? "(untitled)",
    description: ev.description ?? null,
    startsAt,
    endsAt,
    isAllDay,
    originTimezone: originTz,
    location: ev.location ?? null,
    url: ev.htmlLink ?? null,
    status,
    sourceMetadata: {
      calendarId,
      colorId: ev.colorId ?? null,
      hangoutLink: ev.hangoutLink ?? null,
      recurrence: ev.recurrence ?? null,
      recurringEventId: ev.recurringEventId ?? null,
      reminders: ev.reminders ?? null,
      originalStart: { dateTime: ev.start?.dateTime ?? null, date: ev.start?.date ?? null },
      originalEnd: { dateTime: ev.end?.dateTime ?? null, date: ev.end?.date ?? null },
    },
    normalizedKey: null,
  });
}

export const CALENDAR_TOOLS = [
  calendarListEvents,
  calendarCreateEvent,
  calendarUpdateEvent,
  calendarDeleteEvent,
];
