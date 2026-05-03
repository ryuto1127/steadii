"use client";

import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { CascadeArcs } from "@/components/landing/visual/cascade-arcs";
import { Waveform } from "@/components/landing/visual/waveform";

// Voice-demo loop pulled from Claude Design's HeroVoiceDemo. A microphone
// chip + transcribing text + waveform sits inside a holo-bordered chat
// box; once the phrase finishes typing the materializing draft card
// fades in below. Cycles indefinitely.
//
// Phases: listening → transcribing → drafting → done → reset
//
// Honors prefers-reduced-motion: shows the final-state composition
// statically (full text + draft visible, no caret blink). Implemented in
// pure CSS-driven setInterval since motion/react failed under Next 16 +
// Turbopack + React 19 (see existing components/landing/hero-animation.tsx
// rationale).

type Phase = "listening" | "transcribing" | "drafting" | "done";

type Copy = {
  ariaLabel: string;
  fullPhrase: string;
  listening: string;
  transcribing: string;
  drafting: string;
  done: string;
  // Draft card mock copy
  draft_eyebrow: string;
  draft_title: string;
  draft_subject: string;
  draft_body: string;
  draft_send: string;
  draft_review: string;
  draft_skip: string;
  draft_origin: string;
  draft_time: string;
  fontJa: boolean;
};

export function HeroVoiceDemo({ copy }: { copy: Copy }) {
  const [chars, setChars] = useState(0);
  const [phase, setPhase] = useState<Phase>("listening");
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion) {
      setChars(copy.fullPhrase.length);
      setPhase("done");
      return;
    }
    let typeId: ReturnType<typeof setInterval> | undefined;
    let listeningTimer: ReturnType<typeof setTimeout> | undefined;
    let draftingTimer: ReturnType<typeof setTimeout> | undefined;
    let doneTimer: ReturnType<typeof setTimeout> | undefined;
    let restartTimer: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      setChars(0);
      setPhase("listening");
      listeningTimer = setTimeout(() => setPhase("transcribing"), 700);
      let i = 0;
      typeId = setInterval(() => {
        i++;
        setChars(i);
        if (i >= copy.fullPhrase.length) {
          if (typeId) clearInterval(typeId);
          draftingTimer = setTimeout(() => setPhase("drafting"), 350);
          doneTimer = setTimeout(() => setPhase("done"), 1500);
          restartTimer = setTimeout(tick, 5500);
        }
      }, 32);
    };

    tick();

    return () => {
      if (typeId) clearInterval(typeId);
      if (listeningTimer) clearTimeout(listeningTimer);
      if (draftingTimer) clearTimeout(draftingTimer);
      if (doneTimer) clearTimeout(doneTimer);
      if (restartTimer) clearTimeout(restartTimer);
    };
  }, [copy.fullPhrase, reducedMotion]);

  const phaseLabel =
    phase === "listening"
      ? copy.listening
      : phase === "transcribing"
        ? copy.transcribing
        : phase === "drafting"
          ? copy.drafting
          : copy.done;

  return (
    <div
      className="relative grid h-[460px] w-full place-items-center"
      aria-label={copy.ariaLabel}
    >
      <CascadeArcs />

      <div
        className="holo-border absolute"
        style={{
          left: 24,
          right: 24,
          top: 60,
          background: "var(--bg-raised)",
          borderRadius: "var(--r-3)",
          padding: "16px 18px",
          boxShadow: "var(--shadow-3)",
          zIndex: 2,
        }}
      >
        <div className="mb-2.5 flex items-center gap-2">
          <span
            className="grid h-[22px] w-[22px] place-items-center rounded-full"
            style={{
              background: "color-mix(in oklch, var(--critical) 14%, white)",
              color: "var(--critical)",
            }}
          >
            <Mic size={11} strokeWidth={2.2} />
          </span>
          <span
            className="text-[11.5px] font-medium"
            style={{ color: "var(--ink-3)" }}
          >
            {phaseLabel}
          </span>
          <span className="flex-1" />
          <Waveform active={phase !== "done"} />
        </div>
        <div
          className="min-h-[56px] text-[15px] leading-[1.5]"
          style={{
            color: "var(--ink-1)",
            fontFamily: copy.fontJa ? "var(--font-jp)" : "var(--font-sans)",
            letterSpacing: "-0.005em",
          }}
        >
          {copy.fullPhrase.slice(0, chars)}
          {chars < copy.fullPhrase.length && phase !== "done" && (
            <span
              className="landing-caret inline-block align-[-3px]"
              style={{
                width: 8,
                height: 18,
                background: "var(--ink-1)",
                marginLeft: 2,
              }}
            />
          )}
        </div>
      </div>

      <div
        className="absolute z-[3]"
        style={{
          left: 48,
          right: 48,
          bottom: 24,
          opacity: phase === "done" ? 1 : 0,
          transform:
            phase === "done" ? "translateY(0)" : "translateY(12px)",
          transition: "all 600ms cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <DraftCard copy={copy} />
      </div>
    </div>
  );
}

function DraftCard({ copy }: { copy: Copy }) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--bg-raised)",
        border: "1px solid var(--line-strong)",
        borderRadius: "var(--r-3)",
        padding: "16px 18px 14px 22px",
        boxShadow: "var(--shadow-1)",
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 12,
          bottom: 12,
          width: 4,
          borderRadius: 4,
          background: "var(--gradient-holo)",
        }}
      />
      <div className="mb-1">
        <div
          className="text-[10.5px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: "var(--ink-4)" }}
        >
          {copy.draft_eyebrow}
        </div>
      </div>
      <div className="flex items-center gap-2.5">
        <span
          className="grid h-[24px] w-[24px] flex-shrink-0 place-items-center rounded-[7px]"
          style={{
            background: "color-mix(in oklch, var(--info) 12%, white)",
            color: "var(--info)",
          }}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M3 10l14-6-6 14-2-6z" />
          </svg>
        </span>
        <div
          className="text-[14.5px] font-medium leading-[1.35]"
          style={{
            color: "var(--ink-1)",
            letterSpacing: "-0.005em",
            fontFamily: copy.fontJa ? "var(--font-jp)" : "var(--font-sans)",
          }}
        >
          {copy.draft_title}
        </div>
      </div>
      <div
        className="ml-[34px] mt-2.5 rounded-r-lg px-3 py-2.5"
        style={{
          background: "var(--bg-sunken)",
          borderLeft: "2px solid var(--info)",
          fontSize: "12.5px",
          color: "var(--ink-2)",
          lineHeight: 1.55,
          fontFamily: copy.fontJa ? "var(--font-jp)" : "var(--font-sans)",
        }}
      >
        <div
          className="mb-1 font-medium"
          style={{ color: "var(--ink-1)" }}
        >
          {copy.draft_subject}
        </div>
        <div
          className="overflow-hidden whitespace-pre-wrap"
          style={{
            maxHeight: 56,
            maskImage:
              "linear-gradient(to bottom, black 60%, transparent)",
            WebkitMaskImage:
              "linear-gradient(to bottom, black 60%, transparent)",
          }}
        >
          {copy.draft_body}
        </div>
      </div>
      <div className="ml-[34px] mt-3 flex items-center gap-2">
        <button
          className="inline-flex h-[28px] items-center rounded-[10px] bg-[#0c0d10] px-2.5 text-[13px] font-medium text-white"
          type="button"
        >
          {copy.draft_send}
        </button>
        <button
          className="inline-flex h-[28px] items-center rounded-[10px] border border-[var(--line-strong)] bg-[var(--bg-raised)] px-2.5 text-[13px] font-medium"
          style={{ color: "var(--ink-1)" }}
          type="button"
        >
          {copy.draft_review}
        </button>
        <button
          className="ml-auto inline-flex h-[28px] items-center rounded-[10px] px-2 text-[13px]"
          style={{ color: "var(--ink-3)" }}
          type="button"
        >
          {copy.draft_skip}
        </button>
      </div>
      <div
        className="mt-3 flex items-center gap-2 border-t border-dashed pt-2.5"
        style={{ borderColor: "var(--line)" }}
      >
        <span className="flex-1" />
        <span
          className="mono-num text-[11px]"
          style={{ color: "var(--ink-4)" }}
        >
          {copy.draft_time}
        </span>
        <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>
          {copy.draft_origin}
        </span>
      </div>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [prefers, setPrefers] = useState(false);
  const cleanedRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefers(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPrefers(e.matches);
    mq.addEventListener?.("change", onChange);
    cleanedRef.current = false;
    return () => {
      if (cleanedRef.current) return;
      cleanedRef.current = true;
      mq.removeEventListener?.("change", onChange);
    };
  }, []);
  return prefers;
}
