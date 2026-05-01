import { auth } from "@/lib/auth/config";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("tasks");

  const [steadiiRes, googleRes, msRes] = await Promise.all([
    safelyFetchSteadii(userId, t),
    safelyFetchGoogleTasks(userId, t),
    safelyFetchMsTasks(userId, t),
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
      <div className="mx-auto max-w-3xl py-2 md:py-6">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>
        <div className="mt-8">
          <EmptyState
            icon={<ListChecks size={18} strokeWidth={1.5} />}
            title={t("empty_title")}
            description={t("empty_description")}
            actions={[{ label: t("empty_browse_classes"), href: "/app/classes" }]}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl py-2 md:py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[hsl(var(--foreground))]">{t("title")}</h1>
        <span className="text-small text-[hsl(var(--muted-foreground))]">
          {t("pending_count", { count: rows.length })}
        </span>
      </div>

      <section className="mt-6">
        <DenseList ariaLabel={t("aria_pending_tasks")}>
          {rows.map((r) =>
            r.href ? (
              <DenseRowLink
                key={r.key}
                href={r.href}
                leadingDot={r.leadingDot}
                title={r.title}
                secondary={r.secondary}
                metadata={r.metadata}
                rightContent={<SourceBadge source={r.source} t={t} />}
              />
            ) : (
              <DenseRow
                key={r.key}
                leadingDot={r.leadingDot}
                title={r.title}
                secondary={r.secondary}
                metadata={r.metadata}
                rightContent={<SourceBadge source={r.source} t={t} />}
              />
            )
          )}
        </DenseList>
      </section>
    </div>
  );
}

function SourceBadge({
  source,
  t,
}: {
  source: Source;
  t: (key: string) => string;
}) {
  const label =
    source === "steadii"
      ? t("source_steadii")
      : source === "google_tasks"
        ? t("source_google")
        : t("source_microsoft");
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
        "px-1.5 py-0.5 text-small text-[hsl(var(--muted-foreground))]"
      )}
    >
      {label}
    </span>
  );
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;

async function safelyFetchSteadii(
  userId: string,
  t: Translator
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
      metadata: buildSteadiiMetadata(
        {
          dueAt: r.dueAt,
          status: r.status,
          priority: r.priority,
        },
        t
      ),
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
  userId: string,
  t: Translator
): Promise<AdapterResult<UnifiedRow>> {
  try {
    const tasks = await fetchUpcomingTasks(userId, { days: 30, max: 50 });
    return {
      ok: true,
      items: tasks.map((task, i) => projectExternalTask(task, "google_tasks", i, t)),
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
  userId: string,
  t: Translator
): Promise<AdapterResult<UnifiedRow>> {
  try {
    const tasks = await fetchMsUpcomingTasks(userId, { days: 30, max: 50 });
    return {
      ok: true,
      items: tasks.map((task, i) =>
        projectExternalTask(task, "microsoft_todo", i, t)
      ),
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
  task: DraftCalendarTask,
  source: Exclude<Source, "steadii">,
  index: number,
  t: Translator
): UnifiedRow {
  // YYYY-MM-DD parsed as local-midnight so sort comparisons line up
  // with Steadii's local-tz `dueAt` Dates.
  const [y, m, d] = task.due.split("-").map(Number);
  const dueAt =
    Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)
      ? new Date(y, m - 1, d)
      : null;
  return {
    key: `${source}:${task.due}:${index}:${task.title}`,
    source,
    title: task.title,
    dueAt,
    // External tasks are read-only here; clicking through to the
    // source app would need per-provider deep-links we don't track.
    href: null,
    secondary: null,
    metadata: dueAt ? [formatDueAt(dueAt, t)] : [task.due],
    leadingDot: null,
  };
}

function compareByDue(a: UnifiedRow, b: UnifiedRow): number {
  if (a.dueAt && b.dueAt) return a.dueAt.getTime() - b.dueAt.getTime();
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return a.title.localeCompare(b.title);
}

function buildSteadiiMetadata(
  args: {
    dueAt: Date | null;
    status: AssignmentStatus;
    priority: "low" | "medium" | "high" | null;
  },
  t: Translator
): string[] {
  const parts: string[] = [];
  parts.push(args.dueAt ? formatDueAt(args.dueAt, t) : t("no_due_date"));
  if (args.status === "in_progress") parts.push(t("in_progress"));
  if (args.priority === "high") parts.push(t("high_priority"));
  return parts;
}

function formatDueAt(d: Date, t: Translator): string {
  const now = new Date();
  const diffDays = Math.round(
    (d.getTime() - now.getTime()) / (24 * 3600 * 1000)
  );
  if (diffDays < 0) return t("overdue_days", { n: -diffDays });
  if (diffDays === 0) return t("due_today");
  if (diffDays === 1) return t("due_tomorrow");
  if (diffDays < 7) return t("due_in_days", { n: diffDays });
  return t("due_short_date", { date: `${d.getMonth() + 1}/${d.getDate()}` });
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
