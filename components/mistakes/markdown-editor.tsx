"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type ClassOption = { id: string; name: string };

export function MistakeMarkdownEditor({
  mistakeId,
  initialTitle,
  initialUnit,
  initialDifficulty,
  initialTags,
  initialBody,
  initialClassId,
  classes,
}: {
  mistakeId: string;
  initialTitle: string;
  initialUnit: string | null;
  initialDifficulty: "easy" | "medium" | "hard" | null;
  initialTags: string[];
  initialBody: string;
  initialClassId: string | null;
  classes: ClassOption[];
}) {
  const router = useRouter();
  const tMistakes = useTranslations("mistakes");
  const tActions = useTranslations("classes.actions");
  const [title, setTitle] = useState(initialTitle);
  const [unit, setUnit] = useState(initialUnit ?? "");
  const [difficulty, setDifficulty] = useState<"easy" | "medium" | "hard" | "">(
    initialDifficulty ?? ""
  );
  const [tagsText, setTagsText] = useState(initialTags.join(", "));
  const [body, setBody] = useState(initialBody);
  const [classId, setClassId] = useState(initialClassId ?? "");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deleteNote() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/mistakes/${mistakeId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await res.text());
      toast.success(tMistakes("deleted_toast"));
      // Redirect to the parent class detail page when we know it; otherwise
      // fall back to the classes index. router.back() is unreliable here
      // because the editor can be reached from grid, chat, or notification.
      if (initialClassId) {
        router.push(`/app/classes/${initialClassId}?tab=mistakes`);
      } else {
        router.push("/app/classes");
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : tMistakes("delete_failed")
      );
      setDeleting(false);
      setConfirmingDelete(false);
    }
  }

  function wrap(prefix: string, suffix = prefix) {
    const ta = document.getElementById("mistake-body") as HTMLTextAreaElement | null;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = body.slice(0, start);
    const sel = body.slice(start, end);
    const after = body.slice(end);
    const next = `${before}${prefix}${sel}${suffix}${after}`;
    setBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = start + prefix.length;
      ta.selectionEnd = end + prefix.length;
    });
  }

  function prefixLines(prefix: string) {
    const ta = document.getElementById("mistake-body") as HTMLTextAreaElement | null;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = body.slice(0, start);
    const sel = body.slice(start, end) || "item";
    const after = body.slice(end);
    const next = sel
      .split("\n")
      .map((l) => `${prefix}${l}`)
      .join("\n");
    setBody(`${before}${next}${after}`);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/mistakes/${mistakeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || initialTitle,
          unit: unit.trim() || null,
          difficulty: difficulty || null,
          tags: tagsText
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          bodyMarkdown: body,
          classId: classId || null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedAt(new Date());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="flex-1 bg-transparent text-h1 text-[hsl(var(--foreground))] focus:outline-none"
          placeholder="Mistake title"
        />
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={saving || deleting}
          className="rounded-md border border-[hsl(var(--destructive)/0.3)] px-3 py-1.5 text-small text-[hsl(var(--destructive))] transition-hover hover:bg-[hsl(var(--destructive)/0.08)] disabled:opacity-40"
        >
          {tMistakes("delete_button")}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-lg bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <ConfirmDialog
        open={confirmingDelete}
        title={tMistakes("delete_confirm_title")}
        body={tMistakes("delete_confirm_body")}
        confirmLabel={tMistakes("delete_button")}
        cancelLabel={tActions("cancel")}
        busy={deleting}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={deleteNote}
      />
      {savedAt && (
        <div className="text-xs text-[hsl(var(--muted-foreground))]">
          Saved at {savedAt.toLocaleTimeString()}
        </div>
      )}
      {error && (
        <div className="rounded-md bg-[hsl(var(--destructive)/0.1)] px-3 py-2 text-xs text-[hsl(var(--destructive))]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
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
          Unit
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
              setDifficulty(e.target.value as "easy" | "medium" | "hard" | "")
            }
            className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
          >
            <option value="">—</option>
            <option value="easy">easy</option>
            <option value="medium">medium</option>
            <option value="hard">hard</option>
          </select>
        </label>
        <label className="block text-xs text-[hsl(var(--muted-foreground))]">
          Tags
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="vectors, integration"
            className="mt-1 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 text-sm"
          />
        </label>
      </div>

      <div className="flex items-center gap-1 border-b border-[hsl(var(--border))] pb-2">
        <ToolbarButton onClick={() => wrap("**")} aria-label="Bold">
          <span className="font-bold">B</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => wrap("*")} aria-label="Italic">
          <span className="italic">I</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => wrap("`")} aria-label="Inline code">
          <span className="font-mono">{"<>"}</span>
        </ToolbarButton>
        <ToolbarButton onClick={() => prefixLines("- ")} aria-label="Bullet list">
          •
        </ToolbarButton>
        <ToolbarButton onClick={() => prefixLines("1. ")} aria-label="Numbered list">
          1.
        </ToolbarButton>
        <ToolbarButton onClick={() => wrap("$")} aria-label="Inline math">
          ƒ
        </ToolbarButton>
        <ToolbarButton onClick={() => wrap("\n$$\n", "\n$$\n")} aria-label="Block math">
          ƒ²
        </ToolbarButton>
        <ToolbarButton onClick={() => prefixLines("## ")} aria-label="Heading">
          H
        </ToolbarButton>

        <div className="ml-auto flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={
              mode === "edit"
                ? "rounded-md bg-[hsl(var(--surface-raised))] px-2 py-1"
                : "px-2 py-1 text-[hsl(var(--muted-foreground))]"
            }
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode("preview")}
            className={
              mode === "preview"
                ? "rounded-md bg-[hsl(var(--surface-raised))] px-2 py-1"
                : "px-2 py-1 text-[hsl(var(--muted-foreground))]"
            }
          >
            Preview
          </button>
        </div>
      </div>

      {mode === "edit" ? (
        <textarea
          id="mistake-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={24}
          className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] px-3 py-2 font-mono text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
          placeholder="Markdown body. Math via $...$ inline or $$...$$ block. Images: ![](url)."
        />
      ) : (
        <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4">
          <MarkdownMessage content={body || "_(empty)_"} />
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-2 py-1 text-sm transition-hover hover:bg-[hsl(var(--surface-raised))]"
      {...rest}
    >
      {children}
    </button>
  );
}
