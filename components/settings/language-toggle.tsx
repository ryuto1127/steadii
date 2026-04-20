"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

type Locale = "en" | "ja";

export function LanguageToggle({
  initial,
  labels,
}: {
  initial: Locale;
  labels: { en: string; ja: string };
}) {
  const [value, setValue] = useState<Locale>(initial);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const apply = (next: Locale) => {
    if (next === value) return;
    setValue(next);
    startTransition(async () => {
      const res = await fetch("/api/settings/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (res.ok) {
        router.refresh();
      } else {
        setValue(initial);
      }
    });
  };

  return (
    <div
      role="radiogroup"
      aria-label="Language"
      className="inline-flex rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-0.5"
    >
      {(["en", "ja"] as const).map((loc) => {
        const isActive = value === loc;
        return (
          <button
            key={loc}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={isPending}
            onClick={() => apply(loc)}
            className={cn(
              "inline-flex items-center rounded-[4px] px-2.5 py-1 text-small font-medium transition-hover",
              isActive
                ? "bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))]"
                : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
            )}
          >
            {labels[loc]}
          </button>
        );
      })}
    </div>
  );
}
