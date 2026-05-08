import { describe, expect, it } from "vitest";
import { buildFanoutContextBlocks } from "@/lib/agent/email/fanout-prompt";
import type { FanoutResult } from "@/lib/agent/email/fanout";

// engineer-39 — contact persona fanout block. Verifies:
//   1. The block renders with relationship label as the header when populated.
//   2. Facts list as bullet points, ordered as supplied.
//   3. Empty state ("first interaction") when contactPersona is null.
//   4. Empty-corpus hint ALSO requires personaEmpty (so a persona-only
//      fanout doesn't trip the hint).

function makeFanout(overrides: Partial<FanoutResult> = {}): FanoutResult {
  return {
    classBinding: {
      classId: null,
      className: null,
      classCode: null,
      method: "none",
      confidence: 0,
    },
    senderHistory: [],
    similarSent: [],
    contactPersona: null,
    syllabusChunks: [],
    similarEmails: [],
    totalSimilarCandidates: 0,
    calendar: { events: [], tasks: [], assignments: [] },
    timings: {
      senderHistory: 0,
      similarSent: 0,
      contactPersona: 0,
      syllabus: 0,
      emails: 0,
      calendar: 0,
      total: 0,
    },
    timeouts: [],
    ...overrides,
  };
}

describe("buildFanoutContextBlocks contact persona", () => {
  it("renders the relationship label in the header when populated", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        contactPersona: {
          relationship: "MAT223 instructor",
          facts: ["Replies same day Mon-Fri.", "Prefers concise English."],
          lastExtractedAt: new Date("2026-05-01T10:00:00Z"),
        },
      }),
      "draft"
    );
    expect(out).toContain("=== Contact persona — MAT223 instructor ===");
    expect(out).toContain("- Replies same day Mon-Fri.");
    expect(out).toContain("- Prefers concise English.");
  });

  it("renders the empty-state header when contactPersona is null", () => {
    const out = buildFanoutContextBlocks(makeFanout(), "draft");
    expect(out).toContain("=== Contact persona ===");
    expect(out).toContain(
      "(no learned persona — first interaction or fresh contact)"
    );
  });

  it("renders generic header when persona has facts but no relationship label", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        contactPersona: {
          relationship: null,
          facts: ["Asks about deadlines."],
          lastExtractedAt: new Date("2026-05-01T10:00:00Z"),
        },
      }),
      "draft"
    );
    expect(out).toContain("=== Contact persona ===\n- Asks about deadlines.");
    expect(out).not.toContain("(no learned persona");
  });

  it("renders 'relationship known, no facts' when relationship set but facts empty", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        contactPersona: {
          relationship: "Friend",
          facts: [],
          lastExtractedAt: new Date("2026-05-01T10:00:00Z"),
        },
      }),
      "draft"
    );
    expect(out).toContain("=== Contact persona — Friend ===");
    expect(out).toContain(
      "(relationship known, no specific facts learned yet)"
    );
  });

  it("DOES emit the empty-corpus hint when persona is also empty", () => {
    const out = buildFanoutContextBlocks(makeFanout(), "draft");
    expect(out).toContain("Empty-corpus hint");
  });

  it("does NOT emit the empty-corpus hint when persona has any signal", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        contactPersona: {
          relationship: "Friend",
          facts: ["x"],
          lastExtractedAt: new Date("2026-05-01T10:00:00Z"),
        },
      }),
      "draft"
    );
    expect(out).not.toContain("Empty-corpus hint");
  });
});
