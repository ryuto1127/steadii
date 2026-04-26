import { describe, expect, it } from "vitest";
import { buildFanoutContextBlocks } from "@/lib/agent/email/fanout-prompt";
import type { FanoutResult } from "@/lib/agent/email/fanout";

// Phase 7 W1 — fanout prompt-shape tests. The model is contracted to
// cite per-source tags emitted here (mistake-N, syllabus-N, calendar-N),
// so the tag format is load-bearing. Snapshot-style assertions verify
// the structure stays stable across refactors.

function makeFanout(overrides: Partial<FanoutResult> = {}): FanoutResult {
  return {
    classBinding: {
      classId: null,
      className: null,
      classCode: null,
      method: "none",
      confidence: 0,
    },
    mistakes: [],
    syllabusChunks: [],
    similarEmails: [],
    totalSimilarCandidates: 0,
    calendar: { events: [], tasks: [], assignments: [] },
    timings: {
      mistakes: 0,
      syllabus: 0,
      emails: 0,
      calendar: 0,
      total: 0,
    },
    timeouts: [],
    ...overrides,
  };
}

describe("buildFanoutContextBlocks", () => {
  it("renders a no-binding header when class binding is unknown", () => {
    const out = buildFanoutContextBlocks(makeFanout(), "classify");
    expect(out).toContain("=== Class binding ===");
    expect(out).toContain(
      "(no class identified — fanout is vector-only across the user's corpus)"
    );
  });

  it("renders the bound-class line with method + confidence", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        classBinding: {
          classId: "cls-1",
          className: "Linear Algebra",
          classCode: "MAT223",
          method: "subject_code",
          confidence: 0.95,
        },
      }),
      "classify"
    );
    expect(out).toMatch(
      /Class: Linear Algebra \(MAT223\) — bound by subject_code \(confidence 0\.95\)/
    );
  });

  it("emits stable per-source tags the system prompt requires", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        mistakes: [
          {
            mistakeId: "m1",
            classId: null,
            title: "Off-by-one in induction",
            unit: "Week 4",
            difficulty: "medium",
            bodySnippet: "Forgot the base case",
            createdAt: new Date("2026-04-01"),
          },
        ],
        syllabusChunks: [
          {
            chunkId: "c1",
            syllabusId: "s1",
            classId: null,
            syllabusTitle: "MAT223 Syllabus",
            chunkText: "Late submissions lose 10% per day",
            similarity: 0.82,
          },
        ],
        calendar: {
          events: [
            {
              title: "Office hours",
              start: "2026-04-26T10:00:00-07:00",
              end: "2026-04-26T11:00:00-07:00",
              location: "BA 1230",
            },
          ],
          tasks: [
            {
              title: "Submit PS3",
              due: "2026-04-27",
              notes: null,
              completed: false,
            },
          ],
          assignments: [
            {
              id: "a1",
              classId: "cls-1",
              className: "Linear Algebra",
              title: "Problem set 4",
              due: "2026-04-30",
              status: "in_progress",
              priority: "high",
            },
          ],
        },
      }),
      "draft"
    );
    // The prompt MUST stamp these tags exactly because the system
    // prompt + ReasoningPanel citation regex key off them.
    expect(out).toContain("mistake-1: Off-by-one in induction");
    expect(out).toContain("syllabus-1: MAT223 Syllabus");
    expect(out).toContain("calendar-1: 2026-04-26T10:00:00-07:00");
    expect(out).toContain("calendar-2: due 2026-04-27 :: Submit PS3");
    expect(out).toMatch(
      /calendar-3: due 2026-04-30 :: Problem set 4 \[Linear Algebra\] \(in_progress\) \[steadii\]/
    );
  });

  it("respects the classify-phase 250-char mistake cap", () => {
    const long = "a".repeat(2000);
    const out = buildFanoutContextBlocks(
      makeFanout({
        mistakes: [
          {
            mistakeId: "m1",
            classId: null,
            title: "T",
            unit: null,
            difficulty: null,
            bodySnippet: long,
            createdAt: new Date(),
          },
        ],
      }),
      "classify"
    );
    const line = out.split("\n").find((l) => l.startsWith("mistake-1:")) ?? "";
    // "mistake-1: T — " (15 chars prefix) + 250 chars of body
    expect(line.length).toBeLessThanOrEqual(15 + 250 + 5);
    expect(line).toMatch(/^mistake-1: T — a+/);
  });

  it("respects the draft-phase 500-char mistake cap", () => {
    const long = "b".repeat(2000);
    const out = buildFanoutContextBlocks(
      makeFanout({
        mistakes: [
          {
            mistakeId: "m1",
            classId: null,
            title: "T",
            unit: null,
            difficulty: null,
            bodySnippet: long,
            createdAt: new Date(),
          },
        ],
      }),
      "draft"
    );
    const line = out.split("\n").find((l) => l.startsWith("mistake-1:")) ?? "";
    expect(line.length).toBeLessThanOrEqual(15 + 500 + 5);
  });

  it("prepends the empty-corpus hint when mistakes + syllabus are both empty", () => {
    const out = buildFanoutContextBlocks(makeFanout(), "classify");
    expect(out).toMatch(/^\[Empty-corpus hint:/);
  });

  it("omits the empty-corpus hint when at least one structured source has data", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        mistakes: [
          {
            mistakeId: "m1",
            classId: null,
            title: "T",
            unit: null,
            difficulty: null,
            bodySnippet: "x",
            createdAt: new Date(),
          },
        ],
      }),
      "classify"
    );
    expect(out.startsWith("[Empty-corpus hint")).toBe(false);
  });
});
