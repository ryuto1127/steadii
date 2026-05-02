import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { db } from "@/lib/db/client";
import { classes as classesTable } from "@/lib/db/schema";
import { and, eq, isNull, desc } from "drizzle-orm";
import { SyllabusWizard } from "@/components/syllabus/syllabus-wizard";

export const dynamic = "force-dynamic";

export default async function NewSyllabusPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const t = await getTranslations("syllabus_new_page");

  const rows = await db
    .select({ id: classesTable.id, name: classesTable.name })
    .from(classesTable)
    .where(
      and(
        eq(classesTable.userId, userId),
        isNull(classesTable.deletedAt),
        eq(classesTable.status, "active")
      )
    )
    .orderBy(desc(classesTable.createdAt))
    .limit(100);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>
      <p className="mt-2 text-small text-[hsl(var(--muted-foreground))]">
        {t("subtitle")}
      </p>
      <SyllabusWizard
        classes={rows}
        blobConfigured={!!process.env.BLOB_READ_WRITE_TOKEN}
      />
    </div>
  );
}
