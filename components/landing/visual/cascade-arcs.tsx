// Three nested SVG arcs cascading from the top of the hero panel.
// Pulled directly from the Claude Design landing.jsx — gradient stops
// reference --holo-1/2/3 so the arcs reskin automatically when tokens
// flip.
import { useId } from "react";

export function CascadeArcs({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  const id = useId().replace(/[:]/g, "");
  return (
    <svg
      aria-hidden
      viewBox="0 0 540 460"
      preserveAspectRatio="none"
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: 1,
        pointerEvents: "none",
        ...style,
      }}
    >
      <defs>
        <linearGradient id={`arc-c-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--holo-1)" stopOpacity="0" />
          <stop offset="40%" stopColor="var(--holo-1)" stopOpacity=".9" />
          <stop offset="100%" stopColor="var(--holo-1)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`arc-m-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--holo-2)" stopOpacity="0" />
          <stop offset="50%" stopColor="var(--holo-2)" stopOpacity=".9" />
          <stop offset="100%" stopColor="var(--holo-2)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`arc-l-${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--holo-3)" stopOpacity="0" />
          <stop offset="60%" stopColor="var(--holo-3)" stopOpacity=".9" />
          <stop offset="100%" stopColor="var(--holo-3)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M -40 30 Q 270 -10 580 50"
        stroke={`url(#arc-c-${id})`}
        strokeWidth="1.5"
        fill="none"
        className="landing-arc-drift-9"
      />
      <path
        d="M -40 22 Q 270 -20 580 38"
        stroke={`url(#arc-m-${id})`}
        strokeWidth="1.5"
        fill="none"
        className="landing-arc-drift-11"
      />
      <path
        d="M -40 14 Q 270 -32 580 26"
        stroke={`url(#arc-l-${id})`}
        strokeWidth="1.5"
        fill="none"
        className="landing-arc-drift-13"
      />
    </svg>
  );
}
