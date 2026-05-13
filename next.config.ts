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
  // 2026-05-13 — Added node-ical's deps `temporal-polyfill` and
  // `rrule-temporal` to the external set as well. Without them, Vercel's
  // file tracer dropped the nested `.pnpm/node-ical@0.26.0/node_modules/
  // temporal-polyfill/index.js` from the lambda zip, and runtime evaluation
  // of any chunk that imports node-ical (transitively via the agent
  // tool-registry) crashed /api/chat with `Failed to load external module
  // node-ical … Cannot find module … temporal-polyfill/index.js`. Listing
  // them explicitly forces the tracer to include them.
  serverExternalPackages: ["node-ical", "temporal-polyfill", "rrule-temporal"],
};

export default withNextIntl(nextConfig);
