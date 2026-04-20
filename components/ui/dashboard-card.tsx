import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type EmptyAction = { label: string; href: string };

export function DashboardCard({
  title,
  subtitle,
  children,
  empty,
  action,
  className,
}: {
  /** Sentence-case section title, e.g. "Today". */
  title: string;
  /** Muted subtitle sitting under the title, e.g. "Wed, Apr 20". */
  subtitle?: string;
  children?: ReactNode;
  empty?: { text: string; action?: EmptyAction };
  action?: { label: string; href: string };
  className?: string;
}) {
  const hasChildren = children !== undefined && children !== null && children !== false;
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <header className="flex items-baseline justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-[14px] font-semibold text-[hsl(var(--foreground))]">
            {title}
          </span>
          {subtitle ? (
            <span className="text-[12px] text-[hsl(var(--muted-foreground))]">
              {subtitle}
            </span>
          ) : null}
        </div>
        {action ? (
          <Link
            href={action.href}
            className="text-[13px] text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
          >
            {action.label}
          </Link>
        ) : null}
      </header>
      {hasChildren ? (
        <div className="flex flex-col gap-1.5">{children}</div>
      ) : empty ? (
        <div className="py-3 text-[14px] text-[hsl(var(--muted-foreground))]">
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
