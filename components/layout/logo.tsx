import { cn } from "@/lib/utils/cn";

// Steadii brand mark. A diamond (45°-rotated square with softened
// points) with a warm gradient whose hue cycles slowly (~14s) via
// `steadii-logo-hue` in globals.css, giving a subtle "always alive"
// feel. Animation respects prefers-reduced-motion.
export function Logo({
  size = 26,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("steadii-logo block shrink-0", className)}
      style={{ width: size, height: size }}
    />
  );
}
