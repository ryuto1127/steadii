import "server-only";
import { z } from "zod";
import { getCalendarForUser } from "@/lib/integrations/google/calendar";
import { db } from "@/lib/db/client";
import { auditLog } from "@/lib/db/schema";
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
  limit: z.number().int().positive().max(100).optional(),
});

export const calendarListEvents: ToolExecutor<
  z.infer<typeof listArgs>,
  {
    events: Array<{
      id: string | null | undefined;
      summary: string | null | undefined;
      start: string | null | undefined;
      end: string | null | undefined;
      location?: string | null;
    }>;
  }
> = {
  schema: {
    name: "calendar_list_events",
    description:
      "List Google Calendar events. `timeMin`/`timeMax` must be RFC3339 timestamps. Defaults to the primary calendar over the next 7 days.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        timeMin: { type: "string" },
        timeMax: { type: "string" },
        q: { type: "string" },
        calendarId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = listArgs.parse(rawArgs);
    const cal = await getCalendarForUser(ctx.userId);
    const now = new Date();
    const defaultMin = now.toISOString();
    const defaultMax = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const resp = await cal.events.list({
      calendarId: args.calendarId ?? "primary",
      timeMin: args.timeMin ?? defaultMin,
      timeMax: args.timeMax ?? defaultMax,
      q: args.q,
      singleEvents: true,
      orderBy: "startTime",
      maxResults: args.limit ?? 25,
    });
    const events = (resp.data.items ?? []).map((e) => ({
      id: e.id,
      summary: e.summary,
      start: e.start?.dateTime ?? e.start?.date,
      end: e.end?.dateTime ?? e.end?.date,
      location: e.location,
    }));
    return { events };
  },
};

// ---------- calendar_create_event ----------
const createArgs = z.object({
  summary: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  description: z.string().optional(),
  location: z.string().optional(),
  calendarId: z.string().optional(),
});

export const calendarCreateEvent: ToolExecutor<
  z.infer<typeof createArgs>,
  { eventId: string; htmlLink: string | null }
> = {
  schema: {
    name: "calendar_create_event",
    description:
      "Create a Google Calendar event. `start`/`end` must be RFC3339 timestamps (with timezone) or all-day YYYY-MM-DD strings.",
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
      },
      required: ["summary", "start", "end"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = createArgs.parse(rawArgs);
    const cal = await getCalendarForUser(ctx.userId);
    try {
      const isAllDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
      const body = {
        summary: args.summary,
        description: args.description,
        location: args.location,
        start: isAllDay(args.start) ? { date: args.start } : { dateTime: args.start },
        end: isAllDay(args.end) ? { date: args.end } : { dateTime: args.end },
      };
      const resp = await cal.events.insert({
        calendarId: args.calendarId ?? "primary",
        requestBody: body,
      });
      const id = resp.data.id ?? "";
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
});

export const calendarUpdateEvent: ToolExecutor<
  z.infer<typeof updateArgs>,
  { eventId: string }
> = {
  schema: {
    name: "calendar_update_event",
    description: "Patch fields on an existing calendar event.",
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
      },
      required: ["eventId"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = updateArgs.parse(rawArgs);
    const cal = await getCalendarForUser(ctx.userId);
    const isAllDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
    const body: Record<string, unknown> = {};
    if (args.summary !== undefined) body.summary = args.summary;
    if (args.description !== undefined) body.description = args.description;
    if (args.location !== undefined) body.location = args.location;
    if (args.start)
      body.start = isAllDay(args.start) ? { date: args.start } : { dateTime: args.start };
    if (args.end)
      body.end = isAllDay(args.end) ? { date: args.end } : { dateTime: args.end };

    try {
      await cal.events.patch({
        calendarId: args.calendarId ?? "primary",
        eventId: args.eventId,
        requestBody: body,
      });
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

export const CALENDAR_TOOLS = [
  calendarListEvents,
  calendarCreateEvent,
  calendarUpdateEvent,
  calendarDeleteEvent,
];
