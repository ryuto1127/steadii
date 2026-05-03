// Three nested gradient arcs — the Claude Design logomark. Reads as a
// stylized "S" and as a cascade waveform. Stops bind to --holo-1/2/3 so
// it follows the active direction.
import { useId } from "react";

export function Logomark({
  size = 24,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId().replace(/[:]/g, "");
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      style={style}
    >
      <defs>
        <linearGradient id={`lg-${id}`} x1="0" y1="0" x2="1" y2="1">
          {/* Hex fallbacks so the mark renders inside /app/* (which doesn't
              load the .landing-light token block) without going invisible. */}
          <stop offset="0%" stopColor="var(--holo-1, #2dd4ff)" />
          <stop offset="50%" stopColor="var(--holo-2, #ff4dcb)" />
          <stop offset="100%" stopColor="var(--holo-3, #c4ff3a)" />
        </linearGradient>
      </defs>
      <path
        d="M5 8.5C5 5.5 8 4 12 4s7 1.5 7 4.5"
        stroke={`url(#lg-${id})`}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M5 12c0-3 3-4.5 7-4.5s7 1.5 7 4.5-3 4.5-7 4.5"
        stroke={`url(#lg-${id})`}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        opacity=".75"
      />
      <path
        d="M5 15.5c0 3 3 4.5 7 4.5s7-1.5 7-4.5"
        stroke={`url(#lg-${id})`}
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
        opacity=".5"
      />
    </svg>
  );
}
