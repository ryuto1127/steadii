"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { KebabMenu } from "@/components/ui/kebab-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ClassColor } from "@/components/ui/class-color";

type CascadeCounts = {
  syllabi: number;
  assignments: number;
  mistakes: number;
};

const COLOR_OPTIONS: ClassColor[] = [
  "blue",
  "green",
  "orange",
  "purple",
  "red",
  "gray",
  "brown",
  "pink",
];

export function ClassHeaderActions({
  classId,
  initial,
}: {
  classId: string;
  initial: {
    name: string;
    code: string | null;
    term: string | null;
    professor: string | null;
    color: ClassColor | null;
  };
}) {
  const tActions = useTranslations("classes.actions");
  const tEdit = useTranslations("classes.edit_class");
  const tDelete = useTranslations("classes.delete_class");
  const router = useRouter();

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [counts, setCounts] = useState<CascadeCounts | null>(null);

  const [name, setName] = useState(initial.name);
  const [code, setCode] = useState(initial.code ?? "");
  const [term, setTerm] = useState(initial.term ?? "");
  const [professor, setProfessor] = useState(initial.professor ?? "");
  const [color, setColor] = useState<ClassColor | "">(initial.color ?? "");

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || initial.name,
          code: code.trim() || null,
          term: term.trim() || null,
          professor: professor.trim() || null,
          color: color || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tEdit("saved_toast"));
      setEditing(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tEdit("save_failed"));
    } finally {
      setBusy(false);
    }
  }

  async function openConfirm() {
    setConfirming(true);
    setCounts(null);
    try {
      const res = await fetch(`/api/classes/${classId}/cascade-counts`);
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as CascadeCounts;
      setCounts(data);
    } catch {
      setCounts({ syllabi: 0, assignments: 0, mistakes: 0 });
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/classes/${classId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      toast.success(
        tDelete("success_toast").replace("{name}", initial.name)
      );
      setConfirming(false);
      router.push("/app/classes");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tDelete("delete_failed"));
    } finally {
      setBusy(false);
    }
  }

  const hasCascade =
    counts !== null &&
    (counts.syllabi > 0 || counts.assignments > 0 || counts.mistakes > 0);
  const confirmBody =
    counts === null
      ? null
      : hasCascade
        ? tDelete("confirm_body")
            .replace("{syllabi}", String(counts.syllabi))
            .replace("{assignments}", String(counts.assignments))
            .replace("{mistakes}", String(counts.mistakes))
        : tDelete("confirm_body_no_cascade");

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => setEditing(true)}
        title={tEdit("button")}
        aria-label={tEdit("button")}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))]"
      >
        <Pencil size={14} strokeWidth={1.75} />
        <span className="sr-only md:not-sr-only">{tEdit("button")}</span>
      </button>
      <KebabMenu
        ariaLabel={tActions("menu_label")}
        items={[
          {
            label: tDelete("button"),
            destructive: true,
            onSelect: openConfirm,
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
              {tEdit("title")}
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block text-xs text-[hsl(var(--muted-foreground))] sm:col-span-2">
                {tEdit("name_label")}
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                {tEdit("code_label")}
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-[hsl(var(--muted-foreground))]">
                {tEdit("term_label")}
                <input
                  value={term}
                  onChange={(e) => setTerm(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-[hsl(var(--muted-foreground))] sm:col-span-2">
                {tEdit("professor_label")}
                <input
                  value={professor}
                  onChange={(e) => setProfessor(e.target.value)}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-[hsl(var(--muted-foreground))] sm:col-span-2">
                {tEdit("color_label")}
                <select
                  value={color}
                  onChange={(e) => setColor(e.target.value as ClassColor | "")}
                  className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
                >
                  <option value="">—</option>
                  {COLOR_OPTIONS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setEditing(false)}
                className="inline-flex h-9 items-center rounded-md px-3 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
              >
                {tActions("cancel")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={save}
                className="inline-flex h-9 items-center rounded-md bg-[hsl(var(--primary))] px-4 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
              >
                {busy ? tActions("saving") : tActions("save")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title={tDelete("confirm_title").replace("{name}", initial.name)}
        body={
          confirmBody ?? (
            <span className="text-[hsl(var(--muted-foreground))]">…</span>
          )
        }
        confirmLabel={tDelete("button")}
        cancelLabel={tActions("cancel")}
        busy={busy || counts === null}
        onCancel={() => setConfirming(false)}
        onConfirm={remove}
      />

    </div>
  );
}
