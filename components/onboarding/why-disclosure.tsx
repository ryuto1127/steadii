"use client";

import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export function WhyDisclosure({
  title = "Why do we need this?",
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-small font-medium text-[hsl(var(--muted-foreground))] transition-hover hover:text-[hsl(var(--foreground))]"
      >
        <ChevronRight
          size={12}
          strokeWidth={1.5}
          className={cn(
            "transition-default",
            open ? "rotate-90" : ""
          )}
        />
        {title}
      </button>
      {open ? (
        <div className="border-t border-[hsl(var(--border))] px-3 py-2 text-small text-[hsl(var(--muted-foreground))]">
          {children}
        </div>
      ) : null}
    </div>
  );
}
