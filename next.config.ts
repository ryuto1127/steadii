import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts");

const nextConfig: NextConfig = {
  // Next 16 promoted `typedRoutes` to top-level (it's opt-in by default).
  typedRoutes: false,
  // unpdf (replaces pdf-parse + pdfjs-dist) ships a serverless-patched pdfjs
  // build internally and works fine when bundled, so it doesn't need to be
  // marked external.
  //
  // node-ical added 2026-04-26 — Turbopack production build collected
  // `Failed to collect page data for /api/cron/ical-sync` with `TypeError:
  // s.BigInt is not a function`. The recurrence-rule path inside node-ical
  // references `BigInt` as a global, which Turbopack's CommonJS wrapper
  // doesn't expose to bundled modules. Marking it external skips bundling
  // and the global is available at runtime as expected.
  //
  // 2026-05-13 — node-ical's peers (`temporal-polyfill`, `rrule-temporal`)
  // are also external + top-level deps. With node-ical now lazy-imported
  // inside lib/integrations/ical/parser.ts via `await import("node-ical")`,
  // it no longer pollutes the agent tool-registry chunk eval graph — so
  // /api/chat doesn't trigger node-ical loading at all. The previous
  // `outputFileTracingIncludes` workaround (PR #241) caused a Vercel
  // packaging error (symlinked directories) and was reverted in this PR.
  serverExternalPackages: ["node-ical", "temporal-polyfill", "rrule-temporal"],
};

export default withNextIntl(nextConfig);
