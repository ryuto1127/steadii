import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { z } from "zod";
import { softDeleteClass, updateClass } from "@/lib/classes/save";

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(50).nullish(),
  term: z.string().max(100).nullish(),
  professor: z.string().max(200).nullish(),
  color: z
    .enum(["blue", "green", "orange", "purple", "red", "gray", "brown", "pink"])
    .nullish(),
  status: z.enum(["active", "archived"]).optional(),
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
  const result = await updateClass({
    userId: session.user.id,
    classId: id,
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
  const result = await softDeleteClass({
    userId: session.user.id,
    classId: id,
  });
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(result);
}
