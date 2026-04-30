"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";
import type { GlobalVoiceState } from "./voice-app-provider";

// Floating "Listening to Steadii" indicator for global Caps Lock voice.
// Same holographic palette as the in-composer Phase 1 listening glow but
// rendered as a fixed pill near top-center of the viewport so the user
// knows the agent is hearing them even when no input has focus.
//
// No mic icon, no waveform, no spinner — by-design per project_voice_input.md
// (the cassette/recorder vocabulary is intentionally avoided).
export function GlobalVoicePill({ state }: { state: GlobalVoiceState }) {
  const tVoice = useTranslations("voice");
  const label =
    state === "processing"
      ? tVoice("global_processing")
      : tVoice("global_listening");

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed left-1/2 top-6 z-50 -translate-x-1/2"
    >
      <div className="relative">
        <span
          aria-hidden
          className={cn(
            "steadii-voice-listening absolute -inset-3 rounded-full",
            state === "processing" && "steadii-voice-processing"
          )}
        />
        <div className="relative flex items-center gap-2 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))]/90 px-4 py-2 text-[12px] italic text-[hsl(var(--muted-foreground))] shadow-[0_4px_18px_rgba(0,0,0,0.10)] backdrop-blur-sm">
          <span className="steadii-ai-dot" aria-hidden />
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
