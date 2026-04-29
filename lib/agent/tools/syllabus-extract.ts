import "server-only";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  blobAssets,
  classes as classesTable,
  messageAttachments,
  type ClassColorEnum,
} from "@/lib/db/schema";
import { extractSyllabus } from "@/lib/syllabus/extract";
import { extractPdfText, formatPdfWithPageMarkers } from "@/lib/syllabus/pdf";
import { saveSyllabusToPostgres } from "@/lib/syllabus/save";
import { createClass } from "@/lib/classes/save";
import type { ToolExecutor } from "./types";

const CLASS_COLOR_PALETTE: ClassColorEnum[] = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "gray",
  "brown",
  "pink",
];

async function resolveOrCreateClass(args: {
  userId: string;
  courseName: string | null | undefined;
  courseCode: string | null | undefined;
}): Promise<{
  classId: string | null;
  className: string | null;
  classCode: string | null;
  createdClass: boolean;
}> {
  const courseName = args.courseName?.trim() ?? "";
  const courseCode = args.courseCode?.trim() ?? "";
  if (!courseName && !courseCode) {
    return {
      classId: null,
      className: null,
      classCode: null,
      createdClass: false,
    };
  }

  const existing = await db
    .select({
      id: classesTable.id,
      name: classesTable.name,
      code: classesTable.code,
    })
    .from(classesTable)
    .where(
      and(eq(classesTable.userId, args.userId), isNull(classesTable.deletedAt))
    );

  const codeNorm = courseCode.toLowerCase();
  const nameNorm = courseName.toLowerCase();
  if (codeNorm) {
    const match = existing.find(
      (c) => (c.code ?? "").trim().toLowerCase() === codeNorm
    );
    if (match) {
      return {
        classId: match.id,
        className: match.name,
        classCode: match.code,
        createdClass: false,
      };
    }
  }
  if (nameNorm) {
    const match = existing.find(
      (c) => c.name.trim().toLowerCase() === nameNorm
    );
    if (match) {
      return {
        classId: match.id,
        className: match.name,
        classCode: match.code,
        createdClass: false,
      };
    }
  }

  const color =
    CLASS_COLOR_PALETTE[existing.length % CLASS_COLOR_PALETTE.length];
  const name = courseName || courseCode;
  const created = await createClass({
    userId: args.userId,
    input: {
      name,
      code: courseCode || null,
      color,
    },
  });
  return {
    classId: created.id,
    className: name,
    classCode: courseCode || null,
    createdClass: true,
  };
}

const args = z.object({
  attachmentUrl: z
    .string()
    .url()
    .describe(
      "The Vercel Blob URL of the user-attached PDF or image — exactly the URL surfaced in the prior `[User attached PDF: filename — url]` text note."
    ),
  classId: z
    .string()
    .uuid()
    .nullish()
    .describe(
      "Optional Steadii class id to attach the syllabus to. If omitted, the syllabus is saved unattached and the user can link it later."
    ),
});

export type SyllabusExtractResult = {
  syllabusId: string;
  title: string;
  classId: string | null;
  className: string | null;
  classCode: string | null;
  createdClass: boolean;
  scheduleCount: number;
};

export const syllabusExtract: ToolExecutor<
  z.infer<typeof args>,
  SyllabusExtractResult
> = {
  schema: {
    name: "syllabus_extract",
    description:
      "Extract a syllabus PDF or image the user just attached and persist it to Steadii's syllabus store. Use ONLY when the user's attachment appears to be a course syllabus (course code in filename, mentions exam dates, has a weekly schedule). The tool: (1) downloads the attached file, (2) runs structured extraction (course info, weekly schedule, grading), (3) resolves a class — when `classId` isn't supplied, matches the extracted course code/name to an existing class, otherwise creates a new class with a free color (the result indicates which via `createdClass`), (4) saves it — which triggers an automatic Google Calendar import of the schedule (skipping items already on the calendar, surfacing ambiguous matches as proposals). The response surfaces `className`/`classCode`/`createdClass` so the assistant can mention which class was attached or freshly created. DO NOT call this for non-syllabus PDFs (past exams, lecture slides, scanned notes, study material).",
    mutability: "write",
    parameters: {
      type: "object",
      properties: {
        attachmentUrl: { type: "string" },
        classId: { type: ["string", "null"] },
      },
      required: ["attachmentUrl"],
      additionalProperties: false,
    },
  },
  async execute(ctx, rawArgs) {
    const parsed = args.parse(rawArgs);

    // Confirm the URL belongs to a chat attachment uploaded by this user.
    // Two-step: messageAttachments.url → blobAssets.userId. Prevents the
    // model from being tricked into extracting an arbitrary URL on the
    // user's behalf (and from spending their credits on it).
    const [att] = await db
      .select({
        url: messageAttachments.url,
        kind: messageAttachments.kind,
        filename: messageAttachments.filename,
        mimeType: messageAttachments.mimeType,
        blobAssetId: messageAttachments.blobAssetId,
      })
      .from(messageAttachments)
      .innerJoin(blobAssets, eq(messageAttachments.blobAssetId, blobAssets.id))
      .where(
        and(
          eq(messageAttachments.url, parsed.attachmentUrl),
          eq(blobAssets.userId, ctx.userId)
        )
      )
      .limit(1);
    if (!att) {
      throw new Error(
        "Attachment not found for this user. Pass the exact URL surfaced in the chat history."
      );
    }
    if (att.kind !== "pdf" && att.kind !== "image") {
      throw new Error(`Unsupported attachment kind: ${att.kind}`);
    }

    let explicitClass: { id: string; name: string; code: string | null } | null =
      null;
    if (parsed.classId) {
      const [owned] = await db
        .select({
          id: classesTable.id,
          name: classesTable.name,
          code: classesTable.code,
        })
        .from(classesTable)
        .where(
          and(
            eq(classesTable.id, parsed.classId),
            eq(classesTable.userId, ctx.userId),
            isNull(classesTable.deletedAt)
          )
        )
        .limit(1);
      if (!owned) {
        throw new Error("classId does not belong to this user.");
      }
      explicitClass = owned;
    }

    const fetched = await fetch(att.url);
    if (!fetched.ok) {
      throw new Error(`Failed to download attachment (${fetched.status}).`);
    }
    const bytes = Buffer.from(await fetched.arrayBuffer());

    let fullText: string;
    let sourceKind: "pdf" | "image";
    let extracted;
    if (att.kind === "pdf") {
      sourceKind = "pdf";
      const pdf = await extractPdfText(bytes);
      const pageMarked = formatPdfWithPageMarkers(pdf.pages) || pdf.text;
      extracted = await extractSyllabus({
        userId: ctx.userId,
        source: { kind: "pdf_text", text: pdf.text || "(empty PDF)" },
      });
      if (!extracted.raw || extracted.raw.trim().length === 0) {
        extracted.raw = pageMarked;
      }
      fullText = pageMarked;
    } else {
      sourceKind = "image";
      extracted = await extractSyllabus({
        userId: ctx.userId,
        source: {
          kind: "image",
          url: att.url,
          mimeType: att.mimeType ?? "image/png",
        },
      });
      fullText = extracted.raw ?? "";
    }

    const resolved = explicitClass
      ? {
          classId: explicitClass.id,
          className: explicitClass.name,
          classCode: explicitClass.code,
          createdClass: false,
        }
      : await resolveOrCreateClass({
          userId: ctx.userId,
          courseName: extracted.courseName,
          courseCode: extracted.courseCode,
        });

    const saved = await saveSyllabusToPostgres({
      userId: ctx.userId,
      classId: resolved.classId,
      syllabus: extracted,
      verbatim: {
        fullText,
        sourceKind,
        blob: att.blobAssetId
          ? {
              blobAssetId: att.blobAssetId,
              url: att.url,
              filename: att.filename ?? "syllabus",
              mimeType: att.mimeType ?? "application/octet-stream",
              sizeBytes: bytes.byteLength,
            }
          : undefined,
      },
    });

    return {
      syllabusId: saved.id,
      title:
        extracted.courseName ??
        extracted.courseCode ??
        att.filename ??
        "Untitled Syllabus",
      classId: resolved.classId,
      className: resolved.className,
      classCode: resolved.classCode,
      createdClass: resolved.createdClass,
      scheduleCount: extracted.schedule?.length ?? 0,
    };
  },
};

export const SYLLABUS_EXTRACT_TOOLS = [syllabusExtract];
