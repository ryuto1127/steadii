import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { wipeAllUserData } from "@/lib/users/wipe-data";

// Locked confirmation contract: client must send `{ confirm: "DELETE" }`.
// The case-sensitive match here mirrors the GitHub-style "type DELETE to
// confirm" UX. A wrong value returns 400 — the UI keeps the button
// disabled until the input matches, so this is a defense-in-depth check.
export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as
    | { confirm?: unknown }
    | null;
  if (!body || body.confirm !== "DELETE") {
    return NextResponse.json(
      { error: "confirmation_required" },
      { status: 400 }
    );
  }
  try {
    await wipeAllUserData(session.user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[wipe-data] failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "wipe_failed" },
      { status: 500 }
    );
  }
}
