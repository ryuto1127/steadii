import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { mistakeSaveSchema, saveMistakeNote } from "@/lib/mistakes/save";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const parsed = mistakeSaveSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const result = await saveMistakeNote({
      userId: session.user.id,
      input: parsed.data,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "save_failed" },
      { status: 500 }
    );
  }
}
