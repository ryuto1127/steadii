import { describe, expect, it } from "vitest";

// draft.ts SYSTEM_PROMPT — register-conditioned Japanese line-break rule
// + honor-explicit-reply-request clause. LLM output is non-deterministic,
// so (like the dual-TZ prompt test) we assert at the prompt-shape level by
// inspecting the module source: these guard against accidental deletion of
// the rules. The actual formatting quality is verified by eyeballing real
// drafts — inherent to a prompt change, not unit-testable.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRAFT_TS_PATH = join(process.cwd(), "lib/agent/email/draft.ts");
const DRAFT_SOURCE = readFileSync(DRAFT_TS_PATH, "utf-8");

describe("draft.ts SYSTEM_PROMPT — Japanese formatting rule", () => {
  it("carries a Japanese-formatting block", () => {
    expect(DRAFT_SOURCE).toMatch(/JAPANESE FORMATTING/);
  });

  it("references proper 改行 / line breaks", () => {
    expect(DRAFT_SOURCE).toMatch(/改行/);
  });

  it("explicitly OVERRIDES the one-paragraph guidance for JA formal replies", () => {
    expect(DRAFT_SOURCE).toMatch(
      /OVERRIDES the generic "one-paragraph for routine items"/
    );
  });

  it("conditions line-break density on register (formal vs casual peers)", () => {
    expect(DRAFT_SOURCE).toMatch(/formal\/business recipients/);
    expect(DRAFT_SOURCE).toMatch(/casual peers/);
  });

  it("does not change English formatting behavior", () => {
    expect(DRAFT_SOURCE).toMatch(/do NOT change English behavior/);
  });
});

describe("draft.ts SYSTEM_PROMPT — honor explicit reply requests", () => {
  it("carries an explicit-reply-request clause", () => {
    expect(DRAFT_SOURCE).toMatch(/HONOR EXPLICIT REPLY REQUESTS/);
  });

  it("is scoped to when the reply is explicitly requested, not a blanket always-confirm", () => {
    expect(DRAFT_SOURCE).toMatch(/not a blanket "always confirm"/);
  });
});

describe("draft.ts SYSTEM_PROMPT — reasoning follows the user's app locale", () => {
  it("no longer forces the reasoning field to English", () => {
    // Previously: "'reasoning' is ALWAYS in English regardless of the
    // email's language." That leaked English reasoning into JA users'
    // draft-details panel — the field is user-visible.
    expect(DRAFT_SOURCE).not.toMatch(/reasoning' is ALWAYS in English/);
  });

  it("routes reasoning to the user's app locale via the header", () => {
    expect(DRAFT_SOURCE).toMatch(/CRITICAL LANGUAGE RULE/);
    expect(DRAFT_SOURCE).toMatch(/Reasoning language: <locale>/);
    expect(DRAFT_SOURCE).toMatch(
      /'reasoning' MUST be written in the user's app locale/
    );
  });

  it("emits the reasoning-language header into the user content from the locale input", () => {
    expect(DRAFT_SOURCE).toMatch(
      /Reasoning language: \$\{input\.locale \?\? "en"\}/
    );
  });
});
