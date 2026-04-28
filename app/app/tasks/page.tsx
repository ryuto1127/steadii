import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assignments,
  classes,
  type AssignmentStatus,
} from "@/lib/db/schema";
import {
  fetchUpcomingTasks,
  type DraftCalendarTask,
} from "@/lib/integrations/google/tasks";
import { fetchMsUpcomingTasks } from "@/lib/integrations/microsoft/tasks";
import { DenseList } from "@/components/ui/dense-list";
import { DenseRow } from "@/components/ui/dense-row";
import { DenseRowLink } from "@/components/ui/dense-row-link";
import { EmptyState } from "@/components/ui/empty-state";
import { ListChecks } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const dynamic = "force-dynamic";

type Source = "steadii" | "google_tasks" | "microsoft_todo";

type AdapterResult<T> = { ok: true; items: T[] } | { ok: false; error: string };

type UnifiedRow = {
  key: string;
  source: Source;
  title: string;
  // Used for sorting; null sorts last.
  dueAt: Date | null;
  href: string | null;
  secondary: string | null;
  metadata: string[];
  leadingDot: string | null;
};

// Tasks page: cross-source view of pending work — Steadii assignments,
// Google Tasks (live), and Microsoft To Do (live, when connected).
// Each external source is fetched independently; failures soft-fail to
// an empty list so a single broken provider doesn't blank the page.
// Mirrors the bySource pattern in app/calendar/page.tsx.
export default async function TasksPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const userId = session.user.id;

  const [steadiiRes, googleRes, msRes] = await Promise.all([
    safelyFetchSteadii(userId),
    safelyFetchGoogleTasks(userId),
    safelyFetchMsTasks(userId),
  ]);

  const bySource: Record<Source, AdapterResult<UnifiedRow>> = {
    steadii: steadiiRes,
    google_tasks: googleRes,
    microsoft_todo: msRes,
  };

  const rows: UnifiedRow[] = [];
  for (const r of Object.values(bySource)) {
    if (r.ok) rows.push(...r.items);
  }
  rows.sort(compareByDue);

  if (rows.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-6">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">Tasks</h1>
        <div className="mt-8">
          <EmptyState
            icon={<ListChecks size={18} strokeWidth={1.5} />}
            title="No tasks pending."
            description="Add an assignment to a class, or connect Google Tasks / Microsoft To Do, and they'll show up here. The agent surfaces deadline-during-travel and workload spikes proactively."
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
          {rows.map((r) =>
            r.href ? (
              <DenseRowLink
                key={r.key}
                href={r.href}
                leadingDot={r.leadingDot}
                title={r.title}
                secondary={r.secondary}
                metadata={r.metadata}
                rightContent={<SourceBadge source={r.source} />}
              />
            ) : (
              <DenseRow
                key={r.key}
                leadingDot={r.leadingDot}
                title={r.title}
                secondary={r.secondary}
                metadata={r.metadata}
                rightContent={<SourceBadge source={r.source} />}
              />
            )
          )}
        </DenseList>
      </section>
    </div>
  );
}

const SOURCE_LABELS: Record<Source, string> = {
  steadii: "Steadii",
  google_tasks: "Google",
  microsoft_todo: "Microsoft",
};

function SourceBadge({ source }: { source: Source }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
        "px-1.5 py-0.5 text-small text-[hsl(var(--muted-foreground))]"
      )}
    >
      {SOURCE_LABELS[source]}
    </span>
  );
}

async function safelyFetchSteadii(
  userId: string
): Promise<AdapterResult<UnifiedRow>> {
  try {
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
        sql`${assignments.dueAt} ASC NULLS LAST`,
        asc(assignments.createdAt)
      );

    const items: UnifiedRow[] = rows.map((r) => ({
      key: `steadii:${r.id}`,
      source: "steadii",
      title: r.title,
      dueAt: r.dueAt,
      href: r.classId
        ? `/app/classes/${r.classId}?tab=assignments`
        : "/app/classes",
      secondary: r.classCode ?? r.className ?? null,
      metadata: buildSteadiiMetadata({
        dueAt: r.dueAt,
        status: r.status,
        priority: r.priority,
      }),
      leadingDot: r.classColor ?? null,
    }));
    return { ok: true, items };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "tasks_page", source: "steadii" },
      user: { id: userId },
    });
    return { ok: false, error: errMsg(err) };
  }
}

async function safelyFetchGoogleTasks(
  userId: string
): Promise<AdapterResult<UnifiedRow>> {
  try {
    const tasks = await fetchUpcomingTasks(userId, { days: 30, max: 50 });
    return {
      ok: true,
      items: tasks.map((t, i) => projectExternalTask(t, "google_tasks", i)),
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "tasks_page", source: "google_tasks" },
      user: { id: userId },
    });
    return { ok: false, error: errMsg(err) };
  }
}

async function safelyFetchMsTasks(
  userId: string
): Promise<AdapterResult<UnifiedRow>> {
  try {
    const tasks = await fetchMsUpcomingTasks(userId, { days: 30, max: 50 });
    return {
      ok: true,
      items: tasks.map((t, i) => projectExternalTask(t, "microsoft_todo", i)),
    };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "tasks_page", source: "microsoft_todo" },
      user: { id: userId },
    });
    return { ok: false, error: errMsg(err) };
  }
}

function projectExternalTask(
  t: DraftCalendarTask,
  source: Exclude<Source, "steadii">,
  index: number
): UnifiedRow {
  // YYYY-MM-DD parsed as local-midnight so sort comparisons line up
  // with Steadii's local-tz `dueAt` Dates.
  const [y, m, d] = t.due.split("-").map(Number);
  const dueAt =
    Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
      ? new Date(y, m - 1, d)
      : null;
  return {
    key: `${source}:${t.due}:${index}:${t.title}`,
    source,
    title: t.title,
    dueAt,
    // External tasks are read-only here; clicking through to the
    // source app would need per-provider deep-links we don't track.
    href: null,
    secondary: null,
    metadata: dueAt ? [formatDueAt(dueAt)] : [t.due],
    leadingDot: null,
  };
}

function compareByDue(a: UnifiedRow, b: UnifiedRow): number {
  if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.title.localeCompare(b.title);
}

function buildSteadiiMetadata(args: {
  dueAt: Date | null;
  status: AssignmentStatus;
  priority: "low" | "medium" | "high" | null;
}): string[] {
  const parts: string[] = [];
  parts.push(args.dueAt ? formatDueAt(args.dueAt) : "No due date");
  if (args.status === "in_progress") parts.push("in progress");
  if (args.priority === "high") parts.push("high priority");
  return parts;
}

function formatDueAt(d: Date): string {
  const now = new Date();
  const diffDays = Math.round(
    (d.getTime() - now.getTime()) / (24 * 3600 * 1000)
  );
  if (diffDays < 0) return `Overdue ${-diffDays}d`;
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays < 7) return `Due in ${diffDays}d`;
  return `Due ${d.getMonth() + 1}/${d.getDate()}`;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
