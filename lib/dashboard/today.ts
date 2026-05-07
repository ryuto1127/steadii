import "server-only";
import {
  getCalendarForUser,
  CalendarNotConnectedError,
} from "@/lib/integrations/google/calendar";
import { db } from "@/lib/db/client";
import {
  assignments as assignmentsTable,
  classes as classesTable,
} from "@/lib/db/schema";
import { and, asc, eq, gte, isNull, lte, ne } from "drizzle-orm";
import type { ClassColor } from "@/components/ui/class-color";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  addDaysToDateStr,
  FALLBACK_TZ,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";

// Returns "YYYY-MM-DD" for the calendar day the user is currently in,
// evaluated against their persisted IANA timezone. Crucial on Vercel
// (server TZ = UTC) — without this, Vancouver evenings quietly render
// tomorrow's events as "today".
export function todayDateInTz(tz: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

export type TodayEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  location?: string | null;
  calendarName?: string | null;
};

export type DueSoonAssignment = {
  id: string;
  title: string;
  due: string;
  classColor: ClassColor | null;
  classTitle: string | null;
};

export async function getTodaysEvents(
  userId: string,
  opts: { daysAhead?: number } = {}
): Promise<TodayEvent[]> {
  // Engineer-37: widen the default window from 1 day to 7 days so the
  // home today-briefing surfaces a real week-ahead horizon. Callers
  // wanting strictly today can pass `daysAhead: 1`.
  const daysAhead = opts.daysAhead ?? 7;
  try {
    const cal = await getCalendarForUser(userId);
    const tz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;
    const today = todayDateInTz(tz);
    const start = localMidnightAsUtc(today, tz);
    const end = localMidnightAsUtc(addDaysToDateStr(today, daysAhead), tz);
    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    return (resp.data.items ?? [])
      .filter((e) => e.start?.dateTime || e.start?.date)
      .map((e) => ({
        id: e.id ?? crypto.randomUUID(),
        title: e.summary ?? "(untitled)",
        start: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : ""),
        end: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : ""),
        location: e.location ?? null,
        calendarName: e.organizer?.displayName ?? null,
      }))
      .sort((a, b) => a.start.localeCompare(b.start));
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return [];
    return [];
  }
}

export async function getDueSoonAssignments(
  userId: string,
  horizonHours = 72
): Promise<DueSoonAssignment[]> {
  const now = new Date();
  const horizon = new Date(now.getTime() + horizonHours * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: assignmentsTable.id,
      title: assignmentsTable.title,
      dueAt: assignmentsTable.dueAt,
      classId: assignmentsTable.classId,
      classTitle: classesTable.name,
      classColor: classesTable.color,
    })
    .from(assignmentsTable)
    .leftJoin(classesTable, eq(classesTable.id, assignmentsTable.classId))
    .where(
      and(
        eq(assignmentsTable.userId, userId),
        isNull(assignmentsTable.deletedAt),
        ne(assignmentsTable.status, "done"),
        gte(assignmentsTable.dueAt, now),
        lte(assignmentsTable.dueAt, horizon)
      )
    )
    .orderBy(asc(assignmentsTable.dueAt))
    .limit(25);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    due: r.dueAt ? r.dueAt.toISOString() : "",
    classColor: (r.classColor as ClassColor | null) ?? null,
    classTitle: r.classTitle ?? null,
  }));
}

export function formatTimeRange(
  start: string,
  end: string,
  tz?: string
): string {
  if (!start) return "";
  try {
    const s = new Date(start);
    const e = end ? new Date(end) : null;
    const fmt = (d: Date) =>
      d.toLocaleTimeString([], {
        ...(tz ? { timeZone: tz } : {}),
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
    return e ? `${fmt(s)} — ${fmt(e)}` : fmt(s);
  } catch {
    return "";
  }
}

export function formatRelativeDue(iso: string): string {
  if (!iso) return "";
  const now = Date.now();
  const due = new Date(iso).getTime();
  const diff = due - now;
  if (diff <= 0) return "now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.round(hrs / 24);
  return `in ${days}d`;
}
