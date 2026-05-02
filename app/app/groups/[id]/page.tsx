import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { auth } from "@/lib/auth/config";
import { db } from "@/lib/db/client";
import {
  classes,
  groupProjectMembers,
  groupProjectTasks,
  groupProjects,
} from "@/lib/db/schema";
import { GroupDetailClient } from "./client";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function GroupDetailPage({
  params,
}: {
  params: Params;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { id } = await params;
  const t = await getTranslations("group_detail");

  const [group] = await db
    .select()
    .from(groupProjects)
    .where(
      and(eq(groupProjects.id, id), eq(groupProjects.userId, userId))
    )
    .limit(1);
  if (!group) notFound();

  const [cls] = group.classId
    ? await db
        .select({ id: classes.id, name: classes.name, code: classes.code })
        .from(classes)
        .where(eq(classes.id, group.classId))
        .limit(1)
    : [];

  const members = await db
    .select()
    .from(groupProjectMembers)
    .where(eq(groupProjectMembers.groupProjectId, id));
  const tasks = await db
    .select()
    .from(groupProjectTasks)
    .where(eq(groupProjectTasks.groupProjectId, id));

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 md:px-10 md:py-10">
      <header className="flex flex-col gap-3">
        <Link
          href="/app"
          className="inline-flex w-fit items-center gap-1 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={12} strokeWidth={1.75} />
          <span>{t("back_to_home")}</span>
        </Link>
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
            {cls?.code ? `${cls.code} · ` : ""}
            {t("eyebrow")}
          </p>
          <h1 className="font-display text-[24px] font-semibold leading-[1.1] tracking-[-0.02em] text-[hsl(var(--foreground))] md:text-[28px]">
            {group.title}
          </h1>
          {group.deadline ? (
            <p className="text-[13px] text-[hsl(var(--muted-foreground))]">
              {t("deadline_label")}{" "}
              {new Intl.DateTimeFormat("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              }).format(group.deadline)}
            </p>
          ) : null}
        </div>
      </header>

      <GroupDetailClient
        userId={userId}
        groupId={group.id}
        groupTitle={group.title}
        className={cls?.name ?? null}
        members={members.map((m) => ({
          email: m.email,
          name: m.name,
          role: m.role,
          status: m.status,
          lastMessageAt: m.lastMessageAt?.toISOString() ?? null,
          lastRespondedAt: m.lastRespondedAt?.toISOString() ?? null,
        }))}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          assigneeEmail: t.assigneeEmail,
          due: t.due?.toISOString() ?? null,
          doneAt: t.doneAt?.toISOString() ?? null,
        }))}
        sourceThreadIds={group.sourceThreadIds ?? []}
      />
    </div>
  );
}
