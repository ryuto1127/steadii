"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useVoiceApp } from "./voice-app-provider";

// Bottom-right discoverability hint shown on `/app/*` pages that aren't the
// home composer or a chat view. The home composer carries its own Phase 1
// hint just below the input ("Hold Caps Lock to talk · Tap to chat from
// any page") — we don't want to double-stack on those.
//
// Fade behavior:
//   - Hides after 3 successful global uses (counter persisted in
//     localStorage `steadii.voice.global_uses` by VoiceAppProvider).
//   - Re-shows once if the user goes 7+ days without a global use.
//   - Counter is SEPARATE from Phase 1's chat-input hint counter so the two
//     hints fade independently.

const GLOBAL_USES_HIDE_AT = 3;
const REENGAGE_AFTER_DAYS = 7;
const GLOBAL_USES_KEY = "steadii.voice.global_uses";
const GLOBAL_LAST_USE_KEY = "steadii.voice.global_last_use_at";

const HIDDEN_PATHS = [
  "/app", // home page already has its own hint
  "/app/chat", // chat list / individual chat both have the chat composer hint
];

function pathHasOwnHint(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/app" || pathname === "/app/") return true;
  if (pathname.startsWith("/app/chat")) return true;
  return false;
}

export function VoiceHint() {
  const tVoice = useTranslations("voice");
  const pathname = usePathname();
  const { effectiveKey, globalUses, overlayOpen, globalVoiceState } =
    useVoiceApp();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (pathHasOwnHint(pathname)) {
      setVisible(false);
      return;
    }
    try {
      const uses = Number(
        window.localStorage.getItem(GLOBAL_USES_KEY) ?? "0"
      );
      if (uses < GLOBAL_USES_HIDE_AT) {
        setVisible(true);
        return;
      }
      // Re-engagement: re-show once per dormancy window.
      const lastUseRaw = window.localStorage.getItem(GLOBAL_LAST_USE_KEY);
      const lastUseAt = lastUseRaw ? Number(lastUseRaw) : 0;
      const daysSince =
        lastUseAt > 0 ? (Date.now() - lastUseAt) / 86_400_000 : Infinity;
      if (daysSince > REENGAGE_AFTER_DAYS) {
        setVisible(true);
      } else {
        setVisible(false);
      }
    } catch {
      setVisible(true);
    }
  }, [pathname, globalUses]);

  // Hide while the overlay is open or global voice is active so the hint
  // doesn't visually clash with the canonical UI it's pointing at.
  if (!visible) return null;
  if (overlayOpen) return null;
  if (globalVoiceState !== "idle") return null;
  if (pathHasOwnHint(pathname)) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-20 hidden md:block">
      <p className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))]/85 px-3 py-1.5 text-[11px] text-[hsl(var(--muted-foreground))] shadow-[0_2px_10px_rgba(0,0,0,0.06)] backdrop-blur-sm">
        {effectiveKey === "alt_right"
          ? tVoice("global_hint_alt")
          : tVoice("global_hint_caps")}
      </p>
    </div>
  );
}
