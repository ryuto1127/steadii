import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type EmptyAction = { label: string; href: string };

export function DashboardCard({
  label,
  children,
  empty,
  action,
  className,
}: {
  /** Mono small-caps section label, e.g. "TODAY · APR 20". */
  label: string;
  children?: ReactNode;
  empty?: { text: string; action?: EmptyAction };
  action?: { label: string; href: string; shortcut?: string };
  className?: string;
}) {
  const hasChildren = children !== undefined && children !== null && children !== false;
  return (
    <section
      className={cn(
        "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-3",
        className
      )}
    >
      <header className="mb-2 flex items-center justify-between gap-3">
        <span className="mono-label">{label}</span>
        {action ? (
          <Link
            href={action.href}
            className="mono-label text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {action.label}
          </Link>
        ) : null}
      </header>
      {hasChildren ? (
        <div className="space-y-1">{children}</div>
      ) : empty ? (
        <div className="py-4 text-small text-[hsl(var(--muted-foreground))]">
          <p>{empty.text}</p>
          {empty.action ? (
            <Link
              href={empty.action.href}
              className="mt-2 inline-flex items-center text-[hsl(var(--primary))] transition-hover hover:opacity-80"
            >
              {empty.action.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
