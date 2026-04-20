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
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default withNextIntl(nextConfig);
