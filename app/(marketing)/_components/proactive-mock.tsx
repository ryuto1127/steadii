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

const STEPS = [1800, 2400, 5500] as const; // dwell per phase — phase 3 (the multi-action proposal) needs longer to read
const PAUSE_MS = 2800;

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
          const cycle = () => {
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
            timers.push(window.setTimeout(cycle, cumulative + PAUSE_MS));
          };
          cycle();
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
      className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-4 shadow-sm md:p-6"
    >
      <div className="grid gap-3 md:grid-cols-[1fr_1.4fr]">
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
      className={`rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {copy.step_calendar_meta}
      </p>
      <div className="mt-2 flex items-center gap-2">
        <Calendar
          size={14}
          strokeWidth={1.5}
          className="text-[hsl(var(--muted-foreground))]"
        />
        <p className="text-small text-[hsl(var(--foreground))]">
          {copy.step_calendar}
        </p>
      </div>
      <div className="mt-3 flex gap-1">
        <span className="h-2 flex-1 rounded-sm bg-[hsl(var(--primary))] opacity-60" />
        <span className="h-2 flex-1 rounded-sm bg-[hsl(var(--primary))] opacity-60" />
        <span className="h-2 flex-1 rounded-sm bg-[hsl(var(--primary))] opacity-60" />
      </div>
    </div>
  );
}

function Phase2({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-md border border-[hsl(var(--primary))]/40 bg-[hsl(var(--primary))]/10 p-3 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
      }`}
    >
      <AlertCircle
        size={14}
        strokeWidth={1.5}
        className="mt-0.5 shrink-0 text-[hsl(var(--primary))]"
      />
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium text-[hsl(var(--foreground))]">
          {copy.step_notification}
        </p>
        <p className="mt-0.5 text-small text-[hsl(var(--muted-foreground))]">
          {copy.step_notification_meta}
        </p>
      </div>
    </div>
  );
}

function Phase3({ copy, active }: { copy: Copy; active: boolean }) {
  return (
    <div
      className={`rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] p-3 transition-all duration-500 ${
        active ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-widest text-[hsl(var(--muted-foreground))]">
        {copy.step_proposal}
      </p>
      <p className="mt-1 text-small text-[hsl(var(--muted-foreground))]">
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
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] ${
        primary
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]"
          : "border-[hsl(var(--border))] bg-[hsl(var(--surface))] text-[hsl(var(--muted-foreground))]"
      }`}
    >
      <Icon size={11} strokeWidth={1.5} />
      {label}
    </span>
  );
}
