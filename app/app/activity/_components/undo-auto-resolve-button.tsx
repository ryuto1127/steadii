"use client";

import { useState, useTransition } from "react";
import { Undo2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { undoAutoResolveDraftAction } from "../actions";

// 2026-05-24 — Round 5 notify-with-undo. Inline [元に戻す] button
// rendered on activity-feed rows where the auto-resolve notification
// is still inside its 24h reversibility window. Disappears (and
// disables itself) on successful undo so a double-tap can't fire
// twice. On a server-side refuse (e.g. window expired between row
// render and click), the button surfaces a static "expired" label
// rather than blocking the rest of the timeline.
export function UndoAutoResolveButton({
  notificationId,
}: {
  notificationId: string;
}) {
  const t = useTranslations("activity_page");
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");

  if (state === "done") {
    return (
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
        {t("undo_done")}
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-[hsl(var(--muted-foreground))]">
        {t("undo_failed")}
      </span>
    );
  }

  const onClick = () => {
    startTransition(async () => {
      try {
        const result = await undoAutoResolveDraftAction({ notificationId });
        setState(result.ok ? "done" : "failed");
      } catch {
        setState("failed");
      }
    });
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 text-[11px] font-medium text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))] disabled:opacity-50"
      aria-label={t("undo_aria")}
    >
      <Undo2 size={12} strokeWidth={1.75} />
      <span>{t("undo_label")}</span>
    </button>
  );
}
