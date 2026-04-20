"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export function ActionPill({
  children,
  onClick,
  disabled,
  tone = "neutral",
  icon,
  className,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "neutral" | "primary" | "destructive";
  icon?: ReactNode;
  className?: string;
  type?: "button" | "submit";
}) {
  const toneClasses =
    tone === "primary"
      ? "border-[hsl(var(--border)/0.6)] bg-transparent text-[hsl(var(--primary))] hover:bg-[hsl(var(--surface-raised))]"
      : tone === "destructive"
      ? "border-[hsl(var(--border)/0.6)] bg-transparent text-[hsl(var(--destructive))] hover:bg-[hsl(var(--surface-raised))]"
      : "border-[hsl(var(--border)/0.6)] bg-transparent text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface-raised))]";

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-small font-medium transition-hover disabled:cursor-not-allowed disabled:opacity-50",
        toneClasses,
        className
      )}
    >
      {icon ? <span className="flex h-3.5 w-3.5 items-center justify-center">{icon}</span> : null}
      {children}
    </button>
  );
}
