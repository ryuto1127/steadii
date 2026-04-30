"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils/cn";

// Two-option chooser surfaced above the chat input after a >30s recording.
// Inline pill row, no modal — see project_voice_input.md for the "ephemeral
// / no UI" voice aesthetic. The hook owns the auto-dismiss timer; this
// component is purely the visual surface.
export function VoiceChoice({
  cleaned,
  shortened,
  onSelect,
}: {
  cleaned: string;
  shortened: string;
  onSelect: (kind: "full" | "short") => void;
}) {
  const t = useTranslations("voice");
  const fullLen = approxLength(cleaned);
  const shortLen = approxLength(shortened);
  const fullKey = fullLen.unit === "chars" ? "choice_full_chars" : "choice_full_words";
  const shortKey = shortLen.unit === "chars" ? "choice_short_chars" : "choice_short_words";
  return (
    <div
      role="group"
      aria-label={t("choice_label")}
      className="mb-2 flex flex-wrap items-center gap-2"
    >
      <ChoicePill
        label={t(fullKey, { n: fullLen.count })}
        onClick={() => onSelect("full")}
      />
      <ChoicePill
        label={t(shortKey, { n: shortLen.count })}
        onClick={() => onSelect("short")}
        emphasized
      />
    </div>
  );
}

function ChoicePill({
  label,
  onClick,
  emphasized = false,
}: {
  label: string;
  onClick: () => void;
  emphasized?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1 text-[11px] transition-hover",
        emphasized
          ? "border-[hsl(var(--border))] bg-[hsl(var(--foreground))] text-[hsl(var(--surface))] hover:opacity-90"
          : "border-[hsl(var(--border))] bg-[hsl(var(--surface-raised))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--surface))]"
      )}
    >
      {label}
    </button>
  );
}

// JP and EN need different units to be intuitive — JP collapses to ~1 word
// under a whitespace split, which is meaningless. Char count is closer to
// "how much will this fill the input" for CJK.
function approxLength(s: string): {
  count: number;
  unit: "words" | "chars";
} {
  const trimmed = s.trim();
  if (!trimmed) return { count: 0, unit: "words" };
  const cjk = (trimmed.match(/[぀-ヿ一-鿿]/g) ?? []).length;
  if (cjk / trimmed.length > 0.3) {
    return { count: trimmed.length, unit: "chars" };
  }
  return {
    count: trimmed.split(/\s+/).filter(Boolean).length,
    unit: "words",
  };
}
