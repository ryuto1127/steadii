import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { assignments, classes } from "@/lib/db/schema";
import {
  listEventsInRange,
  shouldSync,
  syncAllForRange,
} from "@/lib/calendar/events-store";
import { getUserTimezone } from "@/lib/agent/preferences";
import { FALLBACK_TZ } from "@/lib/calendar/tz-utils";
import {
  visibleRange,
  type CalendarAssignment,
  type CalendarEvent,
  type CalendarItem,
  type CalendarTask,
  type CalendarView,
} from "@/lib/calendar/events";
import { CalendarView as CalendarViewClient } from "@/components/calendar/calendar-view";

export const dynamic = "force-dynamic";

function parseView(v: string | undefined): CalendarView {
  if (v === "month" || v === "week" || v === "day") return v;
  return "week";
}

function parseAnchor(v: string | undefined): Date {
  if (!v) return new Date();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

// Format a UTC Date as a "YYYY-MM-DDTHH:mm:ss±HH:MM" string in `tz`, suitable
// for the calendar UI's CalendarEvent.start/end fields, which parse both
// RFC3339 strings (timed) and YYYY-MM-DD (all-day).
function utcToZoneWallClock(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const h = g("hour") === "24" ? "00" : g("hour");
  // Offset via formatToParts with timeZoneName=shortOffset.
  const offsetFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    timeZoneName: "shortOffset",
  });
  const match = offsetFmt
    .formatToParts(d)
    .find((p) => p.type === "timeZoneName")?.value;
  let offset = "+00:00";
  if (match && /GMT([+-]\d{1,2})(?::?(\d{2}))?/.test(match)) {
    const m = /GMT([+-])(\d{1,2})(?::?(\d{2}))?/.exec(match);
    if (m) {
      const sign = m[1];
      const hh = String(m[2]).padStart(2, "0");
      const mm = m[3] ?? "00";
      offset = `${sign}${hh}:${mm}`;
    }
  }
  return `${g("year")}-${g("month")}-${g("day")}T${h}:${g("minute")}:${g("second")}${offset}`;
}

function zoneDateString(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "01";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; anchor?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const sp = await searchParams;
  const view = parseView(sp.view);
  const anchor = parseAnchor(sp.anchor);
  const range = visibleRange(view, anchor);
  const userTz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;

  const fromISO = range.start.toISOString();
  const toISO = range.end.toISOString();

  // First-visit: await the sync so L4 is populated. Subsequent fresh loads
  // within 60s skip it entirely; stale ones kick off a background sync.
  let err: string | null = null;
  let tasksScopeMissing = false;
  const needsSync = shouldSync(userId, fromISO, toISO);
  // Check emptiness cheaply before awaiting.
  const pre = await listEventsInRange(userId, fromISO, toISO);
  if (needsSync) {
    if (pre.length === 0) {
      try {
        const result = await syncAllForRange(userId, fromISO, toISO);
        // Surface a hint if tasks scope is missing (TasksNotConnectedError is
        // swallowed by the adapter as ok:true, so inspect non-ok sources).
        const tasksRes = result.bySource.google_tasks;
        if (tasksRes && !tasksRes.ok) {
          if (/scope|not connect/i.test(tasksRes.error)) tasksScopeMissing = true;
        }
      } catch (e) {
        err = e instanceof Error ? e.message : "failed to load";
      }
    } else {
      // Fire-and-forget: don't block first paint.
      void syncAllForRange(userId, fromISO, toISO).catch(() => {});
    }
  }

  const rows = needsSync && pre.length === 0
    ? await listEventsInRange(userId, fromISO, toISO)
    : pre;

  const items: CalendarItem[] = [];
  for (const r of rows) {
    if (r.kind === "event") {
      const start = r.isAllDay
        ? zoneDateString(r.startsAt, r.originTimezone ?? userTz)
        : utcToZoneWallClock(r.startsAt, r.originTimezone ?? userTz);
      const end =
        r.endsAt == null
          ? start
          : r.isAllDay
            ? zoneDateString(r.endsAt, r.originTimezone ?? userTz)
            : utcToZoneWallClock(r.endsAt, r.originTimezone ?? userTz);
      const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>;
      const reminderOverrides =
        (meta.reminders as { overrides?: Array<{ method?: string; minutes?: number }> } | null)
          ?.overrides ?? [];
      const popupMinutes = reminderOverrides
        .filter((o) => o.method === "popup" && typeof o.minutes === "number")
        .map((o) => o.minutes as number);
      const ce: CalendarEvent = {
        kind: "event",
        id: r.externalId,
        summary: r.title,
        start,
        end,
        allDay: r.isAllDay,
        location: r.location,
        description: r.description,
        recurrence: (meta.recurrence as string[] | null) ?? null,
        recurringEventId: (meta.recurringEventId as string | null) ?? null,
        reminders: popupMinutes.length > 0 ? { minutes: popupMinutes } : null,
      };
      items.push(ce);
    } else if (r.kind === "task") {
      const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>;
      const due = (meta.dueDate as string | undefined) ??
        zoneDateString(r.startsAt, r.originTimezone ?? userTz);
      const ct: CalendarTask = {
        kind: "task",
        id: r.externalId,
        title: r.title,
        due,
        notes: r.description,
        completed: r.status === "completed",
        taskListId: (meta.taskListId as string | undefined) ?? "@default",
        parentId: (meta.parentTaskId as string | null | undefined) ?? null,
        origin: "google_tasks",
        url: r.url,
      };
      items.push(ct);
    } else if (r.kind === "assignment") {
      const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>;
      const dueDate = (meta.dueDate as string | undefined) ??
        zoneDateString(r.startsAt, r.originTimezone ?? userTz);
      const courseName = (meta.courseName as string | null | undefined) ?? null;
      const ct: CalendarTask = {
        kind: "task",
        id: r.externalId,
        title: courseName ? `${r.title} · ${courseName}` : r.title,
        due: dueDate,
        notes: r.description,
        completed: false,
        taskListId: "__classroom__",
        parentId: null,
        origin: "google_classroom",
        url: r.url ?? (meta.alternateLink as string | undefined) ?? null,
      };
      items.push(ct);
    }
  }

  // Phase 7 W1 — Steadii's own assignments. Pulled directly from the
  // canonical `assignments` table (not via the events sync) so users see
  // their tracker tasks on the calendar without setting up a sync
  // adapter. Joined to classes so the visible chip can show the class
  // name without an extra round-trip in the client.
  const steadiiRows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
      dueAt: assignments.dueAt,
      status: assignments.status,
      priority: assignments.priority,
      notes: assignments.notes,
      classId: assignments.classId,
      className: classes.name,
    })
    .from(assignments)
    .leftJoin(classes, eq(classes.id, assignments.classId))
    .where(
      and(
        eq(assignments.userId, userId),
        isNull(assignments.deletedAt),
        gte(assignments.dueAt, range.start),
        lt(assignments.dueAt, range.end)
      )
    );
  for (const a of steadiiRows) {
    if (!a.dueAt) continue;
    const due = zoneDateString(a.dueAt, userTz);
    const ca: CalendarAssignment = {
      kind: "assignment",
      id: a.id,
      title: a.title,
      due,
      notes: a.notes,
      classId: a.classId,
      className: a.className,
      status: a.status,
      priority: a.priority,
    };
    items.push(ca);
  }

  return (
    <CalendarViewClient
      initialItems={items}
      initialView={view}
      initialAnchorIso={anchor.toISOString()}
      initialError={err}
      tasksScopeMissing={tasksScopeMissing}
    />
  );
}
