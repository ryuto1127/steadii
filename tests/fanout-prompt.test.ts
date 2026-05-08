import { describe, expect, it } from "vitest";
import { buildFanoutContextBlocks } from "@/lib/agent/email/fanout-prompt";
import type { FanoutResult } from "@/lib/agent/email/fanout";

// Phase 7 W1 — fanout prompt-shape tests. The model is contracted to
// cite per-source tags emitted here (self-N, syllabus-N, calendar-N), so
// the tag format is load-bearing. Snapshot-style assertions verify the
// structure stays stable across refactors.
//
// engineer-38 — `mistake-N` was renamed to `self-N` (sender-history). The
// caps stay numeric-equivalent (250/500/800 chars per past-reply body).

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
    syllabusChunks: [],
    similarEmails: [],
    totalSimilarCandidates: 0,
    calendar: { events: [], tasks: [], assignments: [] },
    timings: {
      senderHistory: 0,
      similarSent: 0,
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
        senderHistory: [
          {
            draftId: "d1",
            draftSubject: "Re: midterm prep",
            draftBody: "Thanks for the heads up — I'll review chapter 7 tonight.",
            sentAt: new Date("2026-04-22T10:00:00Z"),
            originalSubject: "midterm prep",
            originalSnippet: "Reminder…",
            source: "steadii" as const,
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
              taskId: "g-task-ps3",
              taskListId: "@default",
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
    // Tags are load-bearing — both the system prompt and the
    // ReasoningPanel citation regex key off them.
    expect(out).toContain("self-1: [2026-04-22] Subject: \"Re: midterm prep\"");
    expect(out).toContain("syllabus-1: MAT223 Syllabus");
    expect(out).toContain("calendar-1: 2026-04-26T10:00:00-07:00");
    expect(out).toContain("calendar-2: due 2026-04-27 :: Submit PS3");
    expect(out).toMatch(
      /calendar-3: due 2026-04-30 :: Problem set 4 \[Linear Algebra\] \(in_progress\) \[steadii\]/
    );
  });

  it("respects the classify-phase 250-char sender-body cap", () => {
    const long = "a".repeat(2000);
    const out = buildFanoutContextBlocks(
      makeFanout({
        senderHistory: [
          {
            draftId: "d1",
            draftSubject: "T",
            draftBody: long,
            sentAt: new Date("2026-04-01T00:00:00Z"),
            originalSubject: null,
            originalSnippet: null,
            source: "steadii" as const,
          },
        ],
      }),
      "classify"
    );
    const bodyLine =
      out.split("\n").find((l) => l.trim().startsWith("Body:")) ?? "";
    // `  Body: "` prefix (10 chars) + 250 chars of body + closing `"` (1 char)
    expect(bodyLine.length).toBeLessThanOrEqual(10 + 250 + 5);
    expect(bodyLine).toMatch(/^\s*Body: "a+/);
  });

  it("respects the draft-phase 500-char sender-body cap", () => {
    const long = "b".repeat(2000);
    const out = buildFanoutContextBlocks(
      makeFanout({
        senderHistory: [
          {
            draftId: "d1",
            draftSubject: "T",
            draftBody: long,
            sentAt: new Date("2026-04-01T00:00:00Z"),
            originalSubject: null,
            originalSnippet: null,
            source: "steadii" as const,
          },
        ],
      }),
      "draft"
    );
    const bodyLine =
      out.split("\n").find((l) => l.trim().startsWith("Body:")) ?? "";
    expect(bodyLine.length).toBeLessThanOrEqual(10 + 500 + 5);
  });

  it("prepends the empty-corpus hint when sender-history + syllabus are both empty", () => {
    const out = buildFanoutContextBlocks(makeFanout(), "classify");
    expect(out).toMatch(/^\[Empty-corpus hint:/);
  });

  it("omits the empty-corpus hint when at least one structured source has data", () => {
    const out = buildFanoutContextBlocks(
      makeFanout({
        senderHistory: [
          {
            draftId: "d1",
            draftSubject: "T",
            draftBody: "x",
            sentAt: new Date("2026-04-01T00:00:00Z"),
            originalSubject: null,
            originalSnippet: null,
            source: "steadii" as const,
          },
        ],
      }),
      "classify"
    );
    expect(out.startsWith("[Empty-corpus hint")).toBe(false);
  });
});
