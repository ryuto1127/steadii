"use client";

import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDown,
  Check,
  Clock,
  Inbox as InboxIcon,
  RotateCcw,
} from "lucide-react";

// Wave 5 auto-archive demo — replaces the pre-Wave-2 calendar-conflict mock.
//
// Three sequentially-revealed phases that mirror the actual /app/inbox surface:
//
//   1. A clear-noise email lands → Steadii classifies Tier 1 ≥95% →
//      auto-archived. Queue stays clean.
//   2. The user opens the Hidden filter chip (pulled visually from
//      app/app/inbox/page.tsx so the marketing demo matches what users
//      actually see) → restores the item.
//   3. Steadii learns from the restore → similar future items get
//      surfaced for review instead of auto-archived.
//
// Copy lives at landing.steadii_in_motion.* — both EN and JA. Static frame
// (prefers-reduced-motion or after the one-shot reveal) shows all three
// phases so the moat reads even without motion.

type Copy = {
  step1_label: string;
  step1_sender: string;
  step1_subject: string;
  step1_chip_tier: string;
  step1_chip_time: string;
  step1_classifying: string;
  step1_outcome: string;
  step1_outcome_meta: string;
  step2_label: string;
  step2_filter_all: string;
  step2_filter_hidden: string;
  step2_restore: string;
  step2_meta: string;
  step3_label: string;
  step3_sender: string;
  step3_subject: string;
  step3_chip_tier: string;
  step3_chip_time: string;
  step3_status: string;
  step3_meta: string;
};

// Reveal cadence: phase 1 lands fast on viewport entry (the section feels
// responsive to scroll), then 2 and 3 chain at a rhythm that gives the user
// time to read each step without forcing scroll-pause discipline.
const STEPS = [400, 1500, 1500] as const;

export function ProactiveMock({ copy }: { copy: Copy }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<0 | 1 | 2 | 3>(0);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) {
      setPhase(3);
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
          setPhase(0);
          let cumulative = 0;
          timers.push(
            window.setTimeout(() => setPhase(1), (cumulative += STEPS[0])),
          );
          timers.push(
            window.setTimeout(() => setPhase(2), (cumulative += STEPS[1])),
          );
          timers.push(
            window.setTimeout(() => setPhase(3), (cumulative += STEPS[2])),
          );
          return;
        }
      },
      { threshold: 0.4 },
    );
    obs.observe(node);
    return () => {
      cancelled = true;
      obs.disconnect();
      for (const t of timers) window.clearTimeout(t);
    };
  }, [reduced]);

  return (
    <div
      ref={ref}
      className="relative overflow-hidden rounded-[14px] border border-black/[0.06] bg-white p-5 shadow-[0_8px_30px_-12px_rgba(20,20,40,0.10)] md:p-7"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background: `
            radial-gradient(circle at 0% 0%, rgba(220, 200, 170, 0.08) 0%, transparent 50%),
            radial-gradient(circle at 100% 100%, rgba(178, 165, 200, 0.08) 0%, transparent 50%)
          `,
        }}
      />
      <div className="relative grid gap-3 md:grid-cols-3">
        <Step1 copy={copy} active={phase >= 1} />
        <StepArrow active={phase >= 2} />
        <Step2 copy={copy} active={phase >= 2} />
        <StepArrow active={phase >= 3} />
        <Step3 copy={copy} active={phase >= 3} />
      </div>
    </div>
  );
}

// ─── Step 1 — auto-archive ────────────────────────────────────────────────
function Step1({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`md:col-span-1 rounded-[10px] border border-black/[0.06] bg-[#FAFAF9] p-3.5 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <InboxIcon size={11} strokeWidth={1.6} className="text-[#1A1814]/45" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#1A1814]/50">
          {copy.step1_label}
        </p>
      </div>

      {/* Inbox row visual — mirrors the /app/inbox row. */}
      <div className="mt-2.5 rounded-md border border-black/[0.06] bg-white px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-4 items-center rounded-full bg-[#FAFAF9] px-1.5 font-mono text-[9px] uppercase tracking-wider text-[#1A1814]/50">
            {copy.step1_chip_tier}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] text-[#1A1814]">
            {copy.step1_sender}
          </span>
          <span className="font-mono text-[9px] tabular-nums text-[#1A1814]/40">
            {copy.step1_chip_time}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[#1A1814]/55">
          {copy.step1_subject}
        </p>
      </div>

      {/* Classifier line — animated tick → archived. */}
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[#1A1814]/65">
        <Clock size={10} strokeWidth={1.6} />
        <span>{copy.step1_classifying}</span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5 text-[11px] text-emerald-700">
        <Check size={11} strokeWidth={2} />
        <span className="font-medium">{copy.step1_outcome}</span>
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-[#1A1814]/60">
        {copy.step1_outcome_meta}
      </p>
    </div>
  );
}

// ─── Step 2 — Hidden filter + restore ─────────────────────────────────────
function Step2({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`md:col-span-1 rounded-[10px] border border-black/[0.06] bg-[#FAFAF9] p-3.5 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <InboxIcon size={11} strokeWidth={1.6} className="text-[#1A1814]/45" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#1A1814]/50">
          {copy.step2_label}
        </p>
      </div>

      {/* Hidden filter chip row — pulls the same visual vocabulary as
          app/app/inbox/page.tsx. The "Hidden ({n})" pill is selected
          (foreground bg) since the user has clicked into it. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="inline-flex h-6 items-center rounded-full border border-black/[0.08] bg-white px-2.5 text-[11px] text-[#1A1814]/65">
          {copy.step2_filter_all}
        </span>
        <span className="inline-flex h-6 items-center gap-1 rounded-full bg-[#0A0A0A] px-2.5 text-[11px] font-medium text-white">
          <Archive size={10} strokeWidth={1.75} />
          {copy.step2_filter_hidden}
        </span>
      </div>

      {/* The hidden item with restore action — same shape as Inbox row +
          restore footer used in the production Hidden view. */}
      <div className="mt-2.5 overflow-hidden rounded-md border border-black/[0.08] bg-white">
        <div className="px-2.5 py-2">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-4 items-center rounded-full bg-[#FAFAF9] px-1.5 font-mono text-[9px] uppercase tracking-wider text-[#1A1814]/45">
              {copy.step1_chip_tier}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-[#1A1814]/65">
              {copy.step1_sender}
            </span>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-[#1A1814]/55">
            {copy.step1_subject}
          </p>
        </div>
        <div className="border-t border-black/[0.05] bg-[#FAFAF9] px-2.5 py-1.5">
          <span className="inline-flex h-6 items-center gap-1 text-[11px] font-medium text-[#8579A8]">
            <RotateCcw size={10} strokeWidth={1.75} />
            {copy.step2_restore}
          </span>
        </div>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-[#1A1814]/60">
        {copy.step2_meta}
      </p>
    </div>
  );
}

// ─── Step 3 — Steadii learns ──────────────────────────────────────────────
function Step3({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`md:col-span-1 rounded-[10px] border border-[#8579A8]/30 bg-[#8579A8]/[0.05] p-3.5 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <InboxIcon size={11} strokeWidth={1.6} className="text-[#1A1814]/45" />
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#8579A8]">
          {copy.step3_label}
        </p>
      </div>

      {/* Same sender, similar subject — but now surfaces for review with
          confidence-down annotation. */}
      <div className="mt-2.5 rounded-md border border-black/[0.06] bg-white px-2.5 py-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-4 items-center rounded-full bg-[#FAFAF9] px-1.5 font-mono text-[9px] uppercase tracking-wider text-[#1A1814]/55">
            {copy.step3_chip_tier}
          </span>
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#1A1814]">
            {copy.step3_sender}
          </span>
          <span className="font-mono text-[9px] tabular-nums text-[#1A1814]/40">
            {copy.step3_chip_time}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[11px] text-[#1A1814]/65">
          {copy.step3_subject}
        </p>
      </div>

      <div className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2 py-1.5 text-[11px] text-amber-800">
        <ArrowDown size={11} strokeWidth={2} />
        <span className="font-medium">{copy.step3_status}</span>
      </div>

      <p className="mt-1.5 text-[11px] leading-snug text-[#1A1814]/65">
        {copy.step3_meta}
      </p>
    </div>
  );
}

// ─── Connector arrow between steps ────────────────────────────────────────
function StepArrow({ active }: { active: boolean }) {
  // Visual continuity beat between phases. Hidden in the grid on md+ where
  // the steps stack into 3 columns with no inline arrow column — the grid
  // template skips this child via the reordering below. On mobile the grid
  // collapses into a single column and the arrow becomes a vertical chevron
  // between cards.
  return (
    <div
      aria-hidden
      className={`flex items-center justify-center text-[#1A1814]/35 transition-opacity duration-500 md:hidden ${
        active ? "opacity-100" : "opacity-0"
      }`}
    >
      <ArrowDown size={14} strokeWidth={1.5} />
    </div>
  );
}
