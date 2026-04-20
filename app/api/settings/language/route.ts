import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { auth } from "@/lib/auth/config";
import { setUserLocalePreference } from "@/lib/locale/get-preference";

const bodySchema = z.object({
  locale: z.enum(["en", "ja"]),
});

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const json = await request.json();
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid locale" }, { status: 400 });
  }
  await setUserLocalePreference(session.user.id, parsed.data.locale);
  const store = await cookies();
  store.set({
    name: "steadii-locale",
    value: parsed.data.locale,
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
    sameSite: "lax",
  });
  return NextResponse.json({ ok: true });
}
