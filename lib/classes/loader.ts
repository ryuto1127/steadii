import "server-only";
import { db } from "@/lib/db/client";
import {
  assignments as assignmentsTable,
  classes as classesTable,
  mistakeNotes,
} from "@/lib/db/schema";
import { and, count, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { ClassColor } from "@/components/ui/class-color";
import {
  getCalendarForUser,
  CalendarNotConnectedError,
} from "@/lib/integrations/google/calendar";
import type { TimelineDay, TimelineEvent } from "@/components/ui/timeline-strip";

export type ClassRow = {
  id: string;
  name: string;
  code: string | null;
  professor: string | null;
  term: string | null;
  color: ClassColor | null;
  status: "active" | "archived";
  dueCount: number;
  mistakesCount: number;
  nextSessionLabel: string | null;
};

export async function loadClasses(userId: string): Promise<ClassRow[]> {
  const classRows = await db
    .select()
    .from(classesTable)
    .where(
      and(eq(classesTable.userId, userId), isNull(classesTable.deletedAt))
    )
    .orderBy(desc(classesTable.createdAt));

  if (classRows.length === 0) return [];

  const now = new Date();
  const dueHorizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const mistakeSince = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [dueCounts, mistakeCounts] = await Promise.all([
    db
      .select({
        classId: assignmentsTable.classId,
        n: count(assignmentsTable.id),
      })
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.userId, userId),
          isNull(assignmentsTable.deletedAt),
          ne(assignmentsTable.status, "done"),
          gte(assignmentsTable.dueAt, now),
          lte(assignmentsTable.dueAt, dueHorizon)
        )
      )
      .groupBy(assignmentsTable.classId),
    db
      .select({
        classId: mistakeNotes.classId,
        n: count(mistakeNotes.id),
      })
      .from(mistakeNotes)
      .where(
        and(
          eq(mistakeNotes.userId, userId),
          isNull(mistakeNotes.deletedAt),
          gte(mistakeNotes.createdAt, mistakeSince)
        )
      )
      .groupBy(mistakeNotes.classId),
  ]);

  const dueByClass = new Map<string, number>();
  for (const r of dueCounts) {
    if (r.classId) dueByClass.set(r.classId, Number(r.n));
  }
  const mistakeByClass = new Map<string, number>();
  for (const r of mistakeCounts) {
    if (r.classId) mistakeByClass.set(r.classId, Number(r.n));
  }

  return classRows.map((c) => ({
    id: c.id,
    name: c.name,
    code: c.code,
    professor: c.professor,
    term: c.term,
    color: (c.color as ClassColor | null) ?? null,
    status: c.status,
    dueCount: dueByClass.get(c.id) ?? 0,
    mistakesCount: mistakeByClass.get(c.id) ?? 0,
    nextSessionLabel: null,
  }));
}

export async function loadClass(
  userId: string,
  classId: string
): Promise<ClassRow | null> {
  const [row] = await db
    .select()
    .from(classesTable)
    .where(
      and(
        eq(classesTable.id, classId),
        eq(classesTable.userId, userId),
        isNull(classesTable.deletedAt)
      )
    )
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    professor: row.professor,
    term: row.term,
    color: (row.color as ClassColor | null) ?? null,
    status: row.status,
    dueCount: 0,
    mistakesCount: 0,
    nextSessionLabel: null,
  };
}

export async function loadClassById(
  userId: string,
  classId: string
): Promise<ClassRow | null> {
  return loadClass(userId, classId);
}

export type ClassSession = TimelineEvent;

export async function loadTimelineForToday(
  userId: string
): Promise<TimelineDay[]> {
  try {
    const cal = await getCalendarForUser(userId);
    const events: Record<0 | 1, TimelineEvent[]> = { 0: [], 1: [] };

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const endOfTomorrow = new Date(today);
    endOfTomorrow.setDate(endOfTomorrow.getDate() + 2);

    const resp = await cal.events.list({
      calendarId: "primary",
      timeMin: today.toISOString(),
      timeMax: endOfTomorrow.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 50,
    });
    for (const e of resp.data.items ?? []) {
      const startIso = e.start?.dateTime;
      const endIso = e.end?.dateTime;
      if (!startIso || !endIso) continue;
      const s = new Date(startIso);
      const t = new Date(endIso);
      const offset = sameDay(s, today) ? 0 : sameDay(s, addDays(today, 1)) ? 1 : -1;
      if (offset === -1) continue;
      events[offset as 0 | 1].push({
        start: s,
        end: t,
        title: e.summary ?? "(untitled)",
        color: null,
      });
    }

    return [
      { label: "Today", events: events[0] },
      { label: "Tomorrow", events: events[1] },
    ];
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return [];
    return [];
  }
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

void sql;
