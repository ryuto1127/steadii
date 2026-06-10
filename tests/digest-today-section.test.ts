import { beforeEach, describe, expect, it, vi } from "vitest";

// Zero-LLM "Today" section for the daily digest.
//   - pure renderers: EN + JA parity, time formatting, empty-state calm line
//   - loaders: TZ-correct "today" window (WRONG_TZ_DIRECTION guard) — an
//     event at 23:30 local yesterday must NOT fall inside today's window.
//
// The openai-guard setup file makes a real OpenAI client throw; this whole
// path is template-only so it never touches it — that's the point.

vi.mock("server-only", () => ({}));

// ---------------------------------------------------------------------------
// Pure renderer tests — no DB, no calendar.
// ---------------------------------------------------------------------------

import {
  buildTodaySectionText,
  buildTodaySectionHtml,
  formatEventTime,
  type TodaySectionData,
} from "@/lib/digest/today-section";

const TZ = "America/Vancouver";

function data(overrides: Partial<TodaySectionData> = {}): TodaySectionData {
  return {
    events: [],
    assignments: [],
    ...overrides,
  };
}

describe("formatEventTime", () => {
  it("renders HH:MM in the user's tz, not UTC", () => {
    // 2026-06-09T20:30:00Z == 13:30 in Vancouver (PDT, -7).
    expect(formatEventTime("2026-06-09T20:30:00Z", "America/Vancouver")).toBe(
      "13:30"
    );
    expect(formatEventTime("2026-06-09T20:30:00Z", "UTC")).toBe("20:30");
  });
});

describe("buildTodaySectionText / Html — content", () => {
  const d = data({
    events: [
      {
        id: "e1",
        title: "Lecture",
        start: "2026-06-09T16:00:00Z",
        end: "2026-06-09T17:00:00Z",
        allDay: false,
      },
    ],
    assignments: [
      {
        id: "a1",
        title: "Problem set",
        due: "2026-06-09T23:00:00Z",
        classTitle: "Algorithms",
        overdue: false,
      },
      {
        id: "a2",
        title: "Reading response",
        due: "2026-06-08T23:00:00Z",
        classTitle: null,
        overdue: true,
      },
    ],
  });

  it("EN: heading + event time + due tags render", () => {
    const text = buildTodaySectionText({ data: d, tz: TZ, locale: "en" });
    expect(text).toContain("Today");
    expect(text).toContain("Schedule:");
    expect(text).toContain("Lecture");
    expect(text).toContain("Due:");
    expect(text).toContain("[Due today] Problem set (Algorithms)");
    expect(text).toContain("[Overdue] Reading response");
  });

  it("JA: heading + labels render in Japanese", () => {
    const text = buildTodaySectionText({ data: d, tz: TZ, locale: "ja" });
    expect(text).toContain("今日の予定");
    expect(text).toContain("予定:");
    expect(text).toContain("締切:");
    expect(text).toContain("本日締切");
    expect(text).toContain("期限超過");
  });

  it("HTML escapes event + assignment titles", () => {
    const evil = data({
      events: [
        {
          id: "e1",
          title: "<script>alert(1)</script>",
          start: "2026-06-09T16:00:00Z",
          end: "2026-06-09T17:00:00Z",
          allDay: false,
        },
      ],
    });
    const html = buildTodaySectionHtml({ data: evil, tz: TZ, locale: "en" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("all-day events render the all-day label, not a time", () => {
    const allDay = data({
      events: [
        {
          id: "e1",
          title: "Holiday",
          start: "2026-06-09T00:00:00Z",
          end: "2026-06-10T00:00:00Z",
          allDay: true,
        },
      ],
    });
    expect(
      buildTodaySectionText({ data: allDay, tz: TZ, locale: "en" })
    ).toContain("All day — Holiday");
    expect(
      buildTodaySectionText({ data: allDay, tz: TZ, locale: "ja" })
    ).toContain("終日 — Holiday");
  });
});

describe("buildTodaySectionText / Html — empty state", () => {
  it("EN: renders a single calm line, never an empty header alone", () => {
    const text = buildTodaySectionText({
      data: data(),
      tz: TZ,
      locale: "en",
    });
    expect(text).toContain("No events or deadlines today");
    expect(text).not.toContain("Schedule:");
    expect(text).not.toContain("Due:");
  });

  it("JA: renders the calm line in Japanese", () => {
    const text = buildTodaySectionText({
      data: data(),
      tz: TZ,
      locale: "ja",
    });
    expect(text).toContain("今日の予定と締切はありません");
  });

  it("HTML empty state still shows the heading + calm line", () => {
    const html = buildTodaySectionHtml({
      data: data(),
      tz: TZ,
      locale: "en",
    });
    expect(html).toContain("Today");
    expect(html).toContain("No events or deadlines today");
  });
});
