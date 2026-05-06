"use client";

import type { VoiceTriggerKey } from "@/components/chat/use-voice-input";

export type KeyboardLayout = "auto" | "en" | "jn";

// Derive the voice trigger key from a layout preference.
// - "en" → alt_right (Right Option / Right Alt holds natively, no IME
//          interception on US/Western keyboards).
// - "jn" → meta_right (Right ⌘ on JIS Mac. Right Option on JIS Mac is
//          the 「かな」 key — IME intercepts it for kana mode toggle —
//          so we route around with Right ⌘ which holds cleanly).
// - "auto" → call detectLayout() and reuse the derivation.
export function triggerKeyForLayout(
  layout: KeyboardLayout
): VoiceTriggerKey {
  if (layout === "jn") return "meta_right";
  if (layout === "en") return "alt_right";
  return triggerKeyForLayout(detectLayout());
}

// Best-effort browser detection. Uses the experimental
// navigator.keyboard.getLayoutMap() API (Chromium 68+, Edge, Opera —
// not Safari/Firefox as of 2026). When the layout map exposes
// `Lang1` mapped to "かな" (or contains JIS-specific keys),
// classify as JIS. Otherwise fall back to EN.
//
// Sync function returning a sensible default — the Real probe is
// async via `getLayoutMap()` so callers that want the fully-resolved
// layout should call detectLayoutAsync().
export function detectLayout(): "en" | "jn" {
  if (typeof navigator === "undefined") return "en";
  // Cheap synchronous fallback: macOS browser language hints don't
  // reveal layout, but the page's HTML lang or the user's primary
  // language can hint Japan.
  const langs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language ?? "en"];
  const primary = langs[0]?.toLowerCase() ?? "en";
  if (primary.startsWith("ja")) return "jn";
  return "en";
}

// Async layout probe. Gives a more reliable JIS detection than the
// language sniff because some JP users have a US keyboard plugged in
// (and vice versa). Returns "en" when the API is unavailable.
export async function detectLayoutAsync(): Promise<"en" | "jn"> {
  if (typeof navigator === "undefined") return "en";
  type KeyboardWithLayout = {
    getLayoutMap?: () => Promise<Map<string, string>>;
  };
  const kb = (navigator as unknown as { keyboard?: KeyboardWithLayout })
    .keyboard;
  if (!kb || !kb.getLayoutMap) return detectLayout();
  try {
    const map = await kb.getLayoutMap();
    // JIS-specific code that consistently differs from US: `Lang1`
    // maps to "かな" on JIS, undefined on US ANSI.
    const lang1 = map.get("Lang1");
    if (lang1 && /[぀-ヿ]/.test(lang1)) return "jn";
    return "en";
  } catch {
    return detectLayout();
  }
}
