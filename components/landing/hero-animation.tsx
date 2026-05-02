"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Inbox,
  Home,
  MessagesSquare,
  GraduationCap,
  Calendar as CalendarIcon,
  ListChecks,
  ArrowUp,
  FileText,
  Loader2,
  MousePointer2,
} from "lucide-react";
import { Logo } from "@/components/layout/logo";

// We dropped the `motion` package after install: motion/react v12 hooks
// didn't kick in under Next 16 + Turbopack + React 19 — components mounted
// at their `initial` state and never animated. CSS transitions on Tailwind
// classes are the established pattern in this repo (see
// app/(marketing)/_components/proactive-mock.tsx) and behave reliably.

type Phase =
  | "idle"
  | "pdfDragging"
  | "attached"
  | "extracting"
  | "extracted"
  | "classesUp"
  | "rowAdded"
  | "calendar"
  | "eventsFilled"
  | "hold";

const STEPS: Array<{ phase: Phase; delay: number }> = [
  { phase: "idle", delay: 1000 },
  { phase: "pdfDragging", delay: 1000 },
  { phase: "attached", delay: 1000 },
  { phase: "extracting", delay: 2000 },
  { phase: "extracted", delay: 1000 },
  { phase: "classesUp", delay: 1000 },
  { phase: "rowAdded", delay: 1000 },
  { phase: "calendar", delay: 1000 },
  { phase: "eventsFilled", delay: 3000 },
  { phase: "hold", delay: 1000 },
];

const PHASE_INDEX = STEPS.reduce(
  (acc, step, i) => {
    acc[step.phase] = i;
    return acc;
  },
  {} as Record<Phase, number>,
);

// D1 ease-out — short Linear/Vercel-style cubic, no overshoot.
const EASE = "cubic-bezier(0.16,1,0.3,1)";
const CLASS_BLUE = "#3B82F6";
const ACCENT_AMBER = "#F59E0B";

const SIDEBAR_ICONS = [
  Inbox,
  Home,
  MessagesSquare,
  GraduationCap,
  CalendarIcon,
  ListChecks,
];

type ExistingClassKey = "eng200" | "bio110" | "psy100" | "hst101";
const EXISTING_CLASSES: Array<{ key: ExistingClassKey; color: string }> = [
  { key: "eng200", color: "#A78BFA" },
  { key: "bio110", color: "#34D399" },
  { key: "psy100", color: "#F472B6" },
  { key: "hst101", color: "#FACC15" },
];

type EventKey = "math_lec" | "math_tut" | "math_quiz" | "hw1_due";
const CALENDAR_EVENTS: Array<{ day: number; top: number; key: EventKey }> = [
  { day: 0, top: 14, key: "math_lec" },
  { day: 1, top: 50, key: "math_tut" },
  { day: 2, top: 14, key: "math_lec" },
  { day: 3, top: 50, key: "math_tut" },
  { day: 4, top: 14, key: "math_lec" },
  { day: 4, top: 64, key: "math_quiz" },
  { day: 0, top: 84, key: "hw1_due" },
];

export default function HeroAnimation() {
  const [reduced, setReduced] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (reduced) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const run = (i: number) => {
      if (cancelled) return;
      setPhase(STEPS[i].phase);
      timer = setTimeout(() => run((i + 1) % STEPS.length), STEPS[i].delay);
    };
    run(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reduced]);

  if (reduced) {
    return (
      <div
        className="relative aspect-[16/10] w-full overflow-hidden bg-[#FAFAF9] font-sans"
        data-testid="hero-animation-static"
      >
        <div className="absolute inset-0 flex">
          <Sidebar phase="hold" />
          <div className="relative flex-1 overflow-hidden">
            <CalendarView startEvents />
          </div>
        </div>
      </div>
    );
  }

  const idx = PHASE_INDEX[phase];
  const showClasses = idx >= PHASE_INDEX.classesUp && idx < PHASE_INDEX.calendar;
  const showCalendar = idx >= PHASE_INDEX.calendar;
  const startEvents = idx >= PHASE_INDEX.eventsFilled;

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#FAFAF9] font-sans">
      <div className="absolute inset-0 flex">
        <Sidebar phase={phase} />
        <div className="relative flex-1 overflow-hidden">
          <ChatPanel phase={phase} />
          {/* Classes overlay — slides up from bottom, slides back down on
              loop reset. Stays visually behind the calendar overlay during
              their cross-fade. */}
          <div
            aria-hidden={!showClasses}
            className="absolute inset-0 will-change-transform"
            style={{
              transition: `transform 220ms ${EASE}, opacity 180ms ${EASE}`,
              transform: showClasses ? "translateY(0%)" : "translateY(100%)",
              opacity: showCalendar ? 0 : 1,
              pointerEvents: showClasses ? "auto" : "none",
            }}
          >
            <ClassesView showNewRow={idx >= PHASE_INDEX.rowAdded} />
          </div>
          {/* Calendar overlay — cross-fades over classes, fades out on loop
              reset to reveal chat surface again. */}
          <div
            aria-hidden={!showCalendar}
            className="absolute inset-0"
            style={{
              transition: `opacity 220ms ${EASE}`,
              opacity: showCalendar ? 1 : 0,
              pointerEvents: showCalendar ? "auto" : "none",
            }}
          >
            <CalendarView startEvents={startEvents} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Sidebar({ phase }: { phase: Phase }) {
  const idx = PHASE_INDEX[phase];
  const activeIdx =
    idx >= PHASE_INDEX.calendar ? 4 : idx >= PHASE_INDEX.classesUp ? 3 : 1;
  return (
    <div className="flex w-[8%] min-w-[44px] flex-col items-center gap-1.5 border-r border-black/[0.05] bg-white py-4">
      <Logo size={18} className="mb-2" />
      {SIDEBAR_ICONS.map((Icon, i) => (
        <span
          key={i}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-200 ${
            i === activeIdx
              ? "bg-black/[0.05] text-[#1A1814]"
              : "text-[#1A1814]/40"
          }`}
        >
          <Icon size={13} strokeWidth={1.5} />
        </span>
      ))}
    </div>
  );
}

function ChatPanel({ phase }: { phase: Phase }) {
  const t = useTranslations("landing.hero_animation");
  const tExtra = useTranslations("hero_animation_extra");
  const idx = PHASE_INDEX[phase];
  const showFloatingPdf = phase === "pdfDragging";
  // Pill is visible only during the brief `attached` window — once the
  // cursor presses send (which happens at the attached → extracting
  // boundary), the pill collapses out and the input returns to its
  // empty/ready state, mirroring the real app.
  const attached = phase === "attached";
  const sendPulse = phase === "attached";
  const toolState: "extracting" | "extracted" | null =
    idx >= PHASE_INDEX.extracted && idx < PHASE_INDEX.classesUp
      ? "extracted"
      : idx >= PHASE_INDEX.extracting && idx < PHASE_INDEX.extracted
        ? "extracting"
        : null;
  const cursorVisible = idx <= PHASE_INDEX.attached;

  const cursorTarget =
    phase === "idle"
      ? { left: "50%", top: "48%" }
      : phase === "pdfDragging"
        ? { left: "30%", top: "82%" }
        : { left: "92%", top: "84%" };

  return (
    <div className="absolute inset-0 flex flex-col">
      <div className="flex items-center justify-between border-b border-black/[0.05] bg-white px-4 py-2.5">
        <span className="font-mono text-[9px] uppercase tracking-widest text-[#1A1814]/40">
          {t("chat_header")}
        </span>
        <span className="font-mono text-[9px] tracking-widest text-[#1A1814]/30">
          {tExtra("cmd_k")}
        </span>
      </div>
      <div className="relative flex-1 px-4 pt-4 pb-2">
        <ToolCard state={toolState} />
      </div>
      <ChatInput attached={attached} sendPulse={sendPulse} />
      <FloatingPdf visible={showFloatingPdf} />
      <div
        aria-hidden
        className="pointer-events-none absolute z-40"
        style={{
          left: cursorTarget.left,
          top: cursorTarget.top,
          opacity: cursorVisible ? 1 : 0,
          transition: `left 380ms ${EASE}, top 380ms ${EASE}, opacity 180ms ${EASE}`,
        }}
      >
        <MousePointer2
          size={16}
          strokeWidth={1.4}
          className="-translate-x-[3px] -translate-y-[2px] text-[#1A1814]/85"
          fill="white"
        />
      </div>
    </div>
  );
}

function ChatInput({
  attached,
  sendPulse,
}: {
  attached: boolean;
  sendPulse: boolean;
}) {
  const t = useTranslations("landing.hero_animation");
  const tExtra = useTranslations("hero_animation_extra");
  return (
    <div className="border-t border-black/[0.05] bg-white px-4 py-3">
      <div className="flex min-h-[40px] items-center gap-2 rounded-[10px] border border-black/[0.08] bg-white px-3 py-2 shadow-[0_2px_8px_-4px_rgba(20,20,40,0.05)]">
        <span
          className="inline-flex shrink-0 items-center gap-1 overflow-hidden rounded-full border border-black/[0.08] bg-[#FAFAF9] text-[10px] text-[#1A1814]/75"
          style={{
            transition: `max-width 220ms ${EASE}, opacity 180ms ${EASE}, padding 180ms ${EASE}, border-color 180ms ${EASE}`,
            maxWidth: attached ? "240px" : "0px",
            opacity: attached ? 1 : 0,
            paddingLeft: attached ? "8px" : "0px",
            paddingRight: attached ? "8px" : "0px",
            paddingTop: attached ? "2px" : "0px",
            paddingBottom: attached ? "2px" : "0px",
            borderColor: attached ? undefined : "transparent",
          }}
        >
          <FileText size={10} strokeWidth={1.6} />
          <span className="whitespace-nowrap">
            {tExtra("syllabus_filename")}
          </span>
        </span>
        <span
          className="flex-1 truncate text-[12px] text-[#1A1814]/30"
          style={{ opacity: attached ? 0 : 1, transition: `opacity 180ms ${EASE}` }}
        >
          {t("message_placeholder")}
        </span>
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-[#0A0A0A] text-white"
          style={{
            transform: sendPulse ? "scale(1.18)" : "scale(1)",
            transition: `transform 220ms ${EASE}`,
          }}
        >
          <ArrowUp size={11} strokeWidth={2} />
        </span>
      </div>
    </div>
  );
}

function FloatingPdf({ visible }: { visible: boolean }) {
  const tExtra = useTranslations("hero_animation_extra");
  return (
    <div
      aria-hidden={!visible}
      className="pointer-events-none absolute z-30"
      style={{
        left: visible ? "18%" : "44%",
        top: visible ? "76%" : "44%",
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.9)",
        transition: `left 480ms ${EASE}, top 480ms ${EASE}, opacity 180ms ${EASE}, transform 220ms ${EASE}`,
      }}
    >
      <div className="flex items-center gap-1.5 rounded-[8px] border border-black/[0.08] bg-white px-2.5 py-1.5 shadow-[0_8px_22px_-6px_rgba(20,20,40,0.18)]">
        <FileText size={12} strokeWidth={1.6} className="text-[#1A1814]/55" />
        <span className="font-mono text-[10px] text-[#1A1814]">
          {tExtra("syllabus_filename")}
        </span>
      </div>
    </div>
  );
}

function ToolCard({ state }: { state: "extracting" | "extracted" | null }) {
  const t = useTranslations("landing.hero_animation");
  const visible = state !== null;
  return (
    <div
      aria-hidden={!visible}
      className="rounded-[10px] border border-black/[0.06] bg-white px-3 py-2.5 shadow-[0_2px_12px_-6px_rgba(20,20,40,0.1)]"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(6px)",
        transition: `opacity 180ms ${EASE}, transform 220ms ${EASE}`,
      }}
    >
      {/* Both states stay mounted; opacity-cross-fade picks one. The card
          takes the height of the (taller) extracted state, so the morph
          reads as a content swap rather than a height jump. */}
      <div className="relative">
        <div
          className="flex items-center gap-2"
          style={{
            opacity: state === "extracting" ? 1 : 0,
            transition: `opacity 180ms ${EASE}`,
          }}
        >
          <Loader2
            size={12}
            strokeWidth={1.6}
            className={`text-[#1A1814]/55 ${
              state === "extracting" ? "animate-spin" : ""
            }`}
          />
          <span className="font-mono text-[11px] text-[#1A1814]/70">
            {t("extracting")}
          </span>
        </div>
        <p
          className="absolute inset-0 font-mono text-[11px] leading-[1.55] text-[#1A1814]/85"
          style={{
            opacity: state === "extracted" ? 1 : 0,
            transition: `opacity 180ms ${EASE}`,
          }}
        >
          {t.rich("imported_summary", {
            highlight: (chunks) => (
              <span className="text-[#1A1814]">{chunks}</span>
            ),
          })}
        </p>
      </div>
    </div>
  );
}

function ClassesView({ showNewRow }: { showNewRow: boolean }) {
  const t = useTranslations("landing.hero_animation");
  const tClasses = useTranslations("landing.hero_animation.classes");
  return (
    <div className="absolute inset-0 flex flex-col bg-[#FAFAF9] px-6 py-5">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold tracking-tight text-[#1A1814]">
          {t("classes_heading")}
        </h3>
        <span className="font-mono text-[9px] uppercase tracking-widest text-[#1A1814]/40">
          {showNewRow ? "5" : "4"}
        </span>
      </div>
      <p className="mb-3 text-[10px] text-[#1A1814]/45">{t("term_label")}</p>
      <ul className="space-y-1.5">
        <li
          key="new"
          className="overflow-hidden"
          style={{
            maxHeight: showNewRow ? "60px" : "0px",
            opacity: showNewRow ? 1 : 0,
            transform: showNewRow ? "translateY(0)" : "translateY(-4px)",
            transition: `max-height 280ms ${EASE}, opacity 220ms ${EASE}, transform 220ms ${EASE}`,
          }}
        >
          <ClassRow
            label={tClasses("new")}
            color={CLASS_BLUE}
            pulse={showNewRow}
          />
        </li>
        {EXISTING_CLASSES.map((c) => (
          <li key={c.key}>
            <ClassRow label={tClasses(c.key)} color={c.color} dim />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ClassRow({
  label,
  color,
  pulse = false,
  dim = false,
}: {
  label: string;
  color: string;
  pulse?: boolean;
  dim?: boolean;
}) {
  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-[8px] border border-black/[0.05] bg-white px-3 py-2 ${
        dim ? "opacity-70" : ""
      }`}
    >
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span
        className={`text-[11px] ${dim ? "text-[#1A1814]/55" : "text-[#1A1814]"}`}
      >
        {label}
      </span>
      {pulse ? (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[8px] hero-amber-pulse"
        />
      ) : null}
    </div>
  );
}

function CalendarView({ startEvents }: { startEvents: boolean }) {
  const t = useTranslations("landing.hero_animation");
  const tEvents = useTranslations("landing.hero_animation.events");
  const days = (t.raw("days") as string[]) ?? [];
  return (
    <div className="absolute inset-0 flex flex-col bg-[#FAFAF9] px-6 py-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[15px] font-semibold tracking-tight text-[#1A1814]">
          {t("calendar_heading")}
        </h3>
        <span className="font-mono text-[9px] uppercase tracking-widest text-[#1A1814]/40">
          {t("week_range")}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1 border-b border-black/[0.06] pb-1.5">
        {days.map((d, i) => (
          <span
            key={i}
            className="font-mono text-[9px] uppercase tracking-widest text-[#1A1814]/45"
          >
            {d}
          </span>
        ))}
      </div>
      <div className="relative mt-2 flex-1 overflow-hidden">
        <div aria-hidden className="absolute inset-0 grid grid-cols-7 gap-1">
          {days.map((_d, i) => (
            <div key={i} className="relative">
              {[0.25, 0.5, 0.75].map((p) => (
                <span
                  key={p}
                  className="absolute left-0 right-0 border-t border-dashed border-black/[0.06]"
                  style={{ top: `${p * 100}%` }}
                />
              ))}
            </div>
          ))}
        </div>
        {CALENDAR_EVENTS.map((evt, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              left: `calc(${(evt.day / 7) * 100}% + 2px)`,
              width: `calc(${(1 / 7) * 100}% - 4px)`,
              top: `${evt.top}%`,
              opacity: startEvents ? 1 : 0,
              transform: startEvents ? "translateY(0)" : "translateY(4px)",
              transition: `opacity 180ms ${EASE} ${i * 0.4}s, transform 220ms ${EASE} ${i * 0.4}s`,
            }}
          >
            <div
              className="flex items-center gap-1 rounded-[5px] border-l-2 px-1.5 py-1 text-[9px] leading-tight text-[#1A1814]"
              style={{
                borderLeftColor: CLASS_BLUE,
                backgroundColor: `${CLASS_BLUE}14`,
              }}
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: CLASS_BLUE }}
              />
              <span className="truncate">{tEvents(evt.key)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
