"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function SyllabusRowActions({
  syllabusId,
  initialTitle,
  initialTerm,
}: {
  syllabusId: string;
  initialTitle: string;
  initialTerm: string | null;
}) {
  const tActions = useTranslations("classes.actions");
  const tSyllabus = useTranslations("classes.syllabus");
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [term, setTerm] = useState(initialTerm ?? "");

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/syllabi/${syllabusId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || initialTitle,
          term: term.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tSyllabus("saved_toast"));
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tSyllabus("save_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/syllabi/${syllabusId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tSyllabus("deleted_toast"));
      setConfirming(false);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : tSyllabus("delete_failed")
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
            <h2 className="text-h3 text-[hsl(var(--foreground))]">
              {tSyllabus("edit_modal_title")}
            </h2>
            <div className="mt-3 space-y-3">
              <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                {tSyllabus("edit_title")}
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                {tSyllabus("edit_term")}
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
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
        title={tSyllabus("delete_confirm_title")}
        body={tSyllabus("delete_confirm_body")}
        confirmLabel={tActions("delete")}
        cancelLabel={tActions("cancel")}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />
    </>
  );
}
