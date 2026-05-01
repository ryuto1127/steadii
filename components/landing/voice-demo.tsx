// Pure CSS, no JS, no audio, no `getUserMedia`. Demonstrates the voice
// cleanup pipeline visually so the reader grasps "noisy speech →
// AI cleans → clean text" without the demo ever asking for mic access.
// Per project_voice_input.md: landing must NEVER request mic permission.
//
// v4 (2026-04-30): voice is a SUB-feature of Steadii (per Ryuto's
// strategic call), so the demo is no longer the lead-of-page block.
// This component now ships a single chat box that cross-fades a noisy
// raw transcript into the cleaned form, with a caption that names the
// cleanup explicitly. Earlier wavy-textPath / cascade decorations
// (PR #99 → PR #105 → PR #108 → PR #109) all read as visual mess and
// are removed.
//
// 6s loop:
//   0-1.0s    Caps idle, border calm, chat box empty.
//   1.0-2.5s  Caps pressed, holographic border, "Listening…" with
//             pulsing dots.
//   2.5-3.3s  Border tints amber, "Processing…" briefly visible.
//   3.3-4.4s  Raw noisy transcript fades in ("uh, MAT223 report,
//             like, it's due tomorrow") in italic muted style.
//   4.4-5.4s  Cross-fade: raw fades out, cleaned ("MAT223 report
//             due tomorrow") fades in. Cursor blinks at end.
//   5.4-6.0s  Cleaned fades out, reset.
//
// The cross-fade IS the cleanup pipeline visualized: noisy in →
// cleaned out, in the same input field.
import { getTranslations } from "next-intl/server";

export async function VoiceDemo() {
  const t = await getTranslations("landing.voice_demo");

  return (
    <div className="voice-demo-wrap relative mx-auto mt-6 w-full max-w-xl px-4">
      <div className="relative mx-auto flex w-full items-center gap-3 rounded-2xl border border-black/5 bg-white/85 px-4 py-3 shadow-[0_18px_48px_-24px_rgba(20,20,40,0.18)] backdrop-blur-md">
        <span
          aria-hidden
          className="voice-demo-key flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-black/10 bg-white font-mono text-[10px] font-medium uppercase tracking-wider text-[#1A1814]/70 shadow-[0_1px_0_rgba(0,0,0,0.06),0_2px_6px_-2px_rgba(20,20,40,0.10)]"
        >
          ⇪ Caps
        </span>
        <div className="relative h-[34px] flex-1 overflow-hidden rounded-lg border border-black/10 bg-white/90">
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
              <span
                className="voice-demo-dots inline-flex gap-[3px]"
                aria-hidden
              >
                <span className="inline-block h-1 w-1 rounded-full bg-current" />
                <span className="inline-block h-1 w-1 rounded-full bg-current" />
                <span className="inline-block h-1 w-1 rounded-full bg-current" />
              </span>
            </span>
            <span className="voice-demo-processing col-start-1 row-start-1 flex items-center italic text-[#1A1814]/55">
              {t("processing")}
            </span>
            {/* Raw noisy transcript — what Whisper would emit. Italic +
                muted = "this is the raw input, not the final output". */}
            <span className="voice-demo-raw col-start-1 row-start-1 flex items-center overflow-hidden whitespace-nowrap italic leading-none text-[#1A1814]/50">
              {t("raw_phrase_1")}
            </span>
            {/* Cleaned form — what Steadii's GPT-5.4-nano cleanup pass
                produces. Cross-fades over the raw to visualize the
                cleanup. */}
            <span className="voice-demo-cleaned col-start-1 row-start-1 flex items-center overflow-hidden whitespace-nowrap leading-none">
              {t("cleaned_phrase")}
              <span
                aria-hidden
                className="voice-demo-cursor ml-[2px] inline-block h-[1em] w-[1px] bg-[#1A1814]/60"
              />
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-[13px] text-[#1A1814]/70">
        {t("hold_to_talk")}
      </p>
      <p className="mt-1 text-center text-[12px] text-[#1A1814]/45">
        {t("noise_hint")}
      </p>

      {/* Accessible plain text — the visual cycle is aria-hidden where
          decorative; the cleaned phrase is the canonical "demo content". */}
      <span className="sr-only">{t("cleaned_phrase")}</span>
    </div>
  );
}
