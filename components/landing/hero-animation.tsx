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
  Mail,
  AlertTriangle,
  Sparkles,
  Settings as SettingsIcon,
  Clock,
  X,
} from "lucide-react";
import { Logo } from "@/components/layout/logo";

// We dropped the `motion` package after install: motion/react v12 hooks
// didn't kick in under Next 16 + Turbopack + React 19 — components mounted
// at their `initial` state and never animated. CSS transitions on Tailwind
// classes are the established pattern in this repo (see
// app/(marketing)/_components/proactive-mock.tsx) and behave reliably.

type Phase =
  | "idle"
  | "typing"
  | "send"
  | "clear"
  | "cardIn"
  | "hold"
  | "fadeOut";

const STEPS: Array<{ phase: Phase; delay: number }> = [
  { phase: "idle", delay: 1500 },
  { phase: "typing", delay: 3500 },
  { phase: "send", delay: 500 },
  { phase: "clear", delay: 700 },
  { phase: "cardIn", delay: 1000 },
  { phase: "hold", delay: 5000 },
  { phase: "fadeOut", delay: 800 },
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
const ACCENT_AMBER = "#F59E0B";
const ACCENT_BLUE = "#3B82F6";

const SIDEBAR_ICONS = [
  Home,
  Inbox,
  CalendarIcon,
  ListChecks,
  GraduationCap,
  MessagesSquare,
  SettingsIcon,
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
    // Static frame — show the most informative phase (card visible) so the
    // value of the demo carries even when motion is disabled.
    return (
      <div
        className="relative aspect-[16/10] w-full overflow-hidden bg-[#FAFAF9] font-sans"
        data-testid="hero-animation-static"
      >
        <div className="absolute inset-0 flex">
          <Sidebar />
          <HomeShell phase="hold" />
        </div>
      </div>
    );
  }

  return (
    <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#FAFAF9] font-sans">
      <div className="absolute inset-0 flex">
        <Sidebar />
        <HomeShell phase={phase} />
      </div>
    </div>
  );
}

function Sidebar() {
  const t = useTranslations("landing.hero_animation");
  const labels = [
    t("nav_home"),
    t("nav_inbox"),
    t("nav_calendar"),
    t("nav_classes"),
    t("nav_chats"),
    t("nav_settings"),
  ];
  // Home is index 0 and stays active throughout the loop — the demo never
  // navigates away from the surface that contains the queue.
  return (
    <div className="flex w-[8%] min-w-[44px] flex-col items-center gap-1.5 border-r border-black/[0.05] bg-white py-4">
      <Logo size={18} className="mb-2" />
      {SIDEBAR_ICONS.map((Icon, i) => (
        <span
          key={i}
          aria-label={labels[i] ?? ""}
          className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors duration-200 ${
            i === 0
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

function HomeShell({ phase }: { phase: Phase }) {
  const t = useTranslations("landing.hero_animation");
  const tExtra = useTranslations("hero_animation_extra");
  const idx = PHASE_INDEX[phase];
  const showCard = idx >= PHASE_INDEX.cardIn && idx < PHASE_INDEX.fadeOut;
  const fadingOut = phase === "fadeOut";
  // Briefing line muted while the card is on screen so the eye lands on the
  // pre-brief card.
  const briefingMuted = idx >= PHASE_INDEX.cardIn && idx < PHASE_INDEX.fadeOut;

  return (
    <div className="absolute inset-0 right-0 left-[8%] flex flex-col">
      {/* Top app strip — mirrors the production /app shell's chrome. */}
      <div className="flex items-center justify-between border-b border-black/[0.05] bg-white px-4 py-2.5">
        <span className="font-mono text-[9px] uppercase tracking-widest text-[#1A1814]/40">
          {t("app_header")}
        </span>
        <span className="font-mono text-[9px] tracking-widest text-[#1A1814]/30">
          {tExtra("cmd_k")}
        </span>
      </div>

      <div className="relative flex-1 overflow-hidden px-6 pt-5 pb-4 md:px-10">
        {/* Greeting */}
        <h2 className="text-[18px] font-semibold tracking-tight text-[#1A1814]">
          {t("greeting")}
        </h2>
        <p className="mt-0.5 text-[11px] text-[#1A1814]/55">
          {t("summary_ready")}
        </p>

        {/* Command palette — docked, animated. */}
        <div className="mt-4">
          <CommandPalette phase={phase} />
        </div>

        {/* Today briefing — single-line, ALWAYS visible (mirrors how
            TodayBriefing sits below the palette on the real Home). Dims when
            the pre-brief card materializes so the eye lands there. */}
        <div
          className="mt-4 transition-opacity duration-300"
          style={{ opacity: briefingMuted ? 0.5 : 1 }}
        >
          <BriefingRow />
        </div>

        {/* Pre-brief card — slides up from below the palette during cardIn,
            holds, then fades out before the loop resets. */}
        <div
          aria-hidden={!showCard && !fadingOut}
          className="mt-3 will-change-transform"
          style={{
            transition: `opacity 380ms ${EASE}, transform 380ms ${EASE}`,
            opacity: showCard ? 1 : 0,
            transform: showCard ? "translateY(0)" : "translateY(8px)",
          }}
        >
          <PreBriefCard />
        </div>
      </div>
    </div>
  );
}

function CommandPalette({ phase }: { phase: Phase }) {
  const t = useTranslations("landing.hero_animation");
  const tExtra = useTranslations("hero_animation_extra");
  const fullQuery = t("palette_typing_query");

  // Phase → (clip-path, transition) for the typed query. The query lives in
  // a SINGLE element across phases (no React key change) so the browser
  // sees the clip-path delta and runs the transition. During typing we
  // open clip-path linearly over 3300ms so characters reveal left-to-right.
  // The clear phase snaps it shut so the next loop starts clean.
  const queryClip =
    phase === "idle" || phase === "fadeOut"
      ? "inset(0 100% 0 0)" // closed
      : phase === "clear"
        ? "inset(0 100% 0 0)" // re-closing
        : "inset(0 0 0 0)"; // open
  const queryTransition =
    phase === "typing"
      ? `clip-path 3300ms linear, opacity 200ms ${EASE}`
      : `clip-path 250ms ${EASE}, opacity 200ms ${EASE}`;
  // Query is visible from the moment typing begins through the send pulse;
  // clear, idle, cardIn+ all hide it so the input feels reset.
  const showQueryText = phase === "typing" || phase === "send";
  const placeholderVisible = !showQueryText;
  const sendPulse = phase === "send";

  return (
    <div className="relative">
      <div className="flex h-10 items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-3 shadow-[0_2px_8px_-4px_rgba(20,20,40,0.05)]">
        <span className="font-mono text-[11px] text-[#1A1814]/40">⌘</span>
        <div className="relative flex h-full min-w-0 flex-1 items-center overflow-hidden">
          {/* Placeholder — fades when the query starts typing, returns after clear. */}
          <span
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center text-[12px] text-[#1A1814]/40"
            style={{
              opacity: placeholderVisible ? 1 : 0,
              transition: `opacity 180ms ${EASE}`,
            }}
          >
            {t("palette_placeholder")}
          </span>
          {/* Typed query — clip-path reveals characters left-to-right during
              the typing phase. Stable DOM node across phases so the browser
              animates the clip-path delta. */}
          <span
            className="absolute inset-y-0 left-0 flex items-center whitespace-nowrap text-[12px] text-[#1A1814]"
            style={{
              opacity: showQueryText ? 1 : 0,
              clipPath: queryClip,
              transition: queryTransition,
            }}
          >
            {fullQuery}
          </span>
        </div>
        <span
          aria-hidden
          className="hidden shrink-0 rounded-md border border-black/[0.08] bg-[#FAFAF9] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-[#1A1814]/40 sm:inline-flex"
        >
          {tExtra("cmd_k")}
        </span>
        <span
          className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#0A0A0A] text-white"
          style={{
            transform: sendPulse ? "scale(1.18)" : "scale(1)",
            transition: `transform 220ms ${EASE}`,
          }}
        >
          <ArrowUp size={12} strokeWidth={2} />
        </span>
      </div>
    </div>
  );
}

function BriefingRow() {
  const t = useTranslations("landing.hero_animation");
  return (
    <div className="flex items-center gap-2 rounded-xl border border-black/[0.05] bg-white px-3 py-2">
      <span className="font-mono text-[9px] uppercase tracking-widest text-[#1A1814]/45">
        {t("briefing_label")}
      </span>
      <span
        aria-hidden
        className="h-3 w-px bg-black/[0.08]"
      />
      <CalendarIcon size={11} strokeWidth={1.6} className="text-[#1A1814]/45" />
      <span className="text-[11px] text-[#1A1814]/75">
        {t("briefing_event")}
      </span>
    </div>
  );
}

function PreBriefCard() {
  const t = useTranslations("landing.hero_animation");
  return (
    <article
      data-archetype="B"
      data-mode="informational"
      className="rounded-2xl border border-black/[0.08] bg-white p-3.5 shadow-[0_4px_18px_-8px_rgba(20,20,40,0.10)]"
      style={{ borderLeft: `3px solid ${ACCENT_AMBER}` }}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span
            aria-hidden
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#FAFAF9]"
          >
            <CalendarIcon
              size={12}
              strokeWidth={1.75}
              style={{ color: ACCENT_BLUE }}
            />
          </span>
          <h3 className="truncate text-[12px] font-semibold text-[#1A1814]">
            {t("card_title")}
          </h3>
        </div>
        <span
          aria-hidden
          className="inline-flex items-center gap-1 font-mono text-[9px] tabular-nums text-[#1A1814]/45"
        >
          <Clock size={10} strokeWidth={1.6} />
          {t("card_eta")}
        </span>
      </header>
      <p className="mt-1 text-[11px] text-[#1A1814]/65">{t("card_body")}</p>
      <ul className="mt-2 flex flex-col gap-1 rounded-lg border border-black/[0.05] bg-[#FAFAF9] px-2.5 py-2">
        <BriefBullet text={t("card_bullet_1")} />
        <BriefBullet text={t("card_bullet_2")} />
        <BriefBullet text={t("card_bullet_3")} />
      </ul>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="inline-flex h-7 items-center rounded-full border border-black/[0.08] bg-white px-3 text-[11px] font-medium text-[#1A1814]"
        >
          {t("card_action_open_calendar")}
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          className="inline-flex h-7 items-center gap-1 rounded-full bg-[#0A0A0A] px-3 text-[11px] font-medium text-white"
        >
          <Sparkles size={10} strokeWidth={2} />
          {t("card_action_mark_reviewed")}
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          aria-label={t("card_dismiss_aria")}
          className="ml-auto inline-flex h-7 items-center rounded-full px-1.5 text-[#1A1814]/55"
        >
          <X size={11} strokeWidth={1.6} />
        </button>
      </div>
      <footer className="mt-2 flex flex-wrap items-center gap-1 border-t border-black/[0.05] pt-2">
        <SourceChip
          icon={Mail}
          text={t("chip_email")}
          tone="email"
        />
        <SourceChip
          icon={AlertTriangle}
          text={t("chip_mistake")}
          tone="mistake"
        />
        <SourceChip
          icon={CalendarIcon}
          text={t("chip_calendar")}
          tone="calendar"
        />
      </footer>
    </article>
  );
}

function BriefBullet({ text }: { text: string }) {
  return (
    <li className="flex gap-1.5 text-[11px] leading-snug text-[#1A1814]">
      <span
        aria-hidden
        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#1A1814]/40"
      />
      <span>{text}</span>
    </li>
  );
}

function SourceChip({
  icon: Icon,
  text,
  tone,
}: {
  icon: typeof Mail;
  text: string;
  tone: "email" | "mistake" | "calendar";
}) {
  const palette = {
    email: "border-black/[0.08] bg-[#FAFAF9] text-[#1A1814]/65",
    mistake: "border-amber-400/30 bg-amber-400/10 text-amber-700",
    calendar: "border-sky-400/30 bg-sky-400/10 text-sky-700",
  }[tone];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 font-mono text-[9px] ${palette}`}
    >
      <Icon size={9} strokeWidth={1.75} />
      {text}
    </span>
  );
}
