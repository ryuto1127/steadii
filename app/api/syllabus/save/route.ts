import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { syllabusSchema } from "@/lib/syllabus/schema";
import { saveSyllabusToNotion } from "@/lib/syllabus/save";
import { z } from "zod";

const bodySchema = z.object({
  syllabus: syllabusSchema,
  classNotionPageId: z.string().optional().nullable(),
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
    const result = await saveSyllabusToNotion({
      userId: session.user.id,
      classNotionPageId: parsed.data.classNotionPageId ?? null,
      syllabus: parsed.data.syllabus,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save_failed" },
      { status: 500 }
    );
  }
}
