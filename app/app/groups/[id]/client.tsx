"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  Archive,
  CheckCircle2,
  Mail,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  archiveGroupAction,
  draftCheckInAction,
  addGroupTaskAction,
  toggleGroupTaskDoneAction,
  removeGroupTaskAction,
} from "./actions";

type Member = {
  email: string;
  name: string | null;
  role: string | null;
  status: "active" | "silent" | "done";
  lastMessageAt: string | null;
  lastRespondedAt: string | null;
};

type Task = {
  id: string;
  title: string;
  assigneeEmail: string | null;
  due: string | null;
  doneAt: string | null;
};

export function GroupDetailClient({
  userId,
  groupId,
  groupTitle,
  className,
  members,
  tasks,
  sourceThreadIds,
}: {
  userId: string;
  groupId: string;
  groupTitle: string;
  className: string | null;
  members: Member[];
  tasks: Task[];
  sourceThreadIds: string[];
}) {
  const t = useTranslations("group_detail");
  const [pending, startTransition] = useTransition();
  const [drafts, setDrafts] = useState<
    Record<string, { subject: string; body: string }>
  >({});
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState("");

  void userId;

  const onDraftCheckIn = (member: Member) => {
    startTransition(async () => {
      try {
        const res = await draftCheckInAction(groupId, member.email);
        setDrafts((prev) => ({
          ...prev,
          [member.email]: { subject: res.subject, body: res.body },
        }));
        toast.success(t("toast_drafted"));
      } catch (err) {
        toast.error(message(err, t("toast_draft_failed")));
      }
    });
  };

  const onArchive = () => {
    if (!window.confirm(t("confirm_archive"))) return;
    startTransition(async () => {
      try {
        await archiveGroupAction(groupId);
        toast.success(t("toast_archived"));
      } catch (err) {
        toast.error(message(err, t("toast_archive_failed")));
      }
    });
  };

  const onAddTask = () => {
    if (!newTaskTitle.trim()) return;
    startTransition(async () => {
      try {
        await addGroupTaskAction(groupId, {
          title: newTaskTitle,
          assigneeEmail: newTaskAssignee || null,
        });
        setNewTaskTitle("");
        setNewTaskAssignee("");
        toast.success(t("toast_task_added"));
      } catch (err) {
        toast.error(message(err, t("toast_task_failed")));
      }
    });
  };

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))]">
              {t("members_heading")}{" "}
              <span className="text-[hsl(var(--muted-foreground))]">
                ({members.length})
              </span>
            </h2>
            {className ? (
              <p className="text-[12px] text-[hsl(var(--muted-foreground))]">
                {className}
              </p>
            ) : null}
          </div>
        </div>
        <ul className="flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.email}
              className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-[14px] font-medium text-[hsl(var(--foreground))]">
                      {m.name ?? m.email}
                    </p>
                    <StatusPill status={m.status} />
                  </div>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                    {m.email}
                  </p>
                  {m.lastRespondedAt ? (
                    <p className="mt-0.5 text-[11px] text-[hsl(var(--muted-foreground))]">
                      {t("last_reply_label")}{" "}
                      {new Date(m.lastRespondedAt).toLocaleDateString()}
                    </p>
                  ) : null}
                </div>
                {m.status === "silent" ? (
                  <button
                    type="button"
                    onClick={() => onDraftCheckIn(m)}
                    disabled={pending}
                    className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
                  >
                    <Sparkles size={11} strokeWidth={2} />
                    <span>{t("draft_checkin")}</span>
                  </button>
                ) : null}
              </div>
              {drafts[m.email] ? (
                <div className="mt-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3">
                  <p className="mb-1 text-[12px] font-medium text-[hsl(var(--foreground))]">
                    {drafts[m.email].subject}
                  </p>
                  <p className="whitespace-pre-wrap text-[12px] leading-snug text-[hsl(var(--muted-foreground))]">
                    {drafts[m.email].body}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <a
                      href={`mailto:${m.email}?subject=${encodeURIComponent(drafts[m.email].subject)}&body=${encodeURIComponent(drafts[m.email].body)}`}
                      className="inline-flex h-7 items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 text-[11px] font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface))]"
                    >
                      <Mail size={11} strokeWidth={2} />
                      <span>{t("open_in_mail")}</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => onDraftCheckIn(m)}
                      disabled={pending}
                      className="inline-flex h-7 items-center gap-1 rounded-full px-3 text-[11px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
                    >
                      <RefreshCw size={11} strokeWidth={1.75} />
                      <span>{t("regenerate")}</span>
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))]">
          {t("tasks_heading")}{" "}
          <span className="text-[hsl(var(--muted-foreground))]">
            ({tasks.length})
          </span>
        </h2>
        <ul className="flex flex-col gap-1.5">
          {tasks.length === 0 ? (
            <li className="rounded-lg border border-dashed border-[hsl(var(--border))] px-3 py-2 text-[12px] italic text-[hsl(var(--muted-foreground))]">
              {t("tasks_empty")}
            </li>
          ) : null}
          {tasks.map((task) => (
            <li
              key={task.id}
              className="flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-2 text-[12px] text-[hsl(var(--foreground))]"
            >
              <button
                type="button"
                aria-label={
                  task.doneAt ? t("aria_mark_undone") : t("aria_mark_done")
                }
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await toggleGroupTaskDoneAction(task.id, !task.doneAt);
                    } catch (err) {
                      toast.error(message(err, "Failed"));
                    }
                  })
                }
                disabled={pending}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  task.doneAt
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--surface))]"
                    : "border-[hsl(var(--border))]"
                }`}
              >
                {task.doneAt ? <CheckCircle2 size={12} /> : null}
              </button>
              <span
                className={
                  task.doneAt
                    ? "text-[hsl(var(--muted-foreground))] line-through"
                    : ""
                }
              >
                {task.title}
              </span>
              {task.assigneeEmail ? (
                <span className="ml-2 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                  → {task.assigneeEmail.split("@")[0]}
                </span>
              ) : null}
              {task.due ? (
                <span className="ml-auto font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
                  {new Date(task.due).toLocaleDateString()}
                </span>
              ) : null}
              <button
                type="button"
                aria-label={t("aria_remove_task")}
                onClick={() =>
                  startTransition(async () => {
                    try {
                      await removeGroupTaskAction(task.id);
                    } catch (err) {
                      toast.error(message(err, "Failed"));
                    }
                  })
                }
                disabled={pending}
                className="ml-1 inline-flex h-5 w-5 items-center justify-center text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))]"
              >
                <X size={11} strokeWidth={1.75} />
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            placeholder={t("task_title_placeholder")}
            className="h-9 flex-1 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[12px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
          />
          <input
            value={newTaskAssignee}
            onChange={(e) => setNewTaskAssignee(e.target.value)}
            placeholder={t("task_assignee_placeholder")}
            className="h-9 w-44 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-[12px] text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
          />
          <button
            type="button"
            onClick={onAddTask}
            disabled={pending || !newTaskTitle.trim()}
            className="inline-flex h-9 items-center gap-1 rounded-full bg-[hsl(var(--foreground))] px-3 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={12} strokeWidth={2} />
            <span>{t("add_task")}</span>
          </button>
        </div>
      </section>

      {sourceThreadIds.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-[16px] font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))]">
            {t("source_threads_heading")}
          </h2>
          <ul className="flex flex-wrap gap-1.5">
            {sourceThreadIds.map((id) => (
              <li
                key={id}
                className="inline-flex items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2.5 py-0.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))]"
              >
                {id.slice(0, 16)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <button
          type="button"
          onClick={onArchive}
          disabled={pending}
          className="inline-flex h-9 items-center gap-1 rounded-full border border-[hsl(var(--border))] px-3 text-[12px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--destructive))] disabled:opacity-50"
        >
          <Archive size={11} strokeWidth={1.75} />
          <span>{t("archive_group")}</span>
        </button>
      </section>
    </>
  );
}

function StatusPill({ status }: { status: Member["status"] }) {
  const t = useTranslations("group_detail.status");
  const tone = (() => {
    switch (status) {
      case "active":
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
      case "silent":
        return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
      case "done":
        return "border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]";
    }
  })();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}
    >
      {t(status)}
    </span>
  );
}

function message(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
