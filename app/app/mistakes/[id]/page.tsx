import { auth } from "@/lib/auth/config";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db/client";
import {
  classes as classesTable,
  mistakeNotes,
} from "@/lib/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { MistakeMarkdownEditor } from "@/components/mistakes/markdown-editor";

export const dynamic = "force-dynamic";

export default async function MistakeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;

  const [row] = await db
    .select()
    .from(mistakeNotes)
    .where(
      and(
        eq(mistakeNotes.id, id),
        eq(mistakeNotes.userId, userId),
        isNull(mistakeNotes.deletedAt)
      )
    )
    .limit(1);
  if (!row) notFound();

  const cls = await db
    .select({ id: classesTable.id, name: classesTable.name })
    .from(classesTable)
    .where(
      and(eq(classesTable.userId, userId), isNull(classesTable.deletedAt))
    )
    .orderBy(desc(classesTable.createdAt))
    .limit(200);

  return (
    <div className="mx-auto max-w-4xl py-2 md:py-6">
      <MistakeMarkdownEditor
        mistakeId={row.id}
        initialTitle={row.title}
        initialUnit={row.unit}
        initialDifficulty={row.difficulty}
        initialTags={row.tags ?? []}
        initialBody={row.bodyMarkdown ?? ""}
        initialClassId={row.classId}
        classes={cls}
      />
    </div>
  );
}
