import { describe, expect, it } from "vitest";

import {
  extractDateTimeMatches,
  extractTimeNear,
  isoDateOf,
  isoTimeOf,
  parseClockToken,
} from "@/lib/agent/proactive/datetime-extract";

// 2026-05-27 — shared date/time extractor backing the auto-cal
// detectors. Must parse numeric/JA AND English long-form dates, plus
// 12-hour AM/PM clock times, returning positional matches. All fixtures
// are SYNTHETIC.

describe("parseClockToken — 12h → 24h", () => {
  it("4:00 PM → 16:00", () => {
    expect(parseClockToken("4:00 PM")).toEqual({ hour: 16, minute: 0 });
  });
  it("12:00 PM → 12:00 (noon)", () => {
    expect(parseClockToken("12:00 PM")).toEqual({ hour: 12, minute: 0 });
  });
  it("12:00 AM → 00:00 (midnight)", () => {
    expect(parseClockToken("12:00 AM")).toEqual({ hour: 0, minute: 0 });
  });
  it("9 AM → 09:00 (no minutes)", () => {
    expect(parseClockToken("9 AM")).toEqual({ hour: 9, minute: 0 });
  });
  it("4pm → 16:00 (no space, no minutes)", () => {
    expect(parseClockToken("4pm")).toEqual({ hour: 16, minute: 0 });
  });
  it("4:00pm → 16:00 (no space)", () => {
    expect(parseClockToken("4:00pm")).toEqual({ hour: 16, minute: 0 });
  });
  it("4:30 p.m. → 16:30 (dotted meridiem)", () => {
    expect(parseClockToken("4:30 p.m.")).toEqual({ hour: 16, minute: 30 });
  });
  it("16:00 → 16:00 (bare 24h passes through)", () => {
    expect(parseClockToken("16:00")).toEqual({ hour: 16, minute: 0 });
  });
  it("returns null for a bare hour with no meridiem and no minutes", () => {
    expect(parseClockToken("4")).toBeNull();
  });
  it("returns null for an out-of-range 12h hour", () => {
    expect(parseClockToken("13 PM")).toBeNull();
  });
  it("returns null for an out-of-range 24h hour", () => {
    expect(parseClockToken("25:00")).toBeNull();
  });
});

describe("extractDateTimeMatches — numeric/JA (regression guard)", () => {
  it("parses 6/2 with referenceYear", () => {
    const m = extractDateTimeMatches("提出は 6/2 までに", 2026);
    expect(m).toHaveLength(1);
    expect(isoDateOf(m[0])).toBe("2026-06-02");
    expect(m[0].hour).toBeUndefined();
  });
  it("parses 6月2日", () => {
    const m = extractDateTimeMatches("6月2日が締切です", 2026);
    expect(isoDateOf(m[0])).toBe("2026-06-02");
  });
  it("parses 5/22 14:00 with a 24h time", () => {
    const m = extractDateTimeMatches("5/22 14:00 でお願いします", 2026);
    expect(isoDateOf(m[0])).toBe("2026-05-22");
    expect(isoTimeOf(m[0].hour!, m[0].minute!)).toBe("14:00");
  });
  it("uses the embedded year when present", () => {
    const m = extractDateTimeMatches("2027/06/15 10:00", 2026);
    expect(isoDateOf(m[0])).toBe("2027-06-15");
  });
  it("drops out-of-range numeric dates", () => {
    const m = extractDateTimeMatches("13/45 までに", 2026);
    expect(m).toHaveLength(0);
  });
});

describe("extractDateTimeMatches — English long-form", () => {
  it("parses 'October 14, 2026'", () => {
    const m = extractDateTimeMatches("the deadline of October 14, 2026", 2025);
    expect(m).toHaveLength(1);
    expect(isoDateOf(m[0])).toBe("2026-10-14");
  });
  it("parses 'October 8' falling back to referenceYear", () => {
    const m = extractDateTimeMatches("see you on October 8", 2026);
    expect(isoDateOf(m[0])).toBe("2026-10-08");
  });
  it("parses an abbreviated month 'Oct 8, 2026'", () => {
    const m = extractDateTimeMatches("Oct 8, 2026", 2025);
    expect(isoDateOf(m[0])).toBe("2026-10-08");
  });
  it("parses an abbreviated month with trailing dot 'Sept. 9, 2026'", () => {
    const m = extractDateTimeMatches("Sept. 9, 2026", 2025);
    expect(isoDateOf(m[0])).toBe("2026-09-09");
  });
  it("parses a leading weekday 'Thursday, October 8, 2026'", () => {
    const m = extractDateTimeMatches("Thursday, October 8, 2026", 2025);
    expect(isoDateOf(m[0])).toBe("2026-10-08");
  });
  it("parses date + AM/PM time 'October 8, 2026 4:00 PM'", () => {
    const m = extractDateTimeMatches("October 8, 2026 4:00 PM", 2025);
    expect(isoDateOf(m[0])).toBe("2026-10-08");
    expect(isoTimeOf(m[0].hour!, m[0].minute!)).toBe("16:00");
  });
  it("parses date + 'at' + time 'October 8 at 4 PM'", () => {
    const m = extractDateTimeMatches("October 8 at 4 PM", 2026);
    expect(isoTimeOf(m[0].hour!, m[0].minute!)).toBe("16:00");
  });
  it("parses an ordinal day '14th'", () => {
    const m = extractDateTimeMatches("October 14th, 2026", 2025);
    expect(isoDateOf(m[0])).toBe("2026-10-14");
  });
  it("computes durationMin from a time range '4:00 PM - 5:00 PM'", () => {
    const m = extractDateTimeMatches("October 8, 2026 4:00 PM - 5:00 PM", 2025);
    expect(m[0].durationMin).toBe(60);
  });
  it("computes durationMin for a 90-minute range", () => {
    const m = extractDateTimeMatches("October 8, 2026 4:00 PM - 5:30 PM", 2025);
    expect(m[0].durationMin).toBe(90);
  });
  it("leaves durationMin undefined when there's no range", () => {
    const m = extractDateTimeMatches("October 8, 2026 4:00 PM", 2025);
    expect(m[0].durationMin).toBeUndefined();
  });
});

describe("extractTimeNear — standalone time scan", () => {
  it("finds a time in a 'Time:' line", () => {
    const r = extractTimeNear("Time: 4:00 PM Eastern Time");
    expect(r).toEqual({ hour: 16, minute: 0 });
  });
  it("captures a range duration in a 'Time:' line", () => {
    const r = extractTimeNear("Time: 4:00 PM - 5:00 PM Eastern Time");
    expect(r).toEqual({ hour: 16, minute: 0, durationMin: 60 });
  });
  it("returns null when no clock time is present", () => {
    expect(extractTimeNear("Time: to be announced")).toBeNull();
  });
});
