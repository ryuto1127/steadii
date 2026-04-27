import "server-only";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assignments,
  classes,
  events,
  mistakeNotes,
  syllabi,
  users,
} from "@/lib/db/schema";
import type { UserSnapshot } from "./types";

// Forward window for "what to scan." 90 days catches term-end exams and
// upcoming deadlines without dragging the whole semester. Rules tighten
// further (e.g., "exam in <7 days" restricts to a sub-window inside this).
const HORIZON_DAYS = 90;

// Backward window to compute "recent activity" per class for Rule 4
// (exam_under_prepared). 14 days per the locked rule.
const ACTIVITY_LOOKBACK_DAYS = 14;

// Heuristic exam-keyword matcher for syllabus.schedule[]. Conservative —
// false negatives mean we miss a proactive nudge; false positives mean a
// noisy alert. Tuned toward the former.
const EXAM_TOPIC_REGEX =
  /\b(exam|midterm|final|quiz|試験|期末|中間|中試|期末試験|中間試験|テスト)\b/i;

// Lecture-block heuristic: a syllabus.schedule row is treated as a lecture
// when `topic` is a unit/chapter label rather than an exam. We tag the
// lecture window using the date plus a default 1.5h block (since the
// schema doesn't store explicit start/end). This is approximate by design;
// Rule 1 emits a `time_conflict` only when the calendar event clearly
// overlaps the resulting block.
const DEFAULT_LECTURE_HOURS = 1.5;

export async function buildUserSnapshot(
  userId: string,
  now: Date = new Date()
): Promise<UserSnapshot> {
  const horizonEnd = new Date(now.getTime() + HORIZON_DAYS * 24 * 3600 * 1000);
  const activityFloor = new Date(
    now.getTime() - ACTIVITY_LOOKBACK_DAYS * 24 * 3600 * 1000
  );

  const [userRow] = await db
    .select({ timezone: users.timezone })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const classRows = await db
    .select({
      id: classes.id,
      name: classes.name,
      code: classes.code,
      professor: classes.professor,
      status: classes.status,
    })
    .from(classes)
    .where(
      and(
        eq(classes.userId, userId),
        isNull(classes.deletedAt),
        eq(classes.status, "active")
      )
    );

  const calendarRows = await db
    .select({
      id: events.id,
      sourceType: events.sourceType,
      externalId: events.externalId,
      title: events.title,
      description: events.description,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      isAllDay: events.isAllDay,
      location: events.location,
    })
    .from(events)
    .where(
      and(
        eq(events.userId, userId),
        isNull(events.deletedAt),
        gte(events.startsAt, now),
        lt(events.startsAt, horizonEnd)
      )
    )
    .orderBy(events.startsAt);

  const assignmentRows = await db
    .select({
      id: assignments.id,
      classId: assignments.classId,
      title: assignments.title,
      dueAt: assignments.dueAt,
      status: assignments.status,
    })
    .from(assignments)
    .where(
      and(
        eq(assignments.userId, userId),
        isNull(assignments.deletedAt),
        sql`${assignments.status} != 'done'`
      )
    );

  const syllabusRows = await db
    .select({
      id: syllabi.id,
      classId: syllabi.classId,
      title: syllabi.title,
      schedule: syllabi.schedule,
    })
    .from(syllabi)
    .where(and(eq(syllabi.userId, userId), isNull(syllabi.deletedAt)));

  // Recent mistake notes per class — used as Rule 4's prep signal. We pick
  // the latest per class and compute days-since.
  const recentMistakeRows = await db
    .select({
      classId: mistakeNotes.classId,
      createdAt: mistakeNotes.createdAt,
    })
    .from(mistakeNotes)
    .where(
      and(
        eq(mistakeNotes.userId, userId),
        isNull(mistakeNotes.deletedAt),
        gte(mistakeNotes.createdAt, activityFloor)
      )
    )
    .orderBy(desc(mistakeNotes.createdAt));

  // Recent chat-message activity by class is harder to attribute (no
  // class FK on messages). Skip for now and rely on mistake notes — Rule
  // 4 still fires correctly when classId-attributable signal is absent.

  const classIdSet = new Set(classRows.map((c) => c.id));
  const recentClassActivityDays: Record<string, number | null> = {};
  for (const c of classRows) {
    recentClassActivityDays[c.id] = null;
  }
  for (const m of recentMistakeRows) {
    if (!m.classId || !classIdSet.has(m.classId)) continue;
    if (recentClassActivityDays[m.classId] != null) continue; // already most-recent
    const days = Math.floor(
      (now.getTime() - new Date(m.createdAt).getTime()) / (24 * 3600 * 1000)
    );
    recentClassActivityDays[m.classId] = days;
  }

  // Derive class-time blocks + exam windows from syllabus.schedule[].
  const classTimeBlocks: UserSnapshot["classTimeBlocks"] = [];
  const examWindows: UserSnapshot["examWindows"] = [];
  for (const syl of syllabusRows) {
    const cls = classRows.find((c) => c.id === syl.classId);
    if (!syl.schedule) continue;
    for (const item of syl.schedule) {
      if (!item.date) continue;
      const start = parseScheduleDate(item.date);
      if (!start) continue;
      if (start < now || start > horizonEnd) continue;
      const isExam = item.topic ? EXAM_TOPIC_REGEX.test(item.topic) : false;
      const end = new Date(
        start.getTime() + DEFAULT_LECTURE_HOURS * 3600 * 1000
      );
      if (isExam) {
        examWindows.push({
          classId: syl.classId,
          classCode: cls?.code ?? null,
          className: cls?.name ?? syl.title,
          startsAt: start,
          endsAt: end,
          label: item.topic ?? "Exam",
        });
      } else if (syl.classId) {
        classTimeBlocks.push({
          classId: syl.classId,
          classCode: cls?.code ?? null,
          className: cls?.name ?? syl.title,
          startsAt: start,
          endsAt: end,
          topic: item.topic,
        });
      }
    }
  }

  return {
    userId,
    now,
    timezone: userRow?.timezone ?? null,
    classes: classRows,
    calendarEvents: calendarRows.map((r) => ({
      ...r,
      startsAt: new Date(r.startsAt),
      endsAt: r.endsAt ? new Date(r.endsAt) : null,
    })),
    assignments: assignmentRows.map((a) => ({
      ...a,
      dueAt: a.dueAt ? new Date(a.dueAt) : null,
    })),
    syllabi: syllabusRows.map((s) => ({
      id: s.id,
      classId: s.classId,
      title: s.title,
      schedule: s.schedule ?? [],
    })),
    classTimeBlocks,
    examWindows,
    recentClassActivityDays,
  };
}

// Parses syllabus schedule date strings. Accepts ISO ("2026-05-16",
// "2026-05-16T14:00:00"), Japanese-style ("5/16", "5月16日"), and
// US-style fragments. Returns null when no parse is possible — callers
// drop the row silently.
function parseScheduleDate(input: string): Date | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Try ISO first.
  const iso = new Date(trimmed);
  if (!Number.isNaN(iso.getTime())) return iso;
  // Try M/D or M/D HH:MM (assume current year).
  const slash = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (slash) {
    const year = new Date().getFullYear();
    const [, m, d, hh, mm] = slash;
    return new Date(
      year,
      Number(m) - 1,
      Number(d),
      hh ? Number(hh) : 9,
      mm ? Number(mm) : 0
    );
  }
  const jp = trimmed.match(/^(\d{1,2})月(\d{1,2})日(?:\s+(\d{1,2}):(\d{2}))?/);
  if (jp) {
    const year = new Date().getFullYear();
    const [, m, d, hh, mm] = jp;
    return new Date(
      year,
      Number(m) - 1,
      Number(d),
      hh ? Number(hh) : 9,
      mm ? Number(mm) : 0
    );
  }
  return null;
}

// Exposed for tests.
export const _internal = { parseScheduleDate, EXAM_TOPIC_REGEX };
