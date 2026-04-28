"use client";

import { useEffect } from "react";

// Minimal Raycast/Arc-style confirmation dialog. Shared across class/CRUD
// flows so the visual language stays consistent: small surface, sharp 6px
// radius, electric amber accent on the destructive primary, no backdrop
// blur. Anything fancier should be a follow-up — this exists so we don't
// invent a new dialog for every entity.
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  destructive = true,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-full max-w-md rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-5 shadow-xl">
        <h2 className="text-h3 text-[hsl(var(--foreground))]">{title}</h2>
        {body ? (
          <div className="mt-2 text-small text-[hsl(var(--muted-foreground))]">
            {body}
          </div>
        ) : null}
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-small text-[hsl(var(--muted-foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] hover:text-[hsl(var(--foreground))] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={
              destructive
                ? "rounded-md bg-[hsl(var(--destructive))] px-3 py-1.5 text-small font-medium text-white transition-hover hover:opacity-90 disabled:opacity-50"
                : "rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-small font-medium text-[hsl(var(--primary-foreground))] transition-hover hover:opacity-90 disabled:opacity-50"
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
