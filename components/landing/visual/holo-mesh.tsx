// Atmospheric blurred mesh used behind the hero and tucked into the
// pricing-style emphasis cards. Pulls from --gradient-holo-mesh so the
// stops follow the active direction (holo / warm) and intensity tier.
export function HoloMesh({
  opacity = 0.45,
  blur = 60,
  className,
  style,
}: {
  opacity?: number;
  blur?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        background: "var(--gradient-holo-mesh)",
        opacity,
        filter: `blur(${blur}px)`,
        pointerEvents: "none",
        ...style,
      }}
    />
  );
}
