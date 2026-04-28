import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  assignments as assignmentsTable,
  classes as classesTable,
  mistakeNotes,
  syllabi,
} from "@/lib/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";

// Counts of items that will be cascade-deleted when this class is removed.
// Used to render "Delete X? This will also delete N syllabi, …" so the user
// sees the implication before confirming.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;

  const [cls] = await db
    .select({ id: classesTable.id })
    .from(classesTable)
    .where(
      and(
        eq(classesTable.id, id),
        eq(classesTable.userId, userId),
        isNull(classesTable.deletedAt)
      )
    )
    .limit(1);
  if (!cls) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [syllabiCount, assignmentsCount, mistakesCount] = await Promise.all([
    db
      .select({ n: count() })
      .from(syllabi)
      .where(
        and(
          eq(syllabi.userId, userId),
          eq(syllabi.classId, id),
          isNull(syllabi.deletedAt)
        )
      )
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(assignmentsTable)
      .where(
        and(
          eq(assignmentsTable.userId, userId),
          eq(assignmentsTable.classId, id),
          isNull(assignmentsTable.deletedAt)
        )
      )
      .then((r) => Number(r[0]?.n ?? 0)),
    db
      .select({ n: count() })
      .from(mistakeNotes)
      .where(
        and(
          eq(mistakeNotes.userId, userId),
          eq(mistakeNotes.classId, id),
          isNull(mistakeNotes.deletedAt)
        )
      )
      .then((r) => Number(r[0]?.n ?? 0)),
  ]);

  return NextResponse.json({
    syllabi: syllabiCount,
    assignments: assignmentsCount,
    mistakes: mistakesCount,
  });
}
