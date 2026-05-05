import { describe, expect, it } from "vitest";
import {
  estimateSecondsSaved,
  formatSecondsSaved,
  formatSecondsSavedJa,
  SECONDS_PER_ACTION,
  type WeeklyStats,
} from "@/lib/digest/time-saved";

const EMPTY: WeeklyStats = {
  archivedCount: 0,
  draftsSentUnmodified: 0,
  draftsSentEdited: 0,
  calendarImports: 0,
  proposalsResolved: 0,
};

describe("estimateSecondsSaved", () => {
  it("returns 0 for an empty week", () => {
    expect(estimateSecondsSaved(EMPTY)).toBe(0);
  });

  it("sums each bucket with its per-action seconds", () => {
    const stats: WeeklyStats = {
      archivedCount: 5,
      draftsSentUnmodified: 2,
      draftsSentEdited: 1,
      calendarImports: 3,
      proposalsResolved: 4,
    };
    const expected =
      5 * SECONDS_PER_ACTION.archived +
      2 * SECONDS_PER_ACTION.draftSentUnmodified +
      1 * SECONDS_PER_ACTION.draftSentEdited +
      3 * SECONDS_PER_ACTION.calendarImport +
      4 * SECONDS_PER_ACTION.proposalResolved;
    expect(estimateSecondsSaved(stats)).toBe(expected);
  });

  it("handles a heavy week without overflow", () => {
    const stats: WeeklyStats = {
      archivedCount: 5000,
      draftsSentUnmodified: 100,
      draftsSentEdited: 50,
      calendarImports: 200,
      proposalsResolved: 30,
    };
    const result = estimateSecondsSaved(stats);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThan(0);
  });

  it("formats sub-minute values as plain seconds", () => {
    expect(formatSecondsSaved(0)).toBe("0s");
    expect(formatSecondsSaved(45)).toBe("45s");
    expect(formatSecondsSaved(60)).toBe("1m");
    expect(formatSecondsSaved(192)).toBe("3m 12s");
    expect(formatSecondsSaved(3600)).toBe("1h");
    expect(formatSecondsSaved(3960)).toBe("1h 06m");
  });

  it("JA formatter mirrors structure with native units", () => {
    expect(formatSecondsSavedJa(0)).toBe("0秒");
    expect(formatSecondsSavedJa(45)).toBe("45秒");
    expect(formatSecondsSavedJa(60)).toBe("1分");
    expect(formatSecondsSavedJa(192)).toBe("3分12秒");
    expect(formatSecondsSavedJa(3600)).toBe("1時間");
    expect(formatSecondsSavedJa(3960)).toBe("1時間6分");
  });
});
