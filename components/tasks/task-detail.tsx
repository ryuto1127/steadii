"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Calendar, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import {
  completeAssignmentAction,
  completeTaskAction,
} from "@/lib/agent/tasks-actions";
import type {
  AssignmentPriority,
  AssignmentStatus,
} from "@/lib/db/schema";

// 2026-05-21 — Task detail surface. Renders the unified view across
// Steadii / Google / Microsoft sources. The Done button routes to the
// right server action based on source; Steadii also surfaces the
// owning class as a chip-style link.

export type TaskDetailSteadii = {
  source: "steadii";
  id: string;
  title: string;
  notes: string | null;
  dueAt: Date | null;
  status: AssignmentStatus;
  priority: AssignmentPriority | null;
  classId: string | null;
  className: string | null;
  classCode: string | null;
  classColor: string | null;
};

export type TaskDetailExternal = {
  source: "google_tasks" | "microsoft_todo";
  taskId: string;
  taskListId: string;
  title: string;
  notes: string | null;
  due: string; // YYYY-MM-DD
  completed: boolean;
};

export type TaskDetailData = TaskDetailSteadii | TaskDetailExternal;

export function TaskDetail({ task, tz }: { task: TaskDetailData; tz: string }) {
  const t = useTranslations("tasks");
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const isSteadii = task.source === "steadii";
  const isDone = isSteadii ? task.status === "done" : task.completed;

  const dueLabel = formatDue(task, tz);
  const sourceLabel =
    task.source === "steadii"
      ? t("source_steadii")
      : task.source === "google_tasks"
        ? t("source_google")
        : t("source_microsoft");

  const handleDone = () => {
    if (pending || isDone) return;
    startTransition(async () => {
      try {
        if (task.source === "steadii") {
          await completeAssignmentAction({ assignmentId: task.id });
        } else {
          await completeTaskAction({
            taskId: task.taskId,
            taskListId: task.taskListId,
            completed: true,
          });
        }
        toast.success(t("detail.done_toast"));
        router.push("/app/tasks");
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Save failed";
        toast.error(msg);
      }
    });
  };

  const externalDeepLink =
    task.source === "google_tasks"
      ? "https://tasks.google.com"
      : task.source === "microsoft_todo"
        ? "https://to-do.live.com/tasks"
        : null;

  return (
    <div className="mx-auto max-w-3xl py-2 md:py-6">
      <nav className="mb-4">
        <Link
          href="/app/tasks"
          className="inline-flex items-center gap-1.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          <span>{t("detail.back")}</span>
        </Link>
      </nav>

      <article
        className={cn(
          "rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-5 md:p-6",
          isDone && "opacity-60",
        )}
      >
        <header className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-h1 text-[hsl(var(--foreground))]">
              {task.title}
            </h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-small text-[hsl(var(--muted-foreground))]">
              <span
                className={cn(
                  "inline-flex items-center rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
                  "px-1.5 py-0.5",
                )}
              >
                {sourceLabel}
              </span>
              {isSteadii && task.classId ? (
                <Link
                  href={`/app/classes/${task.classId}?tab=assignments`}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
                    "px-1.5 py-0.5 transition-hover hover:border-[hsl(var(--primary)/0.5)]",
                  )}
                >
                  {task.classColor ? (
                    <span
                      aria-hidden
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: task.classColor }}
                    />
                  ) : null}
                  <span>{task.classCode ?? task.className}</span>
                </Link>
              ) : null}
              {isSteadii && task.priority ? (
                <span
                  className={cn(
                    "inline-flex items-center rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
                    "px-1.5 py-0.5",
                  )}
                >
                  {t(`priority.${task.priority}`)}
                </span>
              ) : null}
            </div>
          </div>
        </header>

        <div className="mt-5 flex items-center gap-2 text-body text-[hsl(var(--foreground))]">
          <Calendar size={16} strokeWidth={1.75} />
          <span>{dueLabel}</span>
        </div>

        {task.notes ? (
          <div className="mt-5">
            <h2 className="text-small font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
              {t("detail.notes")}
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-body text-[hsl(var(--foreground))]">
              {task.notes}
            </p>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDone}
            disabled={pending || isDone}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-small font-medium transition-default",
              "bg-[hsl(var(--foreground))] text-[hsl(var(--surface))]",
              "hover:opacity-90 disabled:opacity-50",
            )}
          >
            <Check size={14} strokeWidth={2} />
            <span>
              {isDone ? t("detail.done_label") : t("detail.mark_done")}
            </span>
          </button>
          {externalDeepLink ? (
            <a
              href={externalDeepLink}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "inline-flex h-9 items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-4 text-small font-medium transition-hover",
                "text-[hsl(var(--foreground))] hover:border-[hsl(var(--primary)/0.5)]",
              )}
            >
              <ExternalLink size={14} strokeWidth={1.75} />
              <span>
                {task.source === "google_tasks"
                  ? t("detail.open_in_google")
                  : t("detail.open_in_microsoft")}
              </span>
            </a>
          ) : null}
        </div>
      </article>
    </div>
  );
}

function formatDue(task: TaskDetailData, tz: string): string {
  if (task.source === "steadii") {
    if (!task.dueAt) return "(期限なし)";
    const fmt = new Intl.DateTimeFormat("ja-JP", {
      timeZone: tz,
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    return fmt.format(task.dueAt);
  }
  // External task: due is "YYYY-MM-DD" (date-only). Format without time.
  const [y, m, d] = task.due.split("-").map((s) => parseInt(s, 10));
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const fmt = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "UTC", // wall-clock probe, not user TZ
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
  return fmt.format(probe);
}
