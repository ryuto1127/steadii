"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

// Inline create-task form on /app/tasks. Reuses the agent-tool-backed
// `createTaskAction` (Steadii native + Google Tasks + MS To Do
// write-through, per `lib/agent/tools/tasks.ts:tasks_create`). Collapsed
// = single "+ New task" button; expanded = title (required) + due date +
// notes form. Submit calls the action, closes the form, shows a toast,
// and triggers `router.refresh()` so the new row drops into the list
// (the action also calls revalidatePath on the calendar surface; we
// refresh the tasks page from the client to cover the rest).
export function CreateTaskForm({
  action,
}: {
  action: (input: {
    title: string;
    notes?: string;
    due?: string;
  }) => Promise<{ taskId: string; taskListId: string }>;
}) {
  const t = useTranslations("tasks.create");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const reset = () => {
    setTitle("");
    setDue("");
    setNotes("");
  };

  const close = () => {
    if (pending) return;
    setOpen(false);
    reset();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    startTransition(async () => {
      try {
        await action({
          title: trimmed,
          due: due || undefined,
          notes: notes.trim() || undefined,
        });
        toast.success(t("toast_created"));
        setOpen(false);
        reset();
        router.refresh();
      } catch (err) {
        const message = err instanceof Error ? err.message : t("toast_failed");
        toast.error(message);
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-small font-medium text-[hsl(var(--foreground))] transition-default hover:bg-[hsl(var(--surface-raised))]"
      >
        <Plus size={14} strokeWidth={1.75} />
        <span>{t("open_button")}</span>
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-3 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-small font-semibold text-[hsl(var(--foreground))]">
          {t("form_title")}
        </h2>
        <button
          type="button"
          onClick={close}
          disabled={pending}
          aria-label={t("cancel")}
          className="rounded-full p-1 text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))] disabled:opacity-50"
        >
          <X size={14} strokeWidth={1.75} />
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[hsl(var(--muted-foreground))]">
          {t("field_title")}
        </span>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          autoFocus
          maxLength={500}
          placeholder={t("field_title_placeholder")}
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[hsl(var(--muted-foreground))]">
          {t("field_due")}
        </span>
        <input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-medium text-[hsl(var(--muted-foreground))]">
          {t("field_notes")}
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={t("field_notes_placeholder")}
          className="resize-none rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-small text-[hsl(var(--foreground))] focus:border-[hsl(var(--primary))] focus:outline-none"
        />
      </label>

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={close}
          disabled={pending}
          className="rounded-full px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))] disabled:opacity-50"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={pending || title.trim().length === 0}
          className="inline-flex h-9 items-center rounded-full bg-[hsl(var(--foreground))] px-4 text-small font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90 disabled:opacity-50"
        >
          {pending ? t("submitting") : t("submit")}
        </button>
      </div>
    </form>
  );
}
