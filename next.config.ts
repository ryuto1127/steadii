import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next 16 promoted `typedRoutes` to top-level (it's opt-in by default).
  typedRoutes: false,
  // pdfjs-dist (loaded via pdf-parse) fails with "Object.defineProperty called
  // on non-object" when webpack's RSC loader rewrites its ESM module — pdfjs
  // wants Node's native ESM loader. Keep both packages external so they run
  // unbundled on the server.
  //
  // node-ical added 2026-04-26 — same class of failure under Turbopack:
  // production build collected `Failed to collect page data for
  // /api/cron/ical-sync` with `TypeError: s.BigInt is not a function`. The
  // recurrence-rule path inside node-ical references `BigInt` as a global,
  // which Turbopack's CommonJS wrapper doesn't expose to bundled modules.
  // Marking it external skips bundling and the global is available at
  // runtime as expected.
  serverExternalPackages: ["pdf-parse", "pdfjs-dist", "node-ical"],
};

export default withNextIntl(nextConfig);
