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
        className="steadii-mesh absolute -inset-[10%] opacity-70"
        style={{
          background: `
            radial-gradient(circle at 18% 28%, rgba(6, 182, 212, 0.55) 0%, transparent 42%),
            radial-gradient(circle at 82% 18%, rgba(217, 70, 239, 0.50) 0%, transparent 46%),
            radial-gradient(circle at 50% 78%, rgba(190, 242, 100, 0.45) 0%, transparent 48%),
            radial-gradient(circle at 88% 82%, rgba(59, 130, 246, 0.45) 0%, transparent 44%)
          `,
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 0%, rgba(250, 250, 249, 0.35) 100%)",
        }}
      />
    </div>
  );
}
