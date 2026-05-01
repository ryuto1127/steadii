// Pure CSS, no JS, no audio, no `getUserMedia`. Loops the Phase 1
// hold-to-talk flow visually so first-visit landing readers grasp the
// "hold Caps Lock → speak → cleaned text appears" interaction without
// ever being prompted for mic access. Per project_voice_input.md:
// landing must NEVER request microphone permission.
//
// 12s loop, staged in app/globals.css. Three academic sample phrases
// cascade along page-wide curved paths into the centered chat box —
// the visual scale (~30-50% of viewport width per arc) is set so the
// reader sees voice → text travel from the page edges into the box,
// not just a tiny snake from the box's edge.
//
//   0-3s    Phrase 1 (top-left arc, descending) reveals along its
//           curve from outside-left, settles inside the chat box.
//           The Caps key + holographic border + "Listening…" /
//           "Processing…" chrome fires ONCE here, gated to phrase 1.
//   3-4s    Phrase 1 fades; chat box stays visible.
//   4-7s    Phrase 2 (left-mid wave) reveals → settles → fades.
//   7-10s   Phrase 3 (bottom-left arc, rising) reveals → settles → fades.
//   10-12s  Pause + reset.
//
// The chars layer sits on a sibling overlay (z-[2]) above the chat
// box. The chat box keeps overflow-hidden for its holographic border +
// listening/processing states; the chars overlay stays
// overflow-visible so the curve start (~500-600px left of the chat
// box, well into the page-bleed canvas) is actually visible to the
// reader. The wrapper is widened to max-w-[1280px] for that purpose
// while the chat row itself stays max-w-xl — the visual story is
// "arcs from FAR outside the box, landing into the existing-size box".
import type { CSSProperties } from "react";
import { getTranslations } from "next-intl/server";

export async function VoiceDemo() {
  const t = await getTranslations("landing.voice_demo");
  const phrases = [t("phrase_1"), t("phrase_2"), t("phrase_3")];
  return (
    <div className="voice-demo-wrap relative mx-auto mt-10 w-full max-w-[1280px] px-4 md:mt-12">
      <div className="relative mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-black/5 bg-white/55 px-4 py-3 shadow-[0_18px_48px_-24px_rgba(20,20,40,0.18)] backdrop-blur-sm">
        <span
          aria-hidden
          className="voice-demo-key flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-black/10 bg-white font-mono text-[10px] font-medium uppercase tracking-wider text-[#1A1814]/70 shadow-[0_1px_0_rgba(0,0,0,0.06),0_2px_6px_-2px_rgba(20,20,40,0.10)]"
        >
          ⇪ Caps
        </span>
        {/* Positional shell for the chat box + chars stream overlay.
            overflow stays visible so the chars overlay can extend
            ~500-600px outside the chat box's left edge. */}
        <div className="relative h-[34px] flex-1">
          {/* Visual chat box — keeps overflow-hidden for the holographic
              border and the listening/processing fades. */}
          <div className="absolute inset-0 overflow-hidden rounded-lg border border-black/10 bg-white/80">
            <span
              aria-hidden
              className="voice-demo-border pointer-events-none absolute -inset-[2px] rounded-lg"
              style={{
                background:
                  "linear-gradient(120deg, #22D3EE 0%, #E879F9 50%, #A3E635 100%)",
                backgroundSize: "200% 200%",
                filter: "blur(6px)",
                zIndex: 0,
              }}
            />
            <span
              aria-hidden
              className="voice-demo-border-amber pointer-events-none absolute -inset-[2px] rounded-lg"
              style={{
                background:
                  "linear-gradient(120deg, #F59E0B 0%, #FBBF24 50%, #F59E0B 100%)",
                backgroundSize: "200% 200%",
                filter: "blur(6px)",
                zIndex: 0,
              }}
            />
            <div className="relative z-[1] grid h-full grid-cols-1 grid-rows-1 px-3 text-[14px] text-[#1A1814]">
              <span className="voice-demo-listening col-start-1 row-start-1 flex items-center gap-1 italic text-[#1A1814]/55">
                {t("listening")}
                <span className="voice-demo-dots inline-flex gap-[3px]" aria-hidden>
                  <span className="inline-block h-1 w-1 rounded-full bg-current" />
                  <span className="inline-block h-1 w-1 rounded-full bg-current" />
                  <span className="inline-block h-1 w-1 rounded-full bg-current" />
                </span>
              </span>
              <span className="voice-demo-processing col-start-1 row-start-1 flex items-center italic text-[#1A1814]/55">
                {t("processing")}
              </span>
            </div>
          </div>
          {/* Chars stream overlay — sits over the chat box but is NOT
              clipped by it. Three phrase spans share the same overlay
              and animate sequentially via per-phrase keyframes. Each
              phrase's chars use a distinct CSS offset-path that
              originates ~500-600px left of the chat box (visible page
              bleed) and terminates at the char's natural inline
              position inside the chat box's text padding. */}
          <div className="pointer-events-none absolute inset-y-0 left-0 right-0 z-[2] text-[14px] text-[#1A1814]">
            {phrases.map((phrase, pIdx) => (
              <span
                key={pIdx}
                className={`voice-demo-phrase voice-demo-phrase-${pIdx + 1} absolute inset-y-0 left-0 right-0 flex items-center pl-3 leading-none whitespace-nowrap`}
              >
                {Array.from(phrase).map((ch, i) => (
                  <span
                    key={i}
                    aria-hidden
                    className={`voice-demo-char voice-demo-char-${pIdx + 1} inline-block`}
                    style={{ "--i": i } as CSSProperties}
                  >
                    {ch === " " ? " " : ch}
                  </span>
                ))}
                {pIdx === 0 ? (
                  <span
                    aria-hidden
                    className="voice-demo-cursor ml-[2px] inline-block h-[1em] w-[1px] bg-[#1A1814]/60"
                  />
                ) : null}
              </span>
            ))}
          </div>
          {/* Accessible text — visual layer is aria-hidden. */}
          <span className="sr-only">{phrases[0]}</span>
        </div>
      </div>
      <p className="mt-3 text-center text-[13px] text-[#1A1814]/70">
        {t("hold_to_talk")}
      </p>
    </div>
  );
}
