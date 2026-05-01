// Pure CSS, no JS, no audio, no `getUserMedia`. Demonstrates the
// hold-to-talk flow visually so first-visit landing readers grasp the
// "hold Caps Lock → speak → cleaned text appears" interaction without
// ever being prompted for mic access. Per project_voice_input.md:
// landing must NEVER request microphone permission.
//
// v3.1 (2026-04-30): repositions the wavy decorative line BEHIND the
// chat box (vertical center aligned, opaque box obscures the wave it
// passes through) so the visual story reads as "noisy voice flows
// IN → AI cleans → final text settles inside the box". Wavy text
// content was also flipped from cleaned-form phrases to RAW filler-
// heavy speech transcripts ("えーと、MAT223 のレポート…"); the chat
// box settles on a longer cleaned form (Smith 教授へのメール下書き
// 追記) so the cleanup contrast is actually visible. Earlier v3
// (PR #108) had the wavy line floating below the chat box and used
// already-cleaned phrases, neither of which sold the cleanup story.
//
// 6s loop on the chat box:
//   0-1.8s    Caps idle, border calm, chat box empty.
//   1.8-3.0s  Caps pressed, holographic border, "Listening…" with
//             pulsing dots.
//   3.0-3.8s  Border tints amber, "Processing…" briefly visible.
//   3.8-5.4s  Settled — long cleaned phrase fades in, cursor blinks.
//   5.4-6.0s  Fade out, reset.
//
// The wavy textPath gets a 30s gentle horizontal drift so the line
// doesn't look frozen. The drift is slow enough that the eye reads
// the noisy raw phrases as static visual texture rather than active
// motion; only the chat box cycle competes for attention.
import { getTranslations } from "next-intl/server";

const SEPARATOR = "  ·  ";

export async function VoiceDemo() {
  const t = await getTranslations("landing.voice_demo");
  const rawPhrases = [
    t("raw_phrase_1"),
    t("raw_phrase_2"),
    t("raw_phrase_3"),
  ];
  // Repeat the chain so the path is full even when SVG width exceeds one
  // chain's typeset length — a half-empty curve reads as a bug.
  const wavyText = `${rawPhrases.join(SEPARATOR)}${SEPARATOR}${rawPhrases.join(SEPARATOR)}`;

  return (
    <div className="voice-demo-wrap relative mx-auto mt-10 w-full max-w-[1280px] px-4 py-12 md:mt-12 md:py-16">
      {/* Decorative wavy textPath BEHIND the chat box. The chat box's
          opaque card visually obscures the segment of the wave that
          passes behind it, creating the "noisy voice flows in, clean
          text settles inside" story. */}
      <div
        aria-hidden
        className="voice-demo-wave-wrap pointer-events-none absolute inset-x-0 top-1/2 z-0 h-[160px] -translate-y-1/2 select-none"
      >
        <svg
          viewBox="0 0 1280 160"
          preserveAspectRatio="none"
          className="block h-full w-full"
        >
          <defs>
            <path
              id="voice-demo-wave-path"
              d="M -60 90 C 200 0 400 170 640 80 C 880 -10 1080 170 1340 70"
              fill="none"
            />
          </defs>
          <text
            className="voice-demo-wave-text fill-[#1A1814]"
            fillOpacity="0.34"
            fontFamily="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
            fontSize="11"
            letterSpacing="0.06em"
          >
            <textPath href="#voice-demo-wave-path" startOffset="0">
              {wavyText}
            </textPath>
          </text>
        </svg>
      </div>

      {/* Chat box — relative + z-10, opaque card so the wave behind it
          is hidden in the chat box's footprint (the visual "absorbed
          into the box" effect). */}
      <div className="relative z-10 mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-black/5 bg-white/85 px-4 py-3 shadow-[0_18px_48px_-24px_rgba(20,20,40,0.18)] backdrop-blur-md">
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
            <span className="voice-demo-settled col-start-1 row-start-1 flex items-center overflow-hidden whitespace-nowrap leading-none">
              {t("cleaned_phrase")}
              <span
                aria-hidden
                className="voice-demo-cursor ml-[2px] inline-block h-[1em] w-[1px] bg-[#1A1814]/60"
              />
            </span>
          </div>
        </div>
      </div>

      <p className="relative z-10 mt-3 text-center text-[13px] text-[#1A1814]/70">
        {t("hold_to_talk")}
      </p>

      {/* Accessible plain text — the visual layer is aria-hidden where
          decorative; the cleaned phrase is what the SR user should
          hear as the "demo content". */}
      <span className="sr-only">{t("cleaned_phrase")}</span>
    </div>
  );
}
