"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

type Locale = "en" | "ja";

export function LocaleToggle({
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
      className="inline-flex font-mono text-[11px] uppercase tracking-widest"
    >
      {(["en", "ja"] as const).map((value, idx) => {
        const isActive = current === value;
        return (
          <span key={value} className="contents">
            <button
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => pick(value)}
              className={cn(
                "transition-hover",
                isActive
                  ? "text-[#1A1814]"
                  : "text-[#1A1814]/50 hover:text-[#8579A8]",
              )}
            >
              {labels[value]}
            </button>
            {idx === 0 ? (
              <span aria-hidden className="mx-1.5 text-[#1A1814]/40">
                /
              </span>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
