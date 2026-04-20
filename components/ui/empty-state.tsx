import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type Action = { label: string; href?: string; onClick?: () => void };

export function EmptyState({
  icon,
  title,
  description,
  actions,
  className,
  tone = "neutral",
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  actions?: Action[];
  className?: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-lg flex-col items-center gap-3 rounded-lg border px-6 py-10 text-center",
        tone === "warn"
          ? "border-[hsl(var(--destructive)/0.35)] bg-[hsl(var(--destructive)/0.05)]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--surface))]",
        className
      )}
    >
      {icon ? (
        <div className="mb-1 flex h-10 w-10 items-center justify-center rounded-full bg-[hsl(var(--surface-raised))] text-[hsl(var(--muted-foreground))]">
          {icon}
        </div>
      ) : null}
      <h2 className="text-h2 text-[hsl(var(--foreground))]">{title}</h2>
      {description ? (
        <p className="text-small text-[hsl(var(--muted-foreground))]">{description}</p>
      ) : null}
      {actions && actions.length ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {actions.map((a, i) =>
            a.href ? (
              <Link
                key={i}
                href={a.href}
                className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                {a.label}
              </Link>
            ) : (
              <button
                key={i}
                type="button"
                onClick={a.onClick}
                className="inline-flex items-center rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 py-1.5 text-small font-medium transition-hover hover:bg-[hsl(var(--surface-raised))]"
              >
                {a.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
