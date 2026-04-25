import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { syllabusSchema } from "@/lib/syllabus/schema";
import { saveSyllabusToPostgres } from "@/lib/syllabus/save";
import { z } from "zod";

const verbatimSchema = z.object({
  fullText: z.string(),
  sourceKind: z.enum(["pdf", "image", "url"]),
  blob: z
    .object({
      blobAssetId: z.string(),
      url: z.string().url(),
      filename: z.string(),
      mimeType: z.string(),
      sizeBytes: z.number(),
    })
    .optional(),
});

const bodySchema = z.object({
  syllabus: syllabusSchema,
  // Field name kept for client-side wire compatibility; post-cutover it
  // carries a Postgres classes.id UUID, not a Notion page id.
  classNotionPageId: z.string().nullish(),
  verbatim: verbatimSchema,
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const result = await saveSyllabusToPostgres({
      userId: session.user.id,
      classId: parsed.data.classNotionPageId ?? null,
      syllabus: parsed.data.syllabus,
      verbatim: parsed.data.verbatim,
    });
    return NextResponse.json({ id: result.id, pageId: result.id, url: null });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save_failed" },
      { status: 500 }
    );
  }
}
