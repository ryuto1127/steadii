import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import {
  isValidIanaTimezone,
  setUserTimezone,
  setUserTimezoneIfUnset,
} from "@/lib/agent/preferences";

const bodySchema = z.object({
  timezone: z.string().min(1).max(64),
  // "auto" means the browser detected it — only write if currently null,
  // so we never overwrite a user's manual Settings choice.
  // "manual" means a deliberate user action from Settings.
  source: z.enum(["auto", "manual"]).default("manual"),
});

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const { timezone, source } = parsed.data;
  if (!isValidIanaTimezone(timezone)) {
    return NextResponse.json({ error: "invalid timezone" }, { status: 400 });
  }
  if (source === "auto") {
    const wrote = await setUserTimezoneIfUnset(session.user.id, timezone);
    return NextResponse.json({ ok: true, wrote });
  }
  await setUserTimezone(session.user.id, timezone);
  return NextResponse.json({ ok: true, wrote: true });
}
