"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
type Locale = "en" | "ja";

// Pill-style locale toggle that sits inside the landing nav. Matches
// Claude Design's compact two-pill pattern (active = white pill on a
// sunken bed). Mirrors the cookie behavior of the footer LocaleToggle.
export function NavLocaleToggle({
  current,
  labels,
  ariaLabel,
}: {
  current: Locale;
  labels: { en: string; ja: string };
  ariaLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function pick(next: Locale) {
    if (next === current || pending) return;
    document.cookie = `steadii-locale=${next}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    startTransition(() => router.refresh());
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className="inline-flex items-center gap-1 rounded-full p-[2px]"
      style={{ background: "var(--bg-sunken)" }}
    >
      {(["en", "ja"] as const).map((value) => {
        const isActive = current === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => pick(value)}
            className={cn(
              "h-[22px] w-[30px] rounded-full text-[11px] font-semibold transition-hover",
              isActive
                ? "bg-white text-[#2a2c33] shadow-[0_1px_0_rgba(20,22,30,0.04),0_1px_2px_rgba(20,22,30,0.04)]"
                : "bg-transparent text-[#2a2c33]/70 hover:text-[#2a2c33]",
            )}
          >
            {labels[value]}
          </button>
        );
      })}
    </div>
  );
}
