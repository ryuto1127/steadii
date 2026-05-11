import { Sparkles } from "lucide-react";

// The `⊙ {label}: {value}` tag is the moat signature — same shape in
// Morning Briefing, Week timeline, and anywhere else context is surfaced.
// Mono 11px, #8579A8 accent, Sparkles icon (size 11, strokeWidth 1.6).
export function ContextTag({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center gap-1 font-mono text-[11px] tracking-[0.04em] text-[#8579A8] ${className ?? ""}`}
    >
      <Sparkles size={11} strokeWidth={1.6} className="shrink-0" />
      <span>
        {label}: {value}
      </span>
    </div>
  );
}
