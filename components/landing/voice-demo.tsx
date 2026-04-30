// Pure CSS, no JS, no audio, no `getUserMedia`. Loops the Phase 1
// hold-to-talk flow visually so first-visit landing readers grasp the
// "hold Caps Lock → speak → cleaned text appears" interaction without
// ever being prompted for mic access. Per project_voice_input.md:
// landing must NEVER request microphone permission.
//
// 6s loop, staged in app/globals.css:
//   0-1s   Caps key idle, border calm
//   1-3s   Caps pressed, holographic border, "Listening…" placeholder
//   3-4s   Border tints amber, "Processing…" briefly visible
//   4-5s   Characters snake in from outside-left along a wavy path
//   5-6s   All settled, then fade to reset
import type { CSSProperties } from "react";

const DEMO_TEXT = "MAT223 のレポート due tomorrow";

export function VoiceDemo() {
  const chars = Array.from(DEMO_TEXT);
  return (
    <div className="mx-auto mt-10 max-w-2xl px-4 md:mt-12">
      <div className="relative mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-black/5 bg-white/55 px-4 py-3 shadow-[0_18px_48px_-24px_rgba(20,20,40,0.18)] backdrop-blur-sm">
        <span
          aria-hidden
          className="voice-demo-key flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-black/10 bg-white font-mono text-[10px] font-medium uppercase tracking-wider text-[#1A1814]/70 shadow-[0_1px_0_rgba(0,0,0,0.06),0_2px_6px_-2px_rgba(20,20,40,0.10)]"
        >
          ⇪ Caps
        </span>
        <div className="relative h-[34px] flex-1 overflow-hidden rounded-lg border border-black/10 bg-white/80">
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
              Listening
              <span className="voice-demo-dots inline-flex gap-[3px]" aria-hidden>
                <span className="inline-block h-1 w-1 rounded-full bg-current" />
                <span className="inline-block h-1 w-1 rounded-full bg-current" />
                <span className="inline-block h-1 w-1 rounded-full bg-current" />
              </span>
            </span>
            <span className="voice-demo-processing col-start-1 row-start-1 flex items-center italic text-[#1A1814]/55">
              Processing…
            </span>
            <span className="voice-demo-text-wrap col-start-1 row-start-1 flex items-center whitespace-nowrap leading-none">
              {chars.map((ch, i) => (
                <span
                  key={i}
                  aria-hidden
                  className="voice-demo-char inline-block"
                  style={{ "--i": i } as CSSProperties}
                >
                  {ch === " " ? " " : ch}
                </span>
              ))}
              <span
                aria-hidden
                className="voice-demo-cursor ml-[2px] inline-block h-[1em] w-[1px] bg-[#1A1814]/60"
              />
            </span>
            {/* Accessible text for SR — visual layer is aria-hidden */}
            <span className="sr-only">{DEMO_TEXT}</span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[13px] text-[#1A1814]/70">
        Hold Caps Lock to talk
      </p>
    </div>
  );
}
