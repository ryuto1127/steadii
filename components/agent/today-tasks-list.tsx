"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import {
  completeAssignmentAction,
  completeTaskAction,
} from "@/lib/agent/tasks-actions";
import type { TodayTask } from "@/app/app/page";

// Engineer-37 — home one-click complete on the today-tasks pane.
//
// The pane wrapper is a Link that navigates to /app/tasks. This list
// renders inside it and uses event-bubble suppression on the checkbox
// so a click marks the task done WITHOUT triggering navigation. The
// optimistic state strikes through and dims the row immediately; the
// server action revalidates / and /app/tasks so subsequent navigation
// drops the row.
export function TodayTasksList({
  tasks,
  cap = 5,
  todayStr,
  tomorrowStr,
}: {
  tasks: TodayTask[];
  cap?: number;
  todayStr: string;
  tomorrowStr: string;
}) {
  const t = useTranslations("home_v2");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  if (tasks.length === 0) {
    return (
      <p className="text-[12px] italic text-[hsl(var(--muted-foreground))]">
        {t("today_no_tasks")}
      </p>
    );
  }

  const visible = tasks.slice(0, cap);
  const overflow = Math.max(0, tasks.length - cap);

  // Group when at least two distinct due-day buckets are visible. Steadii
  // rows with no due date sort under "Today" — they're the ones the
  // assignments table doesn't know when to surface, and the user is on
  // the today briefing right now.
  const grouped = groupByDay(visible, todayStr, tomorrowStr);
  const showGroups = grouped.length > 1;

  function rowKey(task: TodayTask): string {
    return task.kind === "steadii"
      ? `steadii:${task.id}`
      : `${task.kind}:${task.taskId}`;
  }

  function handleComplete(task: TodayTask) {
    const key = rowKey(task);
    if (pendingIds.has(key) || doneIds.has(key)) return;
    setPendingIds((s) => new Set(s).add(key));
    startTransition(async () => {
      try {
        if (task.kind === "steadii") {
          await completeAssignmentAction({ assignmentId: task.id });
        } else {
          await completeTaskAction({
            taskId: task.taskId,
            taskListId: task.taskListId,
            completed: true,
          });
        }
        setDoneIds((s) => new Set(s).add(key));
      } catch (err) {
        toast.error(t("task_complete_failed"));
        console.error("[today-tasks] complete failed", err);
      } finally {
        setPendingIds((s) => {
          const next = new Set(s);
          next.delete(key);
          return next;
        });
      }
    });
  }

  const todayLabel = t("day_today");
  const tomorrowLabel = t("day_tomorrow");

  return (
    <ul className="flex flex-col gap-1">
      {grouped.map((group) => (
        <GroupSection
          key={group.label}
          showHeading={showGroups}
          headingLabel={dayHeading(
            group.label,
            todayStr,
            tomorrowStr,
            todayLabel,
            tomorrowLabel,
          )}
        >
          {group.tasks.map((task) => {
            const key = rowKey(task);
            const isPending = pendingIds.has(key);
            const isDone = doneIds.has(key);
            return (
              <TaskRow
                key={key}
                task={task}
                onComplete={() => handleComplete(task)}
                isPending={isPending}
                isDone={isDone}
                ariaLabel={t("task_complete_aria", {
                  title: task.title,
                })}
              />
            );
          })}
        </GroupSection>
      ))}
      {overflow > 0 ? (
        <li className="pt-1 text-[11px] text-[hsl(var(--muted-foreground))]">
          {t("more_this_week", { n: overflow })}
        </li>
      ) : null}
    </ul>
  );
}

type DayGroup = {
  label: string;
  tasks: TodayTask[];
};

function groupByDay(
  tasks: TodayTask[],
  todayStr: string,
  tomorrowStr: string,
): DayGroup[] {
  const buckets = new Map<string, TodayTask[]>();
  for (const task of tasks) {
    const due = task.kind === "steadii" ? task.due ?? todayStr : task.due;
    // Bucket "overdue → today" together — the user already lost the
    // "today vs yesterday" distinction by the time they're staring at
    // the home briefing in the morning.
    const bucketKey = due <= todayStr ? todayStr : due;
    const list = buckets.get(bucketKey) ?? [];
    list.push(task);
    buckets.set(bucketKey, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, ts]) => ({
      label: key,
      tasks: ts,
    }));
}

function GroupSection({
  showHeading,
  headingLabel,
  children,
}: {
  showHeading: boolean;
  headingLabel: string;
  children: React.ReactNode;
}) {
  if (!showHeading) return <>{children}</>;
  return (
    <>
      <li
        className="pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[hsl(var(--muted-foreground))]"
        aria-hidden
      >
        {headingLabel}
      </li>
      {children}
    </>
  );
}

function dayHeading(
  dueStr: string,
  todayStr: string,
  tomorrowStr: string,
  todayLabel: string,
  tomorrowLabel: string,
): string {
  if (dueStr === todayStr) return todayLabel;
  if (dueStr === tomorrowStr) return tomorrowLabel;
  return formatDayLabel(dueStr);
}

function TaskRow({
  task,
  onComplete,
  isPending,
  isDone,
  ariaLabel,
}: {
  task: TodayTask;
  onComplete: () => void;
  isPending: boolean;
  isDone: boolean;
  ariaLabel: string;
}) {
  const secondary =
    task.kind === "steadii" ? task.classTitle ?? undefined : undefined;
  return (
    <li className="flex items-baseline justify-between gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            // Stop the click from bubbling up to the pane Link wrapper —
            // checkbox interactions must NOT trigger page navigation.
            e.preventDefault();
            e.stopPropagation();
            onComplete();
          }}
          aria-label={ariaLabel}
          aria-checked={isDone}
          role="checkbox"
          disabled={isPending || isDone}
          className={cn(
            "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-default",
            isDone
              ? "border-[hsl(var(--accent))] bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))]"
              : "border-[hsl(var(--border))] hover:border-[hsl(var(--accent))] hover:bg-[hsl(var(--accent)/0.08)]",
            isPending && "opacity-50",
          )}
        >
          {isDone ? <Check size={10} strokeWidth={2.5} /> : null}
        </button>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-[13px]",
            isDone
              ? "text-[hsl(var(--muted-foreground))] line-through"
              : "text-[hsl(var(--foreground))]",
          )}
        >
          {task.title}
        </span>
      </div>
      {secondary ? (
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-[hsl(var(--muted-foreground))]">
          {secondary}
        </span>
      ) : null}
    </li>
  );
}

// "2026-05-08" → "5/8 (金)" — minimal, no extra deps. Today/tomorrow
// labels are localized; other days fall back to short numeric form.
function formatDayLabel(dueStr: string): string {
  // Use explicit parsing; new Date("YYYY-MM-DD") parses as UTC and can
  // shift to the previous day in negative-UTC zones.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueStr);
  if (!m) return dueStr;
  const month = Number(m[2]);
  const day = Number(m[3]);
  return `${month}/${day}`;
}
