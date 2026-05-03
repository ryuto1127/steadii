// 14-bar holographic waveform. Active state animates with the three
// landing-wf-* keyframes from globals.css; inactive shows a flat strip.
const BARS = 14;

export function Waveform({ active = true }: { active?: boolean }) {
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 2, height: 18 }}
      aria-hidden
    >
      {Array.from({ length: BARS }).map((_, i) => {
        const cls = `landing-wf-${(i % 3) as 0 | 1 | 2}`;
        const color =
          i % 3 === 0
            ? "var(--holo-2)"
            : i % 3 === 1
              ? "var(--holo-1)"
              : "var(--holo-3)";
        const baseHeight = 4 + Math.abs(Math.sin(i * 1.3)) * 14;
        return (
          <span
            key={i}
            className={active ? cls : undefined}
            style={{
              display: "inline-block",
              width: 2,
              borderRadius: 1,
              background: color,
              height: active ? `${baseHeight}px` : "3px",
              opacity: active ? 1 : 0.35,
            }}
          />
        );
      })}
    </div>
  );
}
