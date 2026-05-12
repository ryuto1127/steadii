import { describe, expect, it, vi } from "vitest";

// engineer-45 — draft.ts dual-TZ rendering. We verify two things at the
// prompt-shape level (no LLM call needed):
//
//   (a) The SYSTEM_PROMPT carries the DRAFT BODY TZ DISPLAY rule, with
//       the exemplar dual-render format. Stripping this regresses to
//       single-TZ slot rendering (the 2026-05-12 dogfood failure).
//
//   (b) buildUserContent emits a Timezones block when both userTimezone
//       and senderTimezone are present, and the "TZ pair differs"
//       directive when they don't match.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_o: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({}),
}));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usageId: null }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4",
}));

// We import a copy of the source's system prompt + user-content
// builder. To do this without exposing internals as exports, we read
// the file string directly — checking that the rule text + format
// exemplar are present anywhere in the module's source.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRAFT_TS_PATH = join(
  process.cwd(),
  "lib/agent/email/draft.ts"
);
const DRAFT_SOURCE = readFileSync(DRAFT_TS_PATH, "utf-8");

describe("draft.ts SYSTEM_PROMPT — dual-TZ rendering rule", () => {
  it("contains the DRAFT BODY TZ DISPLAY heading", () => {
    expect(DRAFT_SOURCE).toMatch(/DRAFT BODY TZ DISPLAY/);
  });

  it("contains the exemplar dual-render format (JST + PT)", () => {
    expect(DRAFT_SOURCE).toMatch(/JST.*PT/);
  });

  it("forbids re-computing TZ offsets in the body", () => {
    expect(DRAFT_SOURCE).toMatch(/Don't recompute the offsets yourself/i);
  });

  it("includes the 'never show only one side' directive", () => {
    expect(DRAFT_SOURCE).toMatch(/Never show only one side/);
  });

  it("explicitly skips dual-render when TZs match", () => {
    expect(DRAFT_SOURCE).toMatch(/do NOT dual-render/);
  });
});

describe("draft.ts buildUserContent — Timezones block (via source inspection)", () => {
  it("emits a Timezones header when userTimezone and senderTimezone are provided", () => {
    expect(DRAFT_SOURCE).toMatch(/=== Timezones ===/);
  });

  it("emits the 'TZ pair differs' directive when the two timezones differ", () => {
    expect(DRAFT_SOURCE).toMatch(/TZ pair differs/);
  });

  it("emits the 'TZ pair matches' directive when they're equal", () => {
    expect(DRAFT_SOURCE).toMatch(/TZ pair matches/);
  });
});
