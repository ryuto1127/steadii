import "server-only";
import {
  ClassroomNotConnectedError,
  classroomDateToString,
  classroomTimeToString,
  getClassroomForUser,
} from "@/lib/integrations/google/classroom";
import { getUserTimezone } from "@/lib/agent/preferences";
import {
  type AdapterResult,
  type CanonicalEventInput,
  getGoogleAccountId,
  registerAdapter,
  softDeleteMissing,
  upsertFromSourceRow,
} from "@/lib/calendar/events-store";
import {
  FALLBACK_TZ,
  addDaysToDateStr,
  localMidnightAsUtc,
  wallTimeInZoneToUtc,
} from "@/lib/calendar/tz-utils";

async function sync(
  userId: string,
  fromISO: string,
  toISO: string
): Promise<AdapterResult> {
  let classroom;
  try {
    classroom = await getClassroomForUser(userId);
  } catch (err) {
    if (err instanceof ClassroomNotConnectedError) {
      return { ok: true, upserted: 0, softDeleted: 0 };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const accountId = (await getGoogleAccountId(userId)) ?? "unknown";
  const userTz = (await getUserTimezone(userId)) ?? FALLBACK_TZ;

  let courses;
  try {
    courses = await classroom.courses.list({
      courseStates: ["ACTIVE"],
      studentId: "me",
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const from = new Date(fromISO);
  const to = new Date(toISO);

  const keepIds = new Set<string>();
  let upserted = 0;

  const activeCourses = (courses.data.courses ?? []).filter(
    (c): c is typeof c & { id: string } => Boolean(c.id)
  );

  for (const course of activeCourses) {
    try {
      const resp = await classroom.courses.courseWork.list({
        courseId: course.id,
      });
      for (const cw of resp.data.courseWork ?? []) {
        if (!cw.id) continue;
        const date = classroomDateToString(cw.dueDate);
        if (!date) continue;
        const time = classroomTimeToString(cw.dueTime);
        let startsAt: Date;
        let isAllDay = false;
        if (time) {
          const [h, m] = time.split(":").map(Number);
          startsAt = wallTimeInZoneToUtc(
            Number(date.slice(0, 4)),
            Number(date.slice(5, 7)),
            Number(date.slice(8, 10)),
            h,
            m,
            0,
            userTz
          );
        } else {
          isAllDay = true;
          startsAt = localMidnightAsUtc(date, userTz);
        }
        if (startsAt < from || startsAt >= to) continue;

        const status =
          cw.state === "DELETED"
            ? ("cancelled" as const)
            : ("needs_action" as const);

        const row: CanonicalEventInput = {
          userId,
          sourceType: "google_classroom_coursework",
          sourceAccountId: accountId,
          externalId: cw.id,
          externalParentId: course.id,
          kind: "assignment",
          title: cw.title ?? "(untitled)",
          description: cw.description ?? null,
          startsAt,
          endsAt: isAllDay
            ? localMidnightAsUtc(addDaysToDateStr(date, 1), userTz)
            : null,
          isAllDay,
          originTimezone: userTz,
          location: null,
          url: cw.alternateLink ?? null,
          status,
          sourceMetadata: {
            courseId: course.id,
            courseName: course.name ?? null,
            section: course.section ?? null,
            workType: cw.workType ?? null,
            state: cw.state ?? null,
            alternateLink: cw.alternateLink ?? null,
            materials: (cw.materials ?? []).map((mat) => ({
              title:
                mat.driveFile?.driveFile?.title ??
                mat.youtubeVideo?.title ??
                mat.link?.title ??
                mat.form?.title ??
                "(material)",
              link:
                mat.driveFile?.driveFile?.alternateLink ??
                mat.youtubeVideo?.alternateLink ??
                mat.link?.url ??
                mat.form?.formUrl ??
                null,
            })),
            dueDate: date,
            dueTime: time,
          },
          normalizedKey: null,
        };

        await upsertFromSourceRow(row);
        keepIds.add(cw.id);
        upserted += 1;
      }
    } catch (err) {
      console.error(
        `[sync/google-classroom] course ${course.id}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  let softDeleted = 0;
  try {
    softDeleted = await softDeleteMissing(
      userId,
      "google_classroom_coursework",
      fromISO,
      toISO,
      keepIds
    );
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return { ok: true, upserted, softDeleted };
}

registerAdapter("google_classroom_coursework", sync);

export const syncRange = sync;
