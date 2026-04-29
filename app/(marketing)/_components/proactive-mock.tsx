"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar, Mail, AlertCircle, X, RefreshCcw } from "lucide-react";

type Copy = {
  step_calendar: string;
  step_calendar_meta: string;
  step_notification: string;
  step_notification_meta: string;
  step_proposal: string;
  step_proposal_meta: string;
  action_email: string;
  action_reschedule: string;
  action_dismiss: string;
};

// Each phase reveals at the same 1.8s cadence so the rhythm feels even.
// The mock plays exactly once on viewport entry and stays on phase 3 —
// looping the cycle was distracting on scroll-back, and the moat reveal
// is more powerful as a one-shot reveal that holds.
const STEPS = [1800, 1800, 1800] as const;

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
            radial-gradient(circle at 0% 0%, rgba(6, 182, 212, 0.06) 0%, transparent 40%),
            radial-gradient(circle at 100% 100%, rgba(124, 58, 237, 0.06) 0%, transparent 40%)
          `,
        }}
      />
      <div className="relative grid gap-3 md:grid-cols-[1fr_1.4fr]">
        <Phase1 copy={copy} active={phase >= 1} />
        <div className="flex flex-col gap-3">
          <Phase2 copy={copy} active={phase >= 2} />
          <Phase3 copy={copy} active={phase >= 3} />
        </div>
      </div>
    </div>
  );
}

function Phase1({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`rounded-[10px] border border-black/[0.06] bg-[#FAFAF9] p-3.5 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#1A1814]/50">
        {copy.step_calendar_meta}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Calendar
          size={14}
          strokeWidth={1.6}
          className="text-[#1A1814]/55"
        />
        <p className="text-[13px] text-[#1A1814]">{copy.step_calendar}</p>
      </div>
      <div className="mt-3 flex gap-1">
        <span className="h-2 flex-1 rounded-sm bg-[#7C3AED]/55" />
        <span className="h-2 flex-1 rounded-sm bg-[#7C3AED]/55" />
        <span className="h-2 flex-1 rounded-sm bg-[#7C3AED]/55" />
      </div>
    </div>
  );
}

function Phase2({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-[10px] border border-[#7C3AED]/30 bg-[#7C3AED]/[0.06] p-3.5 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
      }`}
    >
      <AlertCircle
        size={14}
        strokeWidth={1.6}
        className="mt-0.5 shrink-0 text-[#7C3AED]"
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-[#1A1814]">
          {copy.step_notification}
        </p>
        <p className="mt-0.5 text-[13px] text-[#1A1814]/65">
          {copy.step_notification_meta}
        </p>
      </div>
    </div>
  );
}

function Phase3({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`rounded-[10px] border border-black/[0.06] bg-[#FAFAF9] p-3.5 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-[#1A1814]/50">
        {copy.step_proposal}
      </p>
      <p className="mt-1 text-[13px] text-[#1A1814]/70">
        {copy.step_proposal_meta}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <ActionPill icon={Mail} label={copy.action_email} primary />
        <ActionPill icon={RefreshCcw} label={copy.action_reschedule} />
        <ActionPill icon={X} label={copy.action_dismiss} />
      </div>
    </div>
  );
}

function ActionPill({
  icon: Icon,
  label,
  primary = false,
}: {
  icon: typeof Mail;
  label: string;
  primary?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] ${
        primary
          ? "bg-[#0A0A0A] text-white"
          : "border border-black/[0.08] bg-white text-[#1A1814]/70"
      }`}
    >
      <Icon size={11} strokeWidth={1.6} />
      {label}
    </span>
  );
}
