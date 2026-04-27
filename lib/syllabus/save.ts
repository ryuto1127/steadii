import "server-only";
import { db } from "@/lib/db/client";
import { auditLog, syllabi } from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { refreshSyllabusEmbeddings } from "@/lib/embeddings/entity-embed";
import { triggerScanInBackground } from "@/lib/agent/proactive/scanner";
import type { Syllabus } from "./schema";

export type SyllabusVerbatim = {
  fullText: string;
  sourceKind: "pdf" | "image" | "url";
  blob?: {
    blobAssetId: string;
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  };
};

// Public re-export for callers that previously used the Notion-side label.
// Kept so the read paths can present the same "Full source content" affordance
// — it is now the page's own toggle, not a Notion block label.
export const FULL_SOURCE_TOGGLE_LABEL = "Full source content";

export async function saveSyllabusToPostgres(args: {
  userId: string;
  classId?: string | null;
  syllabus: Syllabus;
  verbatim: SyllabusVerbatim;
}): Promise<{ id: string }> {
  const title =
    args.syllabus.courseName ?? args.syllabus.courseCode ?? "Untitled Syllabus";

  const classId =
    args.classId &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      args.classId
    )
      ? args.classId
      : null;

  const [row] = await db
    .insert(syllabi)
    .values({
      userId: args.userId,
      classId,
      title,
      term: args.syllabus.term ?? null,
      grading: args.syllabus.grading ?? null,
      attendance: args.syllabus.attendance ?? null,
      textbooks: args.syllabus.textbooks ?? null,
      officeHours: args.syllabus.officeHours ?? null,
      sourceUrl: args.syllabus.sourceUrl ?? null,
      sourceKind: args.verbatim.sourceKind,
      fullText: args.verbatim.fullText,
      schedule: (args.syllabus.schedule ?? []).map((s) => ({
        date: s.date ?? null,
        topic: s.topic ?? null,
      })),
      blobAssetId: args.verbatim.blob?.blobAssetId ?? null,
      blobUrl: args.verbatim.blob?.url ?? null,
      blobFilename: args.verbatim.blob?.filename ?? null,
      blobMimeType: args.verbatim.blob?.mimeType ?? null,
      blobSizeBytes: args.verbatim.blob?.sizeBytes ?? null,
    })
    .returning({ id: syllabi.id });

  // Inline embedding per scoping doc §6.4. Long full_text dominates here;
  // a 30-page syllabus chunked into ~50 × 500ms is acceptable for the
  // wizard's existing "Saving…" spinner.
  if (args.verbatim.fullText.trim()) {
    try {
      await refreshSyllabusEmbeddings({
        userId: args.userId,
        syllabusId: row.id,
        text: args.verbatim.fullText,
      });
    } catch (err) {
      console.error("[syllabus.save] embedding population failed", err);
    }
  }

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "syllabus.save",
    resourceType: "syllabus",
    resourceId: row.id,
    result: "success",
    detail: {
      title,
      classId,
      sourceKind: args.verbatim.sourceKind,
      blobUrl: args.verbatim.blob?.url ?? null,
    },
  });

  triggerScanInBackground(args.userId, {
    source: "syllabus.uploaded",
    recordId: row.id,
  });

  return { id: row.id };
}

// Backwards-compat alias for the existing import sites; renamed to
// emphasize the new canonical store. The old name kept callers working
// during the cutover; renaming in a follow-up cleanup PR.
export const saveSyllabusToNotion = saveSyllabusToPostgres;

export async function softDeleteSyllabus(args: {
  userId: string;
  syllabusId: string;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .update(syllabi)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(syllabi.id, args.syllabusId),
        eq(syllabi.userId, args.userId),
        isNull(syllabi.deletedAt)
      )
    )
    .returning({ id: syllabi.id });
  if (!row) return null;

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "syllabus.delete",
    resourceType: "syllabus",
    resourceId: row.id,
    result: "success",
  });

  triggerScanInBackground(args.userId, {
    source: "syllabus.deleted",
    recordId: row.id,
  });

  return row;
}
