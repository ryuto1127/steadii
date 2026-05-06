import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { setUserVoiceTriggerKey } from "@/lib/agent/preferences";

const bodySchema = z.object({
  triggerKey: z.enum(["caps_lock", "alt_right", "meta_right"]),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid trigger key" }, { status: 400 });
  }
  await setUserVoiceTriggerKey(session.user.id, parsed.data.triggerKey);
  return NextResponse.json({ ok: true });
}
