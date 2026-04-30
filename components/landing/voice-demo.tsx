// Pure CSS, no JS, no audio, no `getUserMedia`. Loops the Phase 1
// hold-to-talk flow visually so first-visit landing readers grasp the
// "hold Caps Lock → speak → cleaned text appears" interaction without
// ever being prompted for mic access. Per project_voice_input.md:
// landing must NEVER request microphone permission.
//
// Animation timing (6s loop) is encoded in app/globals.css. The DOM is
// arranged so each animated layer can be independently driven.
export function VoiceDemo() {
  return (
    <div className="mx-auto mt-10 max-w-2xl px-4 md:mt-12">
      <div className="relative mx-auto flex w-full max-w-xl items-center gap-3 rounded-2xl border border-black/5 bg-white/55 px-4 py-3 shadow-[0_18px_48px_-24px_rgba(20,20,40,0.18)] backdrop-blur-sm">
        <span
          aria-hidden
          className="voice-demo-key flex h-9 w-12 shrink-0 items-center justify-center rounded-md border border-black/10 bg-white font-mono text-[10px] font-medium uppercase tracking-wider text-[#1A1814]/70 shadow-[0_1px_0_rgba(0,0,0,0.06),0_2px_6px_-2px_rgba(20,20,40,0.10)]"
        >
          ⇪ Caps
        </span>
        <div className="relative min-h-[34px] flex-1 overflow-hidden rounded-lg border border-black/10 bg-white/80">
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
          <div className="relative z-[1] flex h-full items-center px-3 text-[14px] leading-[1.4] text-[#1A1814]">
            {/* The text reveals via width:0→100% so we don't need typing
                JS — overflow hides characters that haven't been "typed"
                yet, and steps(36, end) chunks the reveal into discrete
                bites that read like speech. */}
            <span className="voice-demo-text inline-block max-w-full overflow-hidden whitespace-nowrap">
              MAT223 のレポート due tomorrow
            </span>
            <span
              aria-hidden
              className="voice-demo-cursor ml-[2px] inline-block h-[1.1em] w-[1px] bg-[#1A1814]/60 align-middle"
            />
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[12px] text-[#1A1814]/55">
        Hold Caps Lock to talk
      </p>
    </div>
  );
}
