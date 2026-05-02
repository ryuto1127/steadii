"use client";

import { Inbox } from "lucide-react";
import { useTranslations } from "next-intl";

// Empty state shown when the queue has zero items. The CTA button
// auto-focuses the command palette by id (the palette's input is
// labelled with `placeholder_default`, so we focus the first text input
// inside the .command-palette-target wrapper). This keeps the palette
// component self-contained without exposing a focus ref.
export function QueueEmptyState() {
  const t = useTranslations("queue");
  return (
    <div className="rounded-2xl border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--surface-raised)/0.4)] p-8 text-center">
      <span
        aria-hidden
        className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]"
      >
        <Inbox size={16} strokeWidth={1.5} />
      </span>
      <h2 className="mt-3 font-display text-[18px] font-semibold tracking-[-0.01em] text-[hsl(var(--foreground))]">
        {t("empty_title")}
      </h2>
      <p className="mt-1 text-[13px] leading-snug text-[hsl(var(--muted-foreground))]">
        {t("empty_body")}
      </p>
      <button
        type="button"
        onClick={() => {
          if (typeof document === "undefined") return;
          const input = document.querySelector<HTMLInputElement>(
            "[data-command-palette] input[type='text']"
          );
          input?.focus();
          input?.scrollIntoView({ behavior: "smooth", block: "center" });
        }}
        className="mt-4 inline-flex h-9 items-center rounded-full bg-[hsl(var(--foreground))] px-4 text-[12px] font-medium text-[hsl(var(--surface))] transition-default hover:opacity-90"
      >
        {t("empty_cta")}
        <span className="ml-1.5 font-mono text-[10px] opacity-80">▶</span>
      </button>
    </div>
  );
}
