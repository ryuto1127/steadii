import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { getWipeCounts } from "@/lib/users/wipe-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const counts = await getWipeCounts(session.user.id);
  return NextResponse.json(counts);
}
