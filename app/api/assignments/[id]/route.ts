import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { z } from "zod";
import {
  softDeleteAssignment,
  updateAssignment,
} from "@/lib/assignments/save";

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  classId: z.string().uuid().nullish(),
  dueAt: z.string().datetime().nullish(),
  status: z.enum(["not_started", "in_progress", "done"]).optional(),
  priority: z.enum(["low", "medium", "high"]).nullish(),
  notes: z.string().nullish(),
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
  const result = await updateAssignment({
    userId: session.user.id,
    assignmentId: id,
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
  const result = await softDeleteAssignment({
    userId: session.user.id,
    assignmentId: id,
  });
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}
