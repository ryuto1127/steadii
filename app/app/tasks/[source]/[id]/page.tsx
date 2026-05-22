// 2026-05-21 — Task detail page. Fixes the surprising
// "click a task → /app/classes/<id>" jump by giving each task source
// a real detail surface:
//   - Steadii (assignments): full read + mark done + class link
//   - Google Tasks / Microsoft Todo: read + mark done + "open in source"
//     deep link (no in-app edit; that lives in the source app)
//
// URL shape: /app/tasks/<source>/<id>
//   - steadii: id = assignment UUID
//   - external: id = "<taskListId>:<taskId>" (colon-joined so a single
//     dynamic segment carries both halves the complete-task action needs)

import "server-only";

import { auth } from "@/lib/auth/config";
import { notFound, redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { getTranslations } from "next-intl/server";

import { db } from "@/lib/db/client";
import { assignments, classes } from "@/lib/db/schema";
import { fetchUpcomingTasks } from "@/lib/integrations/google/tasks";
import { fetchMsUpcomingTasks } from "@/lib/integrations/microsoft/tasks";
import { getUserTimezone } from "@/lib/agent/preferences";
import { TaskDetail } from "@/components/tasks/task-detail";

export const dynamic = "force-dynamic";

type Source = "steadii" | "google_tasks" | "microsoft_todo";

function isSource(value: string): value is Source {
  return (
    value === "steadii" ||
    value === "google_tasks" ||
    value === "microsoft_todo"
  );
}

export default async function TaskDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ source: string; id: string }>;
  searchParams: Promise<{ list?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;
  const { source, id } = await params;
  const { list: taskListIdParam } = await searchParams;

  if (!isSource(source)) notFound();

  const t = await getTranslations("tasks");
  const tz = (await getUserTimezone(userId)) ?? "UTC";

  if (source === "steadii") {
    const [row] = await db
      .select({
        id: assignments.id,
        title: assignments.title,
        notes: assignments.notes,
        dueAt: assignments.dueAt,
        status: assignments.status,
        priority: assignments.priority,
        classId: classes.id,
        className: classes.name,
        classCode: classes.code,
        classColor: classes.color,
      })
      .from(assignments)
      .leftJoin(classes, eq(assignments.classId, classes.id))
      .where(
        and(
          eq(assignments.id, id),
          eq(assignments.userId, userId),
          isNull(assignments.deletedAt),
        ),
      )
      .limit(1);

    if (!row) notFound();

    return (
      <TaskDetail
        task={{
          source: "steadii",
          id: row.id,
          title: row.title,
          notes: row.notes,
          dueAt: row.dueAt,
          status: row.status,
          priority: row.priority,
          classId: row.classId,
          className: row.className,
          classCode: row.classCode,
          classColor: row.classColor,
        }}
        tz={tz}
      />
    );
  }

  // External (google_tasks / microsoft_todo): id = taskId, taskListId
  // comes through the `list` search param.
  if (!taskListIdParam) notFound();
  const taskListId = taskListIdParam;
  const taskId = id;

  // List-fetch + filter. α volume is bounded (≤ 25 tasks per source by
  // default in the existing fetcher) so the wasted bytes are acceptable.
  // Post-α: replace with a dedicated `get one task` per-source helper.
  const list =
    source === "google_tasks"
      ? await fetchUpcomingTasks(userId, { days: 365, daysBack: 365 })
      : await fetchMsUpcomingTasks(userId, { days: 365, daysBack: 365 });

  const task = list.find(
    (item) => item.taskId === taskId && item.taskListId === taskListId,
  );
  if (!task) notFound();

  return (
    <TaskDetail
      task={{
        source,
        taskId: task.taskId,
        taskListId: task.taskListId,
        title: task.title,
        notes: task.notes,
        due: task.due,
        completed: task.completed,
      }}
      tz={tz}
    />
  );
}

// next-intl friendly metadata stub. The translator load happens above
// inside the component path; this just stops Next from inferring an
// unhelpful default <title>.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ source: string; id: string }>;
}) {
  const { source } = await params;
  return {
    title: `${source === "steadii" ? "Steadii" : "External"} task — Steadii`,
  };
}
