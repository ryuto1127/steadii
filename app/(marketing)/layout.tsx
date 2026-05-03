/**
 * Marketing routes (/, /login is in (auth) so handled separately,
 * /request-access, /privacy, /terms) all sit on the holographic light
 * canvas. We force html + body to the warm-white base regardless of the
 * user's app-level theme preference; in-product /app/* still honors it.
 *
 * data-direction / data-surface / data-intensity match the Claude Design
 * token vocabulary in app/globals.css. Set on the wrapper (not the html
 * element) so they only scope the marketing route group; in-product
 * /app/* stays D1 dark+amber.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="landing-light min-h-screen text-[hsl(var(--foreground))]"
      data-direction="holo"
      data-surface="warm"
      data-intensity="whisper"
    >
      <style>{`
        html { background-color: #faf9f6; color-scheme: light; }
        body { background-color: #faf9f6; }
      `}</style>
      {children}
    </div>
  );
}
