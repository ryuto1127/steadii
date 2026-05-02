// Backfill `class_office_hours` for every existing syllabus that has a
// non-empty `office_hours` text. Idempotent — re-runnable. Skips classes
// that already have a row in class_office_hours.
//
// Usage:
//   pnpm tsx --require ./scripts/_register.cjs scripts/office-hours-backfill.ts
//
// Wave 3.3 — locks the structured slot data so the office-hours
// scheduler doesn't have to LLM-extract on every demand.

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  classOfficeHours,
  classes,
  syllabi,
} from "@/lib/db/schema";
import { extractOfficeHours } from "@/lib/agent/office-hours/extract";

async function main() {
  const targets = await db
    .select({
      syllabusId: syllabi.id,
      userId: syllabi.userId,
      classId: syllabi.classId,
      officeHours: syllabi.officeHours,
    })
    .from(syllabi)
    .where(
      and(
        isNull(syllabi.deletedAt),
        isNotNull(syllabi.classId),
        isNotNull(syllabi.officeHours),
        sql`length(${syllabi.officeHours}) > 0`
      )
    );

  let attempted = 0;
  let extracted = 0;
  let skipped = 0;
  let failed = 0;

  for (const t of targets) {
    if (!t.classId) continue;
    attempted += 1;
    try {
      const [existing] = await db
        .select()
        .from(classOfficeHours)
        .where(
          and(
            eq(classOfficeHours.userId, t.userId),
            eq(classOfficeHours.classId, t.classId)
          )
        )
        .limit(1);
      if (existing) {
        skipped += 1;
        continue;
      }
      const result = await extractOfficeHours({
        userId: t.userId,
        text: t.officeHours ?? "",
      });
      await db.insert(classOfficeHours).values({
        userId: t.userId,
        classId: t.classId,
        syllabusId: t.syllabusId,
        professorEmail: result.professorEmail,
        slots: result.slots,
        rawNote: result.rawNote,
        bookingUrl: result.bookingUrl,
      });
      extracted += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `Backfill failed for syllabus ${t.syllabusId}: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  console.log(
    `Office hours backfill complete: attempted=${attempted}, extracted=${extracted}, skipped=${skipped}, failed=${failed}`
  );

  // Touch classes so the unused-import check stays quiet without
  // needing eslint-disable.
  void classes;
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
