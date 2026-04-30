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

  // Real-world α regression: a typical course timetable has a master
  // DTSTART weeks in the past + RRULE forward through the term. Without
  // RRULE expansion the master DTSTART is filtered out by the window
  // check and zero rows surface. Each occurrence in the window must be
  // emitted as its own row keyed by recurrenceId so downstream upserts
  // don't collide on the unique (userId, sourceType, externalId) index.
  it("expands RRULE occurrences within the window", () => {
    const recurringIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
BEGIN:VEVENT
UID:weekly-class@school.edu
SUMMARY:CSC108 Lecture
DTSTART:20260202T150000Z
DTEND:20260202T163000Z
RRULE:FREQ=WEEKLY;BYDAY=MO
END:VEVENT
END:VCALENDAR
`;
    const out = parseIcal(recurringIcs, {
      windowStart: new Date("2026-04-25T00:00:00Z"),
      windowEnd: new Date("2026-05-25T00:00:00Z"),
    });
    // Apr 27, May 4, May 11, May 18 — four Mondays in the 30-day window.
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const row of out) {
      expect(row.title).toBe("CSC108 Lecture");
      expect(row.recurrenceId).not.toBeNull();
      expect(row.endsAt!.getTime() - row.startsAt.getTime()).toBe(
        90 * 60 * 1000
      );
    }
    // Each instance has a unique externalId-input (recurrenceId).
    const keys = out.map((r) => r.recurrenceId);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
