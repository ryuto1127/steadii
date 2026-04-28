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
  serverExternalPackages: ["node-ical"],
};

export default withNextIntl(nextConfig);
