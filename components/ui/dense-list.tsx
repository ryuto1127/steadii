"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function DenseList({
  children,
  className,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const container = ref.current;
    if (!container) return;
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>('[data-dense-row][tabindex="0"]')
    );
    if (rows.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const idx = active ? rows.indexOf(active) : -1;
    e.preventDefault();
    let next = idx;
    if (e.key === "ArrowDown") next = idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1);
    if (e.key === "ArrowUp") next = idx < 0 ? 0 : Math.max(idx - 1, 0);
    rows[next]?.focus();
  };

  return (
    <div
      ref={ref}
      onKeyDown={handleKey}
      role="list"
      aria-label={ariaLabel}
      className={cn("flex flex-col gap-0.5", className)}
    >
      {children}
    </div>
  );
}
