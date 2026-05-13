import "server-only";
import { db } from "@/lib/db/client";
import {
  auditLog,
  mistakeNotes,
} from "@/lib/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { assertCreditsAvailable } from "@/lib/billing/credits";
import { refreshMistakeEmbeddings } from "@/lib/embeddings/entity-embed";
import { triggerScanInBackground } from "@/lib/agent/proactive/scanner";
import { buildMistakeMarkdownBody } from "./build-body";
import { z } from "zod";

// engineer-47 — chat-driven mistake save path removed. The dialog
// (MistakeNoteDialog) was a leftover from the pre-secretary-pivot
// (2026-05-01) tutor era; the "+ Steadii のメモに追加" pill triggering it
// was pulled in PR #210. The remaining handwritten-OCR + class-detail
// surfaces still write to mistake_notes via saveHandwrittenMistakeNote
// / updateMistakeNote / softDeleteMistakeNote below. See engineer-47
// PR for the cleanup rationale.

export { buildMistakeMarkdownBody };

export const handwrittenMistakeSaveSchema = z.object({
  title: z.string().min(1),
  classId: z.string().uuid().nullish(),
  unit: z.string().nullish(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  tags: z.array(z.string()).optional(),
  bodyMarkdown: z.string().min(1),
  // The blob row for the original scan / photo. Linking it on the mistake
  // note row keeps the source page reachable even after the user edits the
  // markdown — without it, an edit would erase the only pointer back to
  // the original.
  sourceBlobAssetId: z.string().uuid(),
});

export type HandwrittenMistakeSaveInput = z.infer<
  typeof handwrittenMistakeSaveSchema
>;

// Phase 7 W-Notes — save path for OCR'd handwritten notes. Sibling to
// `saveMistakeNote` (which derives the body from a chat message); this
// one accepts a body and source-blob id directly because the "extract →
// preview → edit → save" UX has nothing to derive from.
export async function saveHandwrittenMistakeNote(args: {
  userId: string;
  input: HandwrittenMistakeSaveInput;
}): Promise<{ id: string }> {
  await assertCreditsAvailable(args.userId);

  const [row] = await db
    .insert(mistakeNotes)
    .values({
      userId: args.userId,
      classId: args.input.classId ?? null,
      title: args.input.title,
      unit: args.input.unit ?? null,
      difficulty: args.input.difficulty ?? null,
      tags: args.input.tags ?? [],
      bodyFormat: "markdown",
      bodyMarkdown: args.input.bodyMarkdown,
      source: "handwritten_ocr",
      sourceBlobAssetId: args.input.sourceBlobAssetId,
    })
    .returning({ id: mistakeNotes.id });

  // Same fanout as the chat-driven path — chunk + embed the markdown so
  // the new note shows up in retrieval immediately. Non-fatal on failure
  // for the same reasoning as `saveMistakeNote` (the row is the source
  // of truth; chunks are an advisory cache).
  try {
    await refreshMistakeEmbeddings({
      userId: args.userId,
      mistakeId: row.id,
      text: args.input.bodyMarkdown,
    });
  } catch (err) {
    console.error("[mistake.save_handwritten] embedding population failed", err);
  }

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "mistake.save_handwritten",
    resourceType: "mistake_note",
    resourceId: row.id,
    result: "success",
    detail: {
      title: args.input.title,
      classId: args.input.classId ?? null,
      tags: args.input.tags ?? [],
      sourceBlobAssetId: args.input.sourceBlobAssetId,
    },
  });

  triggerScanInBackground(args.userId, {
    source: "mistake.created",
    recordId: row.id,
  });

  return { id: row.id };
}

export async function updateMistakeNote(args: {
  userId: string;
  mistakeId: string;
  input: {
    title?: string;
    classId?: string | null;
    unit?: string | null;
    difficulty?: "easy" | "medium" | "hard" | null;
    tags?: string[];
    bodyMarkdown?: string;
  };
}): Promise<{ id: string } | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (args.input.title !== undefined) set.title = args.input.title;
  if (args.input.classId !== undefined) set.classId = args.input.classId;
  if (args.input.unit !== undefined) set.unit = args.input.unit;
  if (args.input.difficulty !== undefined) set.difficulty = args.input.difficulty;
  if (args.input.tags !== undefined) set.tags = args.input.tags;
  if (args.input.bodyMarkdown !== undefined) {
    set.bodyMarkdown = args.input.bodyMarkdown;
    set.bodyFormat = "markdown";
  }

  const [row] = await db
    .update(mistakeNotes)
    .set(set)
    .where(
      and(
        eq(mistakeNotes.id, args.mistakeId),
        eq(mistakeNotes.userId, args.userId),
        isNull(mistakeNotes.deletedAt)
      )
    )
    .returning({ id: mistakeNotes.id });

  if (!row) return null;

  if (args.input.bodyMarkdown !== undefined) {
    try {
      await refreshMistakeEmbeddings({
        userId: args.userId,
        mistakeId: row.id,
        text: args.input.bodyMarkdown,
      });
    } catch (err) {
      console.error("[mistake.update] embedding refresh failed", err);
    }
  }

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "mistake.update",
    resourceType: "mistake_note",
    resourceId: row.id,
    result: "success",
    detail: { fields: Object.keys(set).filter((k) => k !== "updatedAt") },
  });

  triggerScanInBackground(args.userId, {
    source: "mistake.updated",
    recordId: row.id,
  });

  return row;
}

export async function softDeleteMistakeNote(args: {
  userId: string;
  mistakeId: string;
}): Promise<{ id: string } | null> {
  const [row] = await db
    .update(mistakeNotes)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(mistakeNotes.id, args.mistakeId),
        eq(mistakeNotes.userId, args.userId),
        isNull(mistakeNotes.deletedAt)
      )
    )
    .returning({ id: mistakeNotes.id });
  if (!row) return null;

  await db.insert(auditLog).values({
    userId: args.userId,
    action: "mistake.delete",
    resourceType: "mistake_note",
    resourceId: row.id,
    result: "success",
  });
  return row;
}
