import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type EmptyAction = { label: string; href: string };

export function DashboardCard({
  title,
  children,
  empty,
  action,
  shortcut,
  className,
}: {
  title: string;
  children?: ReactNode;
  empty?: { text: string; action?: EmptyAction };
  action?: { label: string; href: string; shortcut?: string };
  shortcut?: string;
  className?: string;
}) {
  const hasChildren = children !== undefined && children !== null && children !== false;
  return (
    <section
      className={cn(
        "rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4",
        className
      )}
    >
      <header className="mb-2.5 flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold leading-none text-[hsl(var(--foreground))]">
          {title}
        </h3>
        {action ? (
          <Link
            href={action.href}
            className="text-small text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {action.label}
            {action.shortcut ? (
              <span className="ml-2 font-mono text-[11px] opacity-70">{action.shortcut}</span>
            ) : null}
          </Link>
        ) : shortcut ? (
          <span className="font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {shortcut}
          </span>
        ) : null}
      </header>
      {hasChildren ? (
        <div className="space-y-1 text-[14px] leading-[1.4]">{children}</div>
      ) : empty ? (
        <div className="py-4 text-small text-[hsl(var(--muted-foreground))]">
          <p>{empty.text}</p>
          {empty.action ? (
            <Link
              href={empty.action.href}
              className="mt-3 inline-flex items-center text-[hsl(var(--primary))] transition-hover hover:opacity-80"
            >
              {empty.action.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
