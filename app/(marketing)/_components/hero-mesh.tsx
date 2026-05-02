/**
 * Layered translucent radial gradients sitting behind the hero. The
 * white base reads through, so text on top stays legible. Drift is
 * driven by .steadii-mesh in globals.css and respects
 * prefers-reduced-motion.
 */
export function HeroMesh() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
    >
      <div className="absolute inset-0 bg-[#FAFAF9]" />
      <div
        className="steadii-mesh absolute -inset-[10%] opacity-95"
        style={{
          background: `
            radial-gradient(circle at 16% 26%, rgba(220, 188, 145, 0.85) 0%, transparent 54%),
            radial-gradient(circle at 84% 18%, rgba(168, 148, 205, 0.80) 0%, transparent 56%),
            radial-gradient(circle at 50% 92%, rgba(170, 188, 218, 0.65) 0%, transparent 58%),
            radial-gradient(circle at 92% 76%, rgba(215, 180, 188, 0.60) 0%, transparent 52%)
          `,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, rgba(250, 250, 249, 0.45) 100%)",
        }}
      />
    </div>
  );
}
