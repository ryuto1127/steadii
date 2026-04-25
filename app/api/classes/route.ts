import { NextResponse } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import { classes as classesTable } from "@/lib/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const rows = await db
    .select({
      id: classesTable.id,
      name: classesTable.name,
      status: classesTable.status,
    })
    .from(classesTable)
    .where(
      and(eq(classesTable.userId, session.user.id), isNull(classesTable.deletedAt))
    )
    .orderBy(desc(classesTable.createdAt))
    .limit(200);
  return NextResponse.json({ classes: rows });
}
