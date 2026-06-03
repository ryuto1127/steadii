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
    // Global guard: any test that reaches the real OpenAI client without its
    // own `vi.mock` throws loudly instead of calling the paid API. This makes
    // silent test-side billing impossible. Per-file `vi.mock` of the same
    // module still wins. See tests/setup/openai-guard.ts.
    setupFiles: ["tests/setup/openai-guard.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
      "server-only": path.resolve(__dirname, "tests/shims/server-only.ts"),
    },
  },
});
