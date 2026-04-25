"use client";

import { useEffect, useState } from "react";

type ClassOption = { id: string; name: string; status: string };

export function MistakeNoteDialog({
  chatId,
  assistantMessageId,
  open,
  onClose,
}: {
  chatId: string;
  assistantMessageId: string;
  open: boolean;
  onClose: () => void;
}) {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [title, setTitle] = useState("");
  const [classId, setClassId] = useState("");
  const [unit, setUnit] = useState("");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard">("medium");
  const [tagsText, setTagsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/classes")
      .then((r) => r.json())
      .then((b: { classes: ClassOption[] }) =>
        setClasses(b.classes.filter((c) => c.status !== "archived"))
      )
      .catch(() => setClasses([]));
  }, [open]);

  if (!open) return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/mistakes/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatId,
          assistantMessageId,
          title: title.trim() || "Untitled problem",
          classNotionPageId: classId || null,
          unit: unit.trim() || null,
          difficulty,
          tags: tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save_failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-md rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 shadow-lg">
        <h2 className="text-h2 text-[hsl(var(--foreground))]">Add to Mistake Notes</h2>
        <div className="mt-4 space-y-3">
          <label className="block text-xs text-[hsl(var(--muted-foreground))]">
            Title (short problem summary)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
              placeholder="e.g. 2D projectile with wind"
            />
          </label>

          <label className="block text-xs text-[hsl(var(--muted-foreground))]">
            Class
            <select
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
            >
              <option value="">(none)</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-[hsl(var(--muted-foreground))]">
            Unit / chapter
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs text-[hsl(var(--muted-foreground))]">
            Difficulty
            <select
              value={difficulty}
              onChange={(e) =>
                setDifficulty(e.target.value as "easy" | "medium" | "hard")
              }
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
            >
              <option value="easy">easy</option>
              <option value="medium">medium</option>
              <option value="hard">hard</option>
            </select>
          </label>

          <label className="block text-xs text-[hsl(var(--muted-foreground))]">
            Tags (comma-separated)
            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
              placeholder="vectors, integration"
            />
          </label>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-[hsl(var(--destructive)/0.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[hsl(var(--border))] px-4 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save mistake note"}
          </button>
        </div>
      </div>
    </div>
  );
}
