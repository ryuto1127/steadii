import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { z } from "zod";
import { softDeleteSyllabus, updateSyllabus } from "@/lib/syllabus/save";

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  term: z.string().max(100).nullish(),
  classId: z.string().uuid().nullish(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const parsed = patchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const result = await updateSyllabus({
    userId: session.user.id,
    syllabusId: id,
    input: parsed.data,
  });
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id } = await params;
  const result = await softDeleteSyllabus({
    userId: session.user.id,
    syllabusId: id,
  });
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}
