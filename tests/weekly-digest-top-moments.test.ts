import { describe, expect, it } from "vitest";
import {
  hasDeadlineKeyword,
  selectTopMoments,
  type MomentCandidate,
} from "@/lib/digest/top-moments";

const baseDate = new Date("2026-05-03T17:00:00Z");

function make(
  partial: Partial<MomentCandidate> &
    Pick<MomentCandidate, "id" | "source" | "subject" | "occurredAt">
): MomentCandidate {
  return {
    ...partial,
  } as MomentCandidate;
}

describe("hasDeadlineKeyword", () => {
  it("matches EN tokens case-insensitively", () => {
    expect(hasDeadlineKeyword("Submit your proposal")).toBe(true);
    expect(hasDeadlineKeyword("essay DUE Friday")).toBe(true);
    expect(hasDeadlineKeyword("regular update")).toBe(false);
  });

  it("matches JA tokens", () => {
    expect(hasDeadlineKeyword("提出のお願い")).toBe(true);
    expect(hasDeadlineKeyword("締切リマインド")).toBe(true);
    expect(hasDeadlineKeyword("期限について")).toBe(true);
  });
});

describe("selectTopMoments", () => {
  it("HIGH-tier sent unmodified beats deadline keyword beats calendar import", () => {
    const high = make({
      id: "h",
      source: "draft",
      subject: "ECON 200 essay reply",
      occurredAt: new Date(baseDate.getTime() - 30000),
      riskTier: "high",
      sentUnmodified: true,
    });
    const deadline = make({
      id: "d",
      source: "draft",
      subject: "Late submit deadline reminder",
      occurredAt: new Date(baseDate.getTime() - 20000),
      riskTier: "medium",
      sentUnmodified: true,
    });
    const cal = make({
      id: "c",
      source: "calendar_import",
      subject: "MAT223 midterm",
      occurredAt: new Date(baseDate.getTime() - 10000),
    });
    const result = selectTopMoments([cal, deadline, high]);
    expect(result.map((r) => r.id)).toEqual(["h", "d", "c"]);
    expect(result.map((r) => r.priority)).toEqual([1, 2, 3]);
  });

  it("breaks ties in priority by recency (newest first)", () => {
    const older = make({
      id: "older",
      source: "calendar_import",
      subject: "old syllabus event",
      occurredAt: new Date(baseDate.getTime() - 60000),
    });
    const newer = make({
      id: "newer",
      source: "calendar_import",
      subject: "newer syllabus event",
      occurredAt: new Date(baseDate.getTime() - 1000),
    });
    const result = selectTopMoments([older, newer]);
    expect(result.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("caps at 3 entries by default", () => {
    const candidates: MomentCandidate[] = Array.from({ length: 6 }, (_, i) =>
      make({
        id: `c${i}`,
        source: "calendar_import",
        subject: `event ${i}`,
        occurredAt: new Date(baseDate.getTime() - i * 1000),
      })
    );
    const result = selectTopMoments(candidates);
    expect(result).toHaveLength(3);
  });

  it("ignores candidates with no qualifying priority signal", () => {
    const noisy: MomentCandidate[] = [
      make({
        id: "low-draft-no-deadline",
        source: "draft",
        subject: "regular monthly newsletter",
        occurredAt: baseDate,
        riskTier: "low",
        sentUnmodified: true,
      }),
      make({
        id: "proposal-no-deadline",
        source: "proposal",
        subject: "scheduling change",
        occurredAt: baseDate,
      }),
    ];
    const result = selectTopMoments(noisy);
    expect(result).toEqual([]);
  });

  it("HIGH-tier draft that was edited does NOT earn priority 1", () => {
    const high = make({
      id: "edited",
      source: "draft",
      subject: "general inquiry",
      occurredAt: baseDate,
      riskTier: "high",
      sentUnmodified: false,
    });
    const result = selectTopMoments([high]);
    expect(result).toEqual([]);
  });
});
