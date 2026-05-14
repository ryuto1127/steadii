import { describe, it, expect } from "vitest";
import { shortRelativeTime } from "@/lib/utils/relative-time";

const NOW = new Date(2026, 4, 13, 14, 30, 0);

describe("shortRelativeTime", () => {
  it("returns 'now' for sub-minute deltas", () => {
    expect(shortRelativeTime(new Date(2026, 4, 13, 14, 29, 31), NOW)).toBe(
      "now"
    );
    expect(shortRelativeTime(NOW, NOW)).toBe("now");
  });

  it("returns minutes for sub-hour deltas", () => {
    expect(shortRelativeTime(new Date(2026, 4, 13, 14, 0, 0), NOW)).toBe("30m");
    expect(shortRelativeTime(new Date(2026, 4, 13, 13, 31, 0), NOW)).toBe(
      "59m"
    );
  });

  it("returns hours for sub-day deltas", () => {
    expect(shortRelativeTime(new Date(2026, 4, 13, 11, 30, 0), NOW)).toBe("3h");
    expect(shortRelativeTime(new Date(2026, 4, 12, 15, 30, 0), NOW)).toBe(
      "23h"
    );
  });

  it("returns days for sub-week deltas", () => {
    expect(shortRelativeTime(new Date(2026, 4, 11, 14, 30, 0), NOW)).toBe("2d");
    expect(shortRelativeTime(new Date(2026, 4, 7, 14, 30, 0), NOW)).toBe("6d");
  });

  it("falls back to M/D for older timestamps", () => {
    expect(shortRelativeTime(new Date(2026, 3, 1, 14, 30, 0), NOW)).toBe("4/1");
    expect(shortRelativeTime(new Date(2025, 11, 31, 14, 30, 0), NOW)).toBe(
      "12/31"
    );
  });

  it("clamps future timestamps to 'now' rather than emitting negatives", () => {
    expect(shortRelativeTime(new Date(2026, 4, 13, 15, 0, 0), NOW)).toBe("now");
  });
});
