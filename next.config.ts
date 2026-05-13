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
  // `rrule-temporal` to the external set + as top-level deps. Neither
  // alone fixed the 500: Turbopack's `externalRequire` hard-codes the
  // build-time resolved absolute path (`/var/task/node_modules/.pnpm/
  // node-ical@0.26.0/node_modules/temporal-polyfill/index.js`) and does
  // NOT walk parent node_modules at runtime. Vercel's file tracer wasn't
  // including those nested pnpm paths in the lambda zip. The fix is
  // `outputFileTracingIncludes` below, which forces the tracer to keep
  // the exact nested paths.
  serverExternalPackages: ["node-ical", "temporal-polyfill", "rrule-temporal"],
  // 2026-05-13 — Force-include node-ical's nested pnpm peer paths in the
  // lambda zip for every route that transitively imports the agent tool-
  // registry. Turbopack hard-codes `externalRequire(...)` calls to the
  // absolute path it saw at build time; without these includes, the
  // tracer drops the files even though they exist locally. Glob covers
  // any future node-ical version bump.
  outputFileTracingIncludes: {
    "/api/chat": [
      "./node_modules/.pnpm/node-ical@*/node_modules/temporal-polyfill/**",
      "./node_modules/.pnpm/node-ical@*/node_modules/rrule-temporal/**",
    ],
    "/api/cron/ical-sync": [
      "./node_modules/.pnpm/node-ical@*/node_modules/temporal-polyfill/**",
      "./node_modules/.pnpm/node-ical@*/node_modules/rrule-temporal/**",
    ],
    "/api/cron/pre-brief": [
      "./node_modules/.pnpm/node-ical@*/node_modules/temporal-polyfill/**",
      "./node_modules/.pnpm/node-ical@*/node_modules/rrule-temporal/**",
    ],
  },
};

export default withNextIntl(nextConfig);
