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
});
