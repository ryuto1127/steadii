import { describe, expect, it } from "vitest";
import {
  matchToCalendar,
  parseSimpleDate,
} from "@/lib/agent/proactive/syllabus-match";

describe("syllabus auto-import — matchToCalendar", () => {
  it("returns confident_match when time + class code align", () => {
    const evt = {
      syllabusRowKey: "syl1:0",
      classCode: "MATH200",
      className: "Math II",
      startsAt: new Date("2026-05-16T14:00:00Z"),
      endsAt: new Date("2026-05-16T15:30:00Z"),
      label: "中間試験",
      isExam: true,
    };
    const inWindow = [
      {
        id: "evt-existing",
        externalId: "g-evt-1",
        title: "MATH200 試験",
        startsAt: new Date("2026-05-16T14:00:00Z"),
      },
    ];
    const outcome = matchToCalendar(evt, inWindow);
    expect(outcome.kind).toBe("confident_match");
  });

  it("returns confident_no_match when nothing similar exists", () => {
    const evt = {
      syllabusRowKey: "syl1:0",
      classCode: "MATH200",
      className: "Math II",
      startsAt: new Date("2026-05-16T14:00:00Z"),
      endsAt: new Date("2026-05-16T15:30:00Z"),
      label: "中間試験",
      isExam: true,
    };
    const outcome = matchToCalendar(evt, []);
    expect(outcome.kind).toBe("confident_no_match");
  });

  it("returns ambiguous when time matches but title differs", () => {
    const evt = {
      syllabusRowKey: "syl1:0",
      classCode: "MATH200",
      className: "Math II",
      startsAt: new Date("2026-05-16T14:00:00Z"),
      endsAt: new Date("2026-05-16T15:30:00Z"),
      label: "中間試験",
      isExam: true,
    };
    const inWindow = [
      {
        id: "evt-existing",
        externalId: "g-evt-1",
        title: "Some unrelated meeting",
        startsAt: new Date("2026-05-16T14:00:00Z"),
      },
    ];
    const outcome = matchToCalendar(evt, inWindow);
    expect(outcome.kind).toBe("ambiguous");
  });
});

describe("syllabus auto-import — parseSimpleDate", () => {
  it("parses ISO datetime", () => {
    const d = parseSimpleDate("2026-05-16T14:00:00Z");
    expect(d).not.toBeNull();
  });
  it("parses M/D format", () => {
    const d = parseSimpleDate("5/16");
    expect(d).not.toBeNull();
  });
  it("parses Japanese 月日 format", () => {
    const d = parseSimpleDate("5月16日");
    expect(d).not.toBeNull();
  });
  it("returns null on garbage", () => {
    expect(parseSimpleDate("")).toBeNull();
  });
  it("defaults bare YYYY-MM-DD to 9 AM local time", () => {
    const d = parseSimpleDate("2026-01-13");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0); // January
    expect(d!.getDate()).toBe(13);
    expect(d!.getHours()).toBe(9);
  });
  it("parses 'Jan 13' (current year, 9 AM)", () => {
    const d = parseSimpleDate("Jan 13");
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(13);
    expect(d!.getHours()).toBe(9);
  });
  it("parses 'January 13, 2026'", () => {
    const d = parseSimpleDate("January 13, 2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(13);
  });
  it("parses 'Week 1: Jan 8' by scanning the string", () => {
    const d = parseSimpleDate("Week 1: Jan 8");
    expect(d).not.toBeNull();
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(8);
  });
  it("parses 'Mon Jan 13 2026'", () => {
    const d = parseSimpleDate("Mon Jan 13 2026");
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(0);
    expect(d!.getDate()).toBe(13);
  });
  it("returns null on 'TBD'", () => {
    expect(parseSimpleDate("TBD")).toBeNull();
  });
  it("returns null on '第1週' (Japanese week marker)", () => {
    expect(parseSimpleDate("第1週")).toBeNull();
  });
});
