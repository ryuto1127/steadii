// Global vitest guard — makes a real OpenAI client unreachable from the
// unit-test process.
//
// Why: a ~$7.65/day gpt-5.4-mini billing spike (2026-06-01) came from code
// that hit the paid OpenAI API *outside* prod (`recordUsage` / `usage_events`
// never saw it, so cost-audit was blind). The unit suite already mocks
// `@/lib/integrations/openai/client` per-file in ~30 files, but a NEW test
// that forgets to mock would silently call the real API and bill us. This
// setup file closes that hole: any test reaching `openai()` without its own
// `vi.mock` now throws a loud, descriptive error instead of opening a socket.
//
// This is wired via `vitest.config.ts` `test.setupFiles`, so it ONLY loads in
// the vitest process. Production runtime never imports this module — the real
// `openai()` singleton is completely untouched at runtime.
//
// Coexistence: a per-file `vi.mock("@/lib/integrations/openai/client", ...)`
// overrides this global default for that file (Vitest applies the file-local
// factory over the setup-file one), so the existing mocked tests keep their
// stubbed client. Only *unmocked* reaches of `openai()` hit the thrower.
//
// The agent-eval harness (`tests/agent-evals/harness.ts`) does NOT use this
// module — it constructs its own `new OpenAI(...)` and runs via the `tsx`
// `pnpm eval:agent` runner, not under vitest. It is gated separately (explicit
// `ALLOW_REAL_LLM=1` opt-in + per-run cost cap). See that harness, not here.

import { vi } from "vitest";

const REACHED_REAL_CLIENT_MESSAGE =
  "Real OpenAI client reached in tests — mock it. " +
  'Add `vi.mock("@/lib/integrations/openai/client", ...)` to this test file ' +
  "(see e.g. tests/voice-cleanup.test.ts). The unit suite must never call the " +
  "paid OpenAI API; doing so silently bills us and is invisible to cost-audit.";

vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => {
    throw new Error(REACHED_REAL_CLIENT_MESSAGE);
  },
}));

export { REACHED_REAL_CLIENT_MESSAGE };
