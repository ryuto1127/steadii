import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assignments,
  classes,
  type AssignmentStatus,
} from "@/lib/db/schema";
import { DenseList } from "@/components/ui/dense-list";
import { DenseRowLink } from "@/components/ui/dense-row-link";
import { EmptyState } from "@/components/ui/empty-state";
import { ListChecks } from "lucide-react";

export const dynamic = "force-dynamic";

// Tasks page: cross-class view of all assignments. Pending first
// (not_started + in_progress), sorted by due date ascending; done
// rows hidden by default.
export default async function TasksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const rows = await db
    .select({
      id: assignments.id,
      title: assignments.title,
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
        eq(assignments.userId, userId),
        isNull(assignments.deletedAt),
        sql`${assignments.status} != 'done'`
      )
    )
    .orderBy(
      // NULL dueAt last (`asc nulls last` is Postgres-specific via sql).
      sql`${assignments.dueAt} ASC NULLS LAST`,
      asc(assignments.createdAt)
    );

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-6">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">Tasks</h1>
        <div className="mt-8">
          <EmptyState
            icon={<ListChecks size={18} strokeWidth={1.5} />}
            title="No tasks pending."
            description="Add an assignment to a class, and it'll show up here. The agent surfaces deadline-during-travel and workload spikes proactively."
            actions={[{ label: "Browse classes", href: "/app/classes" }]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">Tasks</h1>
        <span className="text-small text-[hsl(var(--muted-foreground))]">
          {rows.length} pending
        </span>
      </div>

      <section className="mt-6">
        <DenseList ariaLabel="Pending tasks">
          {rows.map((r) => (
            <DenseRowLink
              key={r.id}
              href={
                r.classId
                  ? `/app/classes/${r.classId}?tab=assignments`
                  : "/app/classes"
              }
              leadingDot={r.classColor ?? null}
              title={r.title}
              secondary={r.classCode ?? r.className ?? null}
              metadata={buildMetadata({
                dueAt: r.dueAt,
                status: r.status,
                priority: r.priority,
              })}
            />
          ))}
        </DenseList>
      </section>
    </div>
  );
}

function buildMetadata(args: {
  dueAt: Date | null;
  status: AssignmentStatus;
  priority: "low" | "medium" | "high" | null;
}): string[] {
  const parts: string[] = [];
  if (args.dueAt) {
    parts.push(formatDueAt(args.dueAt));
  } else {
    parts.push("No due date");
  }
  if (args.status === "in_progress") {
    parts.push("in progress");
  }
  if (args.priority === "high") {
    parts.push("high priority");
  }
  return parts;
}

function formatDueAt(d: Date): string {
  const now = new Date();
  const diffDays = Math.round(
    (d.getTime() - now.getTime()) / (24 * 3600 * 1000)
  );
  if (diffDays < 0) {
    return `Overdue ${-diffDays}d`;
  }
  if (diffDays === 0) {
    return "Due today";
  }
  if (diffDays === 1) {
    return "Due tomorrow";
  }
  if (diffDays < 7) {
    return `Due in ${diffDays}d`;
  }
  return `Due ${d.getMonth() + 1}/${d.getDate()}`;
}
