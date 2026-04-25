import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { z } from "zod";
import {
  softDeleteMistakeNote,
  updateMistakeNote,
} from "@/lib/mistakes/save";

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  classId: z.string().nullish(),
  unit: z.string().nullish(),
  difficulty: z.enum(["easy", "medium", "hard"]).nullish(),
  tags: z.array(z.string()).optional(),
  bodyMarkdown: z.string().optional(),
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
  try {
    const result = await updateMistakeNote({
      userId: session.user.id,
      mistakeId: id,
      input: parsed.data,
    });
    if (!result) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save_failed" },
      { status: 500 }
    );
  }
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
  const result = await softDeleteMistakeNote({
    userId: session.user.id,
    mistakeId: id,
  });
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}
