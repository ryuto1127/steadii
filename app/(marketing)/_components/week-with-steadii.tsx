"use client";

import { useEffect, useRef, useState } from "react";
import { ContextTag } from "./context-tag";

// "A week with Steadii." — five moments from one student's week, revealed
// as a scroll-triggered timeline. The last moment (Sunday) gets the
// punchline treatment so "your whole semester" lands harder.

export type WeekCopy = {
  context_label: string;
  moments: Array<{
    time: string;
    event: string;
    action: string;
    context: string;
  }>;
  locale: "en" | "ja";
};

// Reveal cadence: 5 fade-ins, ~3.5s total. Short enough that the timeline
// fills in without forcing scroll-pause discipline.
const STEPS = [300, 800, 800, 800, 800] as const;

export function WeekWithSteadii({ copy }: { copy: WeekCopy }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [revealed, setRevealed] = useState(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) {
      setRevealed(5);
      return;
    }
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    const timers: number[] = [];

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          obs.disconnect();
          if (cancelled) return;
          let cumulative = 0;
          STEPS.forEach((step, i) => {
            cumulative += step;
            timers.push(
              window.setTimeout(() => setRevealed(i + 1), cumulative),
            );
          });
          return;
        }
      },
      { threshold: 0.25 },
    );
    obs.observe(node);
    return () => {
      cancelled = true;
      obs.disconnect();
      for (const t of timers) window.clearTimeout(t);
    };
  }, [reduced]);

  const jpFont = copy.locale === "ja" ? "var(--font-jp)" : "var(--font-sans)";

  return (
    <div
      ref={ref}
      className="relative mx-auto max-w-[680px]"
    >
      {/* Vertical connector line behind the left rail. */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-2 bottom-2 left-[88px] w-px md:left-[112px]"
        style={{ background: "var(--line)" }}
      />

      <ol className="flex flex-col gap-6 md:gap-7">
        {copy.moments.map((m, i) => {
          const active = revealed > i;
          const isLast = i === copy.moments.length - 1;
          return (
            <li
              key={i}
              className={`relative flex items-start transition-all duration-500 ${
                active
                  ? "translate-y-0 opacity-100"
                  : "translate-y-1 opacity-0"
              }`}
            >
              {/* Left rail — timestamp. */}
              <div className="relative w-[88px] shrink-0 md:w-[112px]">
                <span
                  className="font-mono text-[11px] uppercase tracking-widest"
                  style={{ color: "var(--ink-4)" }}
                >
                  {m.time}
                </span>
                {/* Anchor dot on the connector line — left position matches rail width. */}
                <span
                  aria-hidden
                  className="absolute top-[7px] left-[88px] h-1.5 w-1.5 -translate-x-1/2 rounded-full md:left-[112px]"
                  style={{
                    background: isLast ? "#8579A8" : "var(--ink-4)",
                  }}
                />
              </div>

              {/* Right content — event + action + context tag. */}
              <div
                className={`flex-1 rounded-[12px] border px-4 py-3.5 ${
                  isLast ? "" : "bg-transparent"
                }`}
                style={{
                  borderColor: isLast ? "rgba(133, 121, 168, 0.18)" : "var(--line)",
                  background: isLast ? "rgba(133, 121, 168, 0.04)" : "transparent",
                }}
              >
                <p
                  className="text-[15px] font-semibold leading-[1.3] md:text-[16px]"
                  style={{ color: "var(--ink-1)", fontFamily: jpFont }}
                >
                  {m.event}
                </p>
                <p
                  className="mt-1 text-[14px] leading-[1.5]"
                  style={{ color: "var(--ink-3)" }}
                >
                  {m.action}
                </p>
                <div className="mt-1.5">
                  <ContextTag
                    label={copy.context_label}
                    value={m.context}
                    className={isLast ? "text-[12px]" : ""}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
