import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { setUserThemePreference } from "@/lib/theme/get-preference";

const bodySchema = z.object({
  theme: z.enum(["light", "dark", "system"]),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid theme" }, { status: 400 });
  }
  await setUserThemePreference(session.user.id, parsed.data.theme);
  return NextResponse.json({ ok: true });
}
