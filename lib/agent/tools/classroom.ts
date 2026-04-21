import "server-only";
import { z } from "zod";
import {
  classroomDateToString,
  classroomTimeToString,
  getClassroomForUser,
} from "@/lib/integrations/google/classroom";
import {
  listEventsInRange,
  shouldSync,
  syncAllForRange,
} from "@/lib/calendar/events-store";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
} from "@/lib/calendar/tz-utils";
import type { ToolExecutor } from "./types";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dateOnly = z.string().regex(DATE_ONLY, "Expected YYYY-MM-DD");

const MAX_AGGREGATED = 200;

// ---------- classroom_list_courses ----------
const listCoursesArgs = z.object({
  courseStates: z.array(z.enum(["ACTIVE", "ARCHIVED"])).optional(),
});

export type ClassroomCourse = {
  id: string;
  name: string;
  section: string | null;
  descriptionHeading: string | null;
  room: string | null;
  courseState: string | null;
};

export const classroomListCourses: ToolExecutor<
  z.infer<typeof listCoursesArgs>,
  { courses: ClassroomCourse[] }
> = {
  schema: {
    name: "classroom_list_courses",
    description:
      "List the student's Google Classroom courses. `courseStates` defaults to [\"ACTIVE\"]. Returns id, name, section, descriptionHeading, room, courseState.",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        courseStates: {
          type: "array",
          items: { type: "string", enum: ["ACTIVE", "ARCHIVED"] },
        },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = listCoursesArgs.parse(rawArgs);
    const classroom = await getClassroomForUser(ctx.userId);
    const states = args.courseStates ?? ["ACTIVE"];
    const resp = await classroom.courses.list({
      courseStates: states,
      studentId: "me",
    });
    const courses: ClassroomCourse[] = (resp.data.courses ?? [])
      .filter((c): c is typeof c & { id: string } => Boolean(c.id))
      .map((c) => ({
        id: c.id,
        name: c.name ?? "(untitled)",
        section: c.section ?? null,
        descriptionHeading: c.descriptionHeading ?? null,
        room: c.room ?? null,
        courseState: c.courseState ?? null,
      }));
    return { courses };
  },
};

async function listActiveCourseIds(
  classroom: Awaited<ReturnType<typeof getClassroomForUser>>
): Promise<string[]> {
  const resp = await classroom.courses.list({
    courseStates: ["ACTIVE"],
    studentId: "me",
  });
  return (resp.data.courses ?? [])
    .map((c) => c.id)
    .filter((id): id is string => Boolean(id));
}

// ---------- classroom_list_coursework ----------
const listCourseworkArgs = z.object({
  courseId: z.string().optional(),
  dueMin: dateOnly.optional(),
  dueMax: dateOnly.optional(),
  limit: z.number().int().positive().max(MAX_AGGREGATED).optional(),
});

export type ClassroomCoursework = {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  dueDate: string | null;
  dueTime: string | null;
  workType: string | null;
  state: string | null;
  alternateLink: string | null;
  materials: { title: string; link: string | null }[];
};

function inDueRange(
  dueDate: string | null,
  dueMin?: string,
  dueMax?: string
): boolean {
  if (!dueMin && !dueMax) return true;
  if (!dueDate) return false;
  if (dueMin && dueDate < dueMin) return false;
  if (dueMax && dueDate > dueMax) return false;
  return true;
}

export const classroomListCoursework: ToolExecutor<
  z.infer<typeof listCourseworkArgs>,
  { coursework: ClassroomCoursework[] }
> = {
  schema: {
    name: "classroom_list_coursework",
    description:
      "List Google Classroom coursework (assignments). If `courseId` is omitted, aggregates across all ACTIVE courses (capped at 200). `dueMin`/`dueMax` are YYYY-MM-DD, filtered client-side (inclusive). Reads from the unified event store (synced from Google on demand).",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string" },
        dueMin: { type: "string" },
        dueMax: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_AGGREGATED },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = listCourseworkArgs.parse(rawArgs);
    const userTz = (await getUserTimezone(ctx.userId)) ?? FALLBACK_TZ;

    const now = new Date();
    const fromISO = args.dueMin
      ? localMidnightAsUtc(args.dueMin, userTz).toISOString()
      : now.toISOString();
    // End-exclusive: dueMax is inclusive on the UI side, so bump to next day.
    const toISO = args.dueMax
      ? localMidnightAsUtc(addDaysToDateStr(args.dueMax, 1), userTz).toISOString()
      : new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();

    if (shouldSync(ctx.userId, fromISO, toISO)) {
      await syncAllForRange(ctx.userId, fromISO, toISO);
    }
    const rows = await listEventsInRange(ctx.userId, fromISO, toISO, {
      sourceTypes: ["google_classroom_coursework"],
    });
    const limit = args.limit ?? MAX_AGGREGATED;
    const out: ClassroomCoursework[] = [];
    for (const r of rows) {
      const meta = (r.sourceMetadata ?? {}) as Record<string, unknown>;
      const courseId = (meta.courseId as string | undefined) ?? r.externalParentId ?? "";
      if (args.courseId && args.courseId !== courseId) continue;
      const dueDate = (meta.dueDate as string | undefined) ?? null;
      if (!inDueRange(dueDate, args.dueMin, args.dueMax)) continue;
      out.push({
        id: r.externalId,
        courseId,
        title: r.title,
        description: r.description,
        dueDate,
        dueTime: (meta.dueTime as string | null | undefined) ?? null,
        workType: (meta.workType as string | null | undefined) ?? null,
        state: (meta.state as string | null | undefined) ?? null,
        alternateLink:
          (meta.alternateLink as string | null | undefined) ?? r.url ?? null,
        materials:
          (meta.materials as Array<{ title: string; link: string | null }> | undefined) ??
          [],
      });
      if (out.length >= limit) break;
    }
    return { coursework: out };
  },
};

// Kept exports to avoid unused-var complaints when a consumer relies on them.
void classroomDateToString;
void classroomTimeToString;

// ---------- classroom_list_announcements ----------
const listAnnouncementsArgs = z.object({
  courseId: z.string().optional(),
  limit: z.number().int().positive().max(MAX_AGGREGATED).optional(),
});

export type ClassroomAnnouncement = {
  id: string;
  courseId: string;
  text: string;
  alternateLink: string | null;
  creationTime: string | null;
};

export const classroomListAnnouncements: ToolExecutor<
  z.infer<typeof listAnnouncementsArgs>,
  { announcements: ClassroomAnnouncement[] }
> = {
  schema: {
    name: "classroom_list_announcements",
    description:
      "List Google Classroom announcements. If `courseId` is omitted, aggregates across all ACTIVE courses (capped at 200).",
    mutability: "read",
    parameters: {
      type: "object",
      properties: {
        courseId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: MAX_AGGREGATED },
      },
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const args = listAnnouncementsArgs.parse(rawArgs);
    const classroom = await getClassroomForUser(ctx.userId);
    const courseIds = args.courseId
      ? [args.courseId]
      : await listActiveCourseIds(classroom);

    const limit = args.limit ?? MAX_AGGREGATED;
    const out: ClassroomAnnouncement[] = [];
    for (const courseId of courseIds) {
      if (out.length >= limit) break;
      const resp = await classroom.courses.announcements.list({ courseId });
      const items = resp.data.announcements ?? [];
      for (const a of items) {
        if (!a.id) continue;
        out.push({
          id: a.id,
          courseId,
          text: a.text ?? "",
          alternateLink: a.alternateLink ?? null,
          creationTime: a.creationTime ?? null,
        });
        if (out.length >= limit) break;
      }
    }
    return { announcements: out };
  },
};

export const CLASSROOM_TOOLS = [
  classroomListCourses,
  classroomListCoursework,
  classroomListAnnouncements,
];
