"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type {
  AssignmentPriority,
  AssignmentStatus,
} from "@/lib/db/schema";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type AssignmentInitial = {
  id: string;
  title: string;
  dueAt: string | null;
  status: AssignmentStatus;
  priority: AssignmentPriority | null;
  notes: string | null;
};

const STATUSES: AssignmentStatus[] = ["not_started", "in_progress", "done"];
const PRIORITIES: AssignmentPriority[] = ["low", "medium", "high"];

function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in vars ? String(vars[k]) : `{${k}}`
  );
}

function toLocalDateTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // Convert to a value compatible with <input type="datetime-local">: drop
  // seconds / timezone, keep local-time interpretation.
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalDateTime(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function AssignmentRow({ initial }: { initial: AssignmentInitial }) {
  const tActions = useTranslations("classes.actions");
  const tA = useTranslations("classes.assignments");
  const locale = useLocale();
  const dateLocale = locale === "ja" ? "ja-JP" : "en-US";
  const router = useRouter();

  const formatDueShort = (iso: string | null): string => {
    if (!iso) return tA("no_due");
    try {
      return fmt(tA("due_short"), {
        date: new Date(iso).toLocaleDateString(dateLocale),
      });
    } catch {
      return iso;
    }
  };

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState(initial.title);
  const [dueLocal, setDueLocal] = useState(toLocalDateTime(initial.dueAt));
  const [status, setStatus] = useState<AssignmentStatus>(initial.status);
  const [priority, setPriority] = useState<AssignmentPriority | "">(
    initial.priority ?? ""
  );
  const [notes, setNotes] = useState(initial.notes ?? "");

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/assignments/${initial.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || initial.title,
          dueAt: fromLocalDateTime(dueLocal),
          status,
          priority: priority || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tA("saved_toast"));
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tA("save_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/assignments/${initial.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tA("deleted_toast"));
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tA("delete_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="listitem"
      className="group flex min-h-[36px] items-center gap-3 border-b border-[hsl(var(--border))] px-1 py-1.5 last:border-b-0"
    >
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="flex flex-1 items-center gap-3 text-left transition-hover hover:opacity-90"
      >
        <span className="flex-1 truncate text-body text-[hsl(var(--foreground))]">
          {initial.title}
        </span>
        {initial.status !== "not_started" ? (
          <span className="text-small text-[hsl(var(--muted-foreground))]">
            {tA(`status_${initial.status}` as const)}
          </span>
        ) : null}
        <span className="text-small text-[hsl(var(--muted-foreground))]">
          {formatDueShort(initial.dueAt)}
        </span>
        {initial.priority ? (
          <span className="text-small text-[hsl(var(--muted-foreground))]">
            {fmt(tA("priority_inline"), {
              value: tA(`priority_${initial.priority}` as const),
            })}
          </span>
        ) : null}
      </button>
      <KebabMenu
        ariaLabel={tActions("menu_label")}
        items={[
          { label: tActions("edit"), onSelect: () => setEditing(true) },
          {
            label: tActions("delete"),
            destructive: true,
            onSelect: () => setConfirming(true),
          },
        ]}
      />

      {editing ? (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setEditing(false);
          }}
        >
          <div className="w-full max-w-md rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-xl">
            <div className="space-y-3">
              <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                {tA("edit_title")}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                  {tA("edit_due")}
                  <input
                    type="datetime-local"
                    value={dueLocal}
                    onChange={(e) => setDueLocal(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                  />
                </label>
                <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                  {tA("edit_status")}
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as AssignmentStatus)}
                    className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {tA(`status_${s}` as const)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                  {tA("edit_priority")}
                  <select
                    value={priority}
                    onChange={(e) =>
                      setPriority(e.target.value as AssignmentPriority | "")
                    }
                    className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                  >
                    <option value="">{tA("priority_none")}</option>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {tA(`priority_${p}` as const)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                {tA("edit_notes")}
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                className="rounded-md px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                {tActions("cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
              >
                {busy ? tActions("saving") : tActions("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={tA("delete_confirm_title")}
        body={tA("delete_confirm_body")}
        confirmLabel={tActions("delete")}
        cancelLabel={tActions("cancel")}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </div>
  );
}
