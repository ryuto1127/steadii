"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClassDot } from "./class-dot";
import type { ClassColor } from "./class-color";
import { cn } from "@/lib/utils/cn";

export function DenseRowLink({
  href,
  leadingDot,
  title,
  secondary,
  metadata,
  rightContent,
  className,
}: {
  href: string;
  leadingDot?: ClassColor | string | null;
  title: ReactNode;
  secondary?: ReactNode;
  metadata?: string[];
  rightContent?: ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      data-dense-row
      tabIndex={0}
      className={cn(
        "flex items-center gap-3 rounded-md border border-transparent px-3 py-2.5 transition-hover",
        "hover:border-[hsl(var(--border))] hover:bg-[hsl(var(--surface-raised))]",
        "focus-visible:border-[hsl(var(--border))] focus-visible:bg-[hsl(var(--surface-raised))]",
        className
      )}
    >
      {leadingDot !== undefined ? <ClassDot color={leadingDot ?? null} /> : null}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="truncate text-body text-[hsl(var(--foreground))]">{title}</span>
          {secondary ? (
            <span className="truncate text-small text-[hsl(var(--muted-foreground))]">
              {secondary}
            </span>
          ) : null}
        </div>
        {metadata && metadata.length ? (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-small text-[hsl(var(--muted-foreground))]">
            {metadata.map((m, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 ? <span aria-hidden>·</span> : null}
                <span className="tabular-nums">{m}</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {rightContent ? <div className="shrink-0">{rightContent}</div> : null}
    </Link>
  );
}
