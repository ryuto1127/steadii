import { describe, it, expect } from "vitest";
import { parseIcal } from "@/lib/integrations/ical/parser";

const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:lecture-1@school.edu
SUMMARY:CSC108 Lecture
DESCRIPTION:Bring laptop
LOCATION:BA1190
DTSTART:20260426T150000Z
DTEND:20260426T163000Z
STATUS:CONFIRMED
END:VEVENT
BEGIN:VEVENT
UID:holiday-1@school.edu
SUMMARY:All-day event
DTSTART;VALUE=DATE:20260427
DTEND;VALUE=DATE:20260428
END:VEVENT
BEGIN:VEVENT
UID:far-future@school.edu
SUMMARY:Way out of window
DTSTART:20300101T000000Z
DTEND:20300101T010000Z
END:VEVENT
END:VCALENDAR
`;

describe("parseIcal", () => {
  const windowStart = new Date("2026-04-25T00:00:00Z");
  const windowEnd = new Date("2026-05-05T00:00:00Z");

  it("returns VEVENTs inside the window in flat shape", () => {
    const out = parseIcal(SAMPLE_ICS, { windowStart, windowEnd });
    const titles = out.map((e) => e.title);
    expect(titles).toContain("CSC108 Lecture");
    expect(titles).toContain("All-day event");
  });

  it("filters out events outside the window", () => {
    const out = parseIcal(SAMPLE_ICS, { windowStart, windowEnd });
    const titles = out.map((e) => e.title);
    expect(titles).not.toContain("Way out of window");
  });

  it("flags VALUE=DATE events as all-day", () => {
    const out = parseIcal(SAMPLE_ICS, { windowStart, windowEnd });
    const allDay = out.find((e) => e.title === "All-day event");
    expect(allDay?.isAllDay).toBe(true);
    const timed = out.find((e) => e.title === "CSC108 Lecture");
    expect(timed?.isAllDay).toBe(false);
  });

  it("preserves location, description, and uid", () => {
    const out = parseIcal(SAMPLE_ICS, { windowStart, windowEnd });
    const lecture = out.find((e) => e.title === "CSC108 Lecture");
    expect(lecture?.uid).toBe("lecture-1@school.edu");
    expect(lecture?.location).toBe("BA1190");
    expect(lecture?.description).toBe("Bring laptop");
    expect(lecture?.status).toBe("confirmed");
  });

  it("returns empty array when no VEVENTs match", () => {
    const empty = parseIcal(SAMPLE_ICS, {
      windowStart: new Date("2030-06-01"),
      windowEnd: new Date("2030-06-30"),
    });
    expect(empty).toEqual([]);
  });

  it("tolerates a malformed feed (no throw)", () => {
    expect(() =>
      parseIcal("not-an-ics-document", { windowStart, windowEnd })
    ).not.toThrow();
  });
});
