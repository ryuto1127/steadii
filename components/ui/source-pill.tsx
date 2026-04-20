"use client";

import { FileText, NotebookPen } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type SourceKind = "syllabus" | "mistake" | "page";

export function SourcePill({
  kind = "page",
  title,
  subtitle,
  onClick,
  className,
}: {
  kind?: SourceKind;
  title: string;
  subtitle?: string;
  onClick?: () => void;
  className?: string;
}) {
  const Icon: ReactNode =
    kind === "mistake" ? (
      <NotebookPen size={12} strokeWidth={1.5} />
    ) : (
      <FileText size={12} strokeWidth={1.5} />
    );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-[4px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-2 py-1 text-small text-[hsl(var(--foreground))] transition-hover hover:bg-[hsl(var(--surface-raised))]",
        className
      )}
    >
      <span className="flex h-3 w-3 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]">
        {Icon}
      </span>
      <span className="truncate">{title}</span>
      {subtitle ? (
        <span className="truncate text-[hsl(var(--muted-foreground))]">· {subtitle}</span>
      ) : null}
    </button>
  );
}
