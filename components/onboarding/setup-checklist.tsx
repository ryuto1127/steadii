"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const ITEMS = [
  "Creating Steadii parent page",
  "Creating Classes database",
  "Creating Mistake Notes database",
  "Creating Assignments database",
  "Creating Syllabi database",
] as const;

export function SetupChecklist({
  running,
  done,
}: {
  running: boolean;
  done: boolean;
}) {
  // Reveal each line with a 200ms stagger per §6. When `done` is true from
  // the server, show all checks filled.
  const [filled, setFilled] = useState(done ? ITEMS.length : 0);

  useEffect(() => {
    if (done) {
      setFilled(ITEMS.length);
      return;
    }
    if (!running) {
      setFilled(0);
      return;
    }
    setFilled(0);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < ITEMS.length; i++) {
      timers.push(
        setTimeout(() => {
          setFilled((f) => Math.max(f, i + 1));
        }, (i + 1) * 200)
      );
    }
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [running, done]);

  return (
    <ul className="font-mono text-small text-[hsl(var(--foreground))]">
      {ITEMS.map((label, i) => {
        const isDone = i < filled;
        return (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 py-1 transition-default",
              isDone ? "opacity-100" : "opacity-40"
            )}
          >
            <span
              className={cn(
                "flex h-3.5 w-3.5 items-center justify-center rounded-sm",
                isDone
                  ? "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
                  : "border border-[hsl(var(--border))]"
              )}
              aria-hidden
            >
              {isDone ? <Check size={10} strokeWidth={2} /> : null}
            </span>
            <span>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}
