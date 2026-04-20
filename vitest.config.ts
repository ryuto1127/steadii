import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  // Vite 8 no longer transforms TSX on its own; tests import a couple of
  // .tsx modules (for the sidebar helpers) so we need a proper React
  // plugin to parse them. The test environment stays node — we don't
  // actually render anything, the import just has to resolve.
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/shims/server-only.ts"),
    },
  },
});
