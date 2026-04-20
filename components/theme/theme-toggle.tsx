"use client";

import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const OPTIONS = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
] as const;

export function ThemeToggle({ initial }: { initial: "light" | "dark" | "system" }) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Sync once on mount if the server-known initial diverges from the client
    // (e.g., another tab flipped it).
    if (theme !== initial) setTheme(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const active = mounted ? theme ?? initial : initial;

  async function persist(value: string) {
    setTheme(value);
    await fetch("/api/settings/theme", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: value }),
    });
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = active === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => persist(value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-small font-medium transition-hover",
              isActive
                ? "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            )}
          >
            <Icon size={12} strokeWidth={1.5} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
