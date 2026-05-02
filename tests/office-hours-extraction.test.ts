import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({ chat: { completions: { create: vi.fn() } } }),
}));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: vi.fn(async () => ({ usageId: "usage-1" })),
}));
vi.mock("@/lib/agent/models", () => ({ selectModel: () => "gpt-test" }));
vi.mock("@/lib/db/schema", () => ({}));

import {
  expandSlotToDates,
  parseExtraction,
} from "@/lib/agent/office-hours/extract";

describe("parseExtraction", () => {
  it("parses well-formed slot output", () => {
    const raw = JSON.stringify({
      slots: [
        {
          weekday: 2,
          startTime: "14:00",
          endTime: "16:00",
          location: "MP203",
          notes: null,
        },
      ],
      rawNote: null,
      bookingUrl: null,
      professorEmail: "tanaka@u.ac.jp",
    });
    const result = parseExtraction(raw);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]?.weekday).toBe(2);
    expect(result.slots[0]?.startTime).toBe("14:00");
    expect(result.slots[0]?.location).toBe("MP203");
    expect(result.professorEmail).toBe("tanaka@u.ac.jp");
  });

  it("drops malformed slots (bad weekday / time)", () => {
    const raw = JSON.stringify({
      slots: [
        { weekday: 9, startTime: "14:00", endTime: "16:00", location: null, notes: null },
        { weekday: 1, startTime: "garbage", endTime: "16:00", location: null, notes: null },
        { weekday: 3, startTime: "10:00", endTime: "11:00", location: null, notes: null },
      ],
      rawNote: null,
      bookingUrl: null,
      professorEmail: null,
    });
    const result = parseExtraction(raw);
    expect(result.slots).toHaveLength(1);
    expect(result.slots[0]?.weekday).toBe(3);
  });

  it("normalizes single-digit hours into HH:MM", () => {
    const raw = JSON.stringify({
      slots: [
        { weekday: 1, startTime: "9:00", endTime: "10:00", location: null, notes: null },
      ],
      rawNote: null,
      bookingUrl: null,
      professorEmail: null,
    });
    const result = parseExtraction(raw);
    expect(result.slots[0]?.startTime).toBe("09:00");
  });

  it("returns empty extraction on garbage JSON", () => {
    const result = parseExtraction("not json");
    expect(result.slots).toEqual([]);
    expect(result.bookingUrl).toBeNull();
  });
});

describe("expandSlotToDates", () => {
  it("yields N future Tuesdays for a Tuesday slot", () => {
    const from = new Date("2026-05-04T08:00:00Z"); // Monday in UTC
    const dates = expandSlotToDates(
      { weekday: 2, startTime: "14:00", endTime: "16:00", location: "MP203" },
      from,
      3
    );
    expect(dates).toHaveLength(3);
    for (const d of dates) {
      expect(d.startsAt.getDay()).toBe(2);
      expect(d.location).toBe("MP203");
    }
  });

  it("skips slots earlier on the same day", () => {
    // Tuesday 13:00 local
    const from = new Date(2026, 4, 5, 13, 0, 0);
    const dates = expandSlotToDates(
      { weekday: 2, startTime: "10:00", endTime: "12:00" },
      from,
      1
    );
    expect(dates).toHaveLength(1);
    // Should land on the *next* Tuesday, not today.
    expect(dates[0]!.startsAt.getDate()).not.toBe(from.getDate());
  });
});
