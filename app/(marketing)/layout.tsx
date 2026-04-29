/**
 * Marketing routes (/, /login is in (auth) so handled separately,
 * /request-access, /privacy, /terms) all sit on the holographic light
 * canvas. We force html + body to the warm-white base regardless of the
 * user's app-level theme preference; in-product /app/* still honors it.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="landing-light min-h-screen text-[hsl(var(--foreground))]">
      <style>{`
        html { background-color: #FAFAF9; color-scheme: light; }
        body { background-color: #FAFAF9; }
      `}</style>
      {children}
    </div>
  );
}
