// Pure CSS, no JS, no audio, no `getUserMedia`. Demonstrates the
// hold-to-talk flow visually so first-visit landing readers grasp the
// "hold Caps Lock → speak → cleaned text appears" interaction without
// ever being prompted for mic access. Per project_voice_input.md:
// landing must NEVER request microphone permission.
//
// v3 (2026-04-30) replaced engineer 17's 3-path cascade (PR #105) with
// a simpler split: the chat box demonstrates the literal interaction
// (Listening → Processing → settled phrase), and a single decorative
// wavy SVG textPath below joins all 3 academic sample phrases on one
// curving baseline. Earlier 3-phrase overlay overlapped each other on
// some viewport widths and read as visual mess vs the voiceos.com
// reference — single curve fixes both.
//
// 6s loop on the chat box (vs 12s for v2):
//   0-1.8s    Caps idle, border calm, chat box empty.
//   1.8-3.0s  Caps pressed, holographic border, "Listening…" with
//             pulsing dots.
//   3.0-3.8s  Border tints amber, "Processing…" briefly visible.
//   3.8-5.4s  Settled — phrase 1 fades in, cursor blinks at end.
//   5.4-6.0s  Fade out, reset.
//
// The wavy textPath gets a 30s gentle horizontal drift so the line
// doesn't look frozen, but stays well below the threshold of the
// chat box's faster cycle so it never competes for attention.
import { getTranslations } from "next-intl/server";

const SEPARATOR = "  ·  ";

export async function VoiceDemo() {
  const t = await getTranslations("landing.voice_demo");
  const phrases = [t("phrase_1"), t("phrase_2"), t("phrase_3")];
  // Repeat the chain so the path is full even when the SVG width exceeds
  // one phrase chain's typeset length — a half-empty curve reads as a bug.
  const wavyText = `${phrases.join(SEPARATOR)}${SEPARATOR}${phrases.join(SEPARATOR)}`;

  return (
    <div className="voice-demo-wrap relative mx-auto mt-10 w-full max-w-[1280px] px-4 md:mt-12">
      {/* Centered chat box — Caps key + holographic border + state cycle */}
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
            <span className="voice-demo-settled col-start-1 row-start-1 flex items-center whitespace-nowrap leading-none">
              {phrases[0]}
              <span
                aria-hidden
                className="voice-demo-cursor ml-[2px] inline-block h-[1em] w-[1px] bg-[#1A1814]/60"
              />
            </span>
          </div>
        </div>
      </div>

      {/* Decorative wavy textPath — single curve below the chat box,
          carries all 3 phrases joined by " · " on one baseline so the
          reader sees "voice can do many things" without the per-phrase
          fade overlap that v2 produced. */}
      <div
        aria-hidden
        className="voice-demo-wave-wrap pointer-events-none mt-6 select-none"
      >
        <svg
          viewBox="0 0 1280 110"
          preserveAspectRatio="none"
          className="block h-[110px] w-full"
        >
          <defs>
            <path
              id="voice-demo-wave-path"
              d="M -40 70 C 200 -10 380 130 640 60 C 880 0 1080 130 1320 50"
              fill="none"
            />
          </defs>
          <text
            className="voice-demo-wave-text fill-[#1A1814]"
            fillOpacity="0.32"
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

      <p className="mt-3 text-center text-[13px] text-[#1A1814]/70">
        {t("hold_to_talk")}
      </p>

      {/* Accessible plain text — the visual layer is aria-hidden where
          decorative; the chat box's settled phrase is what the SR user
          should hear as the "demo content". */}
      <span className="sr-only">{phrases[0]}</span>
    </div>
  );
}
