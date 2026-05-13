import "server-only";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assignments,
  classes,
  entities,
  entityLinks,
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
    .select({ timezone: users.timezone, preferences: users.preferences })
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
      status: events.status,
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

  // engineer-49 — pull the monthly-review summary for the
  // monthly_boundary_review rule. Read fails (e.g. table missing
  // pre-migration) degrade to null so the rest of the snapshot loads.
  let monthlyReview: UserSnapshot["monthlyReview"] = null;
  try {
    const { getMonthlySummaryCounts } = await import(
      "@/lib/agent/learning/sender-confidence"
    );
    const summary = await getMonthlySummaryCounts(userId, now);
    if (summary.hasAnyRow) {
      const lastIso = userRow?.preferences?.lastMonthlyReviewAt;
      const lastReviewAt = lastIso ? new Date(lastIso) : null;
      monthlyReview = {
        lastReviewAt:
          lastReviewAt && !Number.isNaN(lastReviewAt.getTime())
            ? lastReviewAt
            : null,
        approvedThisMonth: summary.approvedThisMonth,
        dismissedThisMonth: summary.dismissedThisMonth,
        rejectedThisMonth: summary.rejectedThisMonth,
        autoSendCount: summary.autoSendCount,
        alwaysReviewCount: summary.alwaysReviewCount,
      };
    }
  } catch {
    monthlyReview = null;
  }

  // engineer-51 — entity signals for entity_fading +
  // entity_deadline_cluster rules. Wrapped in try/catch so the snapshot
  // still loads if the entities/entity_links tables haven't been
  // migrated yet (stage-mismatch between code and prod schema).
  const entitySignals = await buildEntitySignals(userId, now, assignmentRows, calendarRows).catch(() => []);

  return {
    userId,
    now,
    timezone: userRow?.timezone ?? null,
    monthlyReview,
    entitySignals,
    classes: classRows,
    calendarEvents: calendarRows.map((r) => ({
      ...r,
      startsAt: new Date(r.startsAt),
      endsAt: r.endsAt ? new Date(r.endsAt) : null,
      status: r.status ?? null,
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

// engineer-51 — build the per-entity signal block for the fading +
// deadline-cluster rules. Pulled into its own helper for clarity.
//
// Cadence math: gather the last 30 entity_links per entity, sort by
// createdAt asc, compute consecutive gaps in days, then mean + stddev.
// daysSinceLastLink is the gap from the latest link to now.
//
// Upcoming items: join entity_links → events / assignments for rows
// in [now, now+7d]. Used by the deadline-cluster detector.
async function buildEntitySignals(
  userId: string,
  now: Date,
  assignmentRows: Array<{ id: string; title: string; dueAt: Date | null; classId: string | null; status: string }>,
  calendarRows: Array<{ id: string; title: string; startsAt: Date }>
): Promise<UserSnapshot["entitySignals"]> {
  // Pull all live entities for the user. Tiny query — entity count
  // per α user is O(100), no need for a window filter.
  const entityRows = await db
    .select({
      id: entities.id,
      kind: entities.kind,
      displayName: entities.displayName,
    })
    .from(entities)
    .where(and(eq(entities.userId, userId), isNull(entities.mergedIntoEntityId)));

  if (entityRows.length === 0) return [];

  // Latest 30 link timestamps per entity. We pull all link rows for
  // the user in one query (entity_links is small-ish per user) and
  // bucket client-side — Drizzle's lateral-join story is painful.
  const linkRows = await db
    .select({
      entityId: entityLinks.entityId,
      createdAt: entityLinks.createdAt,
      sourceKind: entityLinks.sourceKind,
      sourceId: entityLinks.sourceId,
    })
    .from(entityLinks)
    .where(eq(entityLinks.userId, userId))
    .orderBy(desc(entityLinks.createdAt));

  const linksByEntity = new Map<
    string,
    Array<{ createdAt: Date; sourceKind: string; sourceId: string }>
  >();
  for (const row of linkRows) {
    const bucket = linksByEntity.get(row.entityId) ?? [];
    if (bucket.length >= 30) continue;
    bucket.push({
      createdAt: new Date(row.createdAt),
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
    });
    linksByEntity.set(row.entityId, bucket);
  }

  // Index upcoming-7d assignments + events by id so we can resolve
  // entity links → upcoming items without another DB call.
  const horizon7 = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  const upcomingById = new Map<
    string,
    {
      kind: "assignment" | "calendar_event";
      title: string;
      occursAt: Date;
    }
  >();
  for (const a of assignmentRows) {
    if (!a.dueAt) continue;
    if (a.dueAt < now || a.dueAt > horizon7) continue;
    if (a.status === "done") continue;
    upcomingById.set(a.id, {
      kind: "assignment",
      title: a.title,
      occursAt: a.dueAt,
    });
  }
  for (const e of calendarRows) {
    if (e.startsAt < now || e.startsAt > horizon7) continue;
    upcomingById.set(e.id, {
      kind: "calendar_event",
      title: e.title,
      occursAt: e.startsAt,
    });
  }

  const out: UserSnapshot["entitySignals"] = [];
  for (const ent of entityRows) {
    const links = linksByEntity.get(ent.id) ?? [];
    if (links.length === 0) continue;

    const sortedAsc = [...links].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
    );
    const newest = sortedAsc[sortedAsc.length - 1].createdAt;
    const daysSinceLastLink = Math.floor(
      (now.getTime() - newest.getTime()) / (24 * 3600 * 1000)
    );

    let meanGapDays: number | null = null;
    let stddevGapDays: number | null = null;
    if (sortedAsc.length >= 4) {
      const gaps: number[] = [];
      for (let i = 1; i < sortedAsc.length; i++) {
        const gap =
          (sortedAsc[i].createdAt.getTime() -
            sortedAsc[i - 1].createdAt.getTime()) /
          (24 * 3600 * 1000);
        gaps.push(gap);
      }
      const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const variance =
        gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length;
      meanGapDays = mean;
      stddevGapDays = Math.sqrt(variance);
    }

    const upcomingRefs: UserSnapshot["entitySignals"][number]["upcomingItemRefs"] = [];
    for (const l of sortedAsc) {
      if (l.sourceKind !== "assignment" && l.sourceKind !== "event") continue;
      const it = upcomingById.get(l.sourceId);
      if (!it) continue;
      if (upcomingRefs.some((u) => u.id === l.sourceId)) continue;
      upcomingRefs.push({
        kind: it.kind,
        id: l.sourceId,
        title: it.title,
        occursAt: it.occursAt,
      });
    }

    out.push({
      entityId: ent.id,
      kind: ent.kind,
      displayName: ent.displayName,
      daysSinceLastLink,
      meanGapDays,
      stddevGapDays,
      upcomingItemCount: upcomingRefs.length,
      upcomingItemRefs: upcomingRefs,
    });
  }
  return out;
}

// Exposed for tests.
export const _internal = { parseScheduleDate, EXAM_TOPIC_REGEX };
