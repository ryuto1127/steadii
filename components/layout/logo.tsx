import { Logomark } from "@/components/landing/visual/logomark";

// Steadii brand mark. Three nested holographic arcs — reads as a stylized
// "S" and as a cascade waveform. Replaced the diamond + warm-gradient
// version 2026-05-02 to align with the Claude Design archive. The arc
// gradient stops bind to --holo-1/2/3, which resolve under the marketing
// .landing-light scope and fall back to the same hex values everywhere
// else (Logomark inlines them via SVG <linearGradient>).
export function Logo({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return <Logomark size={size} className={className} />;
}
