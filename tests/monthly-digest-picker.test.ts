import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ monthlyDigests: {}, users: {} }));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  isNotNull: () => ({}),
  isNull: () => ({}),
}));

import {
  coveredMonthBoundsInTimezone,
  dayOfMonthInTimezone,
  isFirstSundayOfMonthInTimezone,
  priorMonthStartInTimezone,
  wallClockToUtc,
} from "@/lib/agent/digest/monthly-picker";

// The CoS-mode monthly digest cron fires daily; the per-user gate
// narrows to "first Sunday of the user's local calendar month". These
// tests pin the timezone math so a DST shift or end-of-month boundary
// can't silently break the gate.

describe("dayOfMonthInTimezone", () => {
  it("returns the day of month in Vancouver", () => {
    const now = new Date("2026-05-04T05:00:00Z"); // = May 3 22:00 PDT
    expect(dayOfMonthInTimezone(now, "America/Vancouver")).toBe(3);
  });

  it("returns the day of month in Tokyo", () => {
    const now = new Date("2026-05-03T18:00:00Z"); // = May 4 03:00 JST
    expect(dayOfMonthInTimezone(now, "Asia/Tokyo")).toBe(4);
  });

  it("returns null on an invalid timezone", () => {
    expect(
      dayOfMonthInTimezone(new Date(), "Not/A_Real_Zone")
    ).toBeNull();
  });
});

describe("isFirstSundayOfMonthInTimezone", () => {
  it("is true on Sunday May 3 2026 in Vancouver", () => {
    // 2026-05-03 17:00 PDT = 2026-05-04 00:00 UTC (Vancouver still
    // sees Sunday May 3 because the instant straddles midnight UTC).
    const now = new Date("2026-05-04T00:00:00Z");
    expect(
      isFirstSundayOfMonthInTimezone(now, "America/Vancouver")
    ).toBe(true);
  });

  it("is false on Sunday May 10 2026 (second Sunday) in Vancouver", () => {
    const now = new Date("2026-05-11T00:00:00Z");
    expect(
      isFirstSundayOfMonthInTimezone(now, "America/Vancouver")
    ).toBe(false);
  });

  it("is false on a Monday", () => {
    // Mon May 4 2026 16:00 PDT
    const now = new Date("2026-05-04T23:00:00Z");
    expect(
      isFirstSundayOfMonthInTimezone(now, "America/Vancouver")
    ).toBe(false);
  });

  it("is true on Sunday Apr 5 2026 in Tokyo", () => {
    // Apr 5 09:00 JST = Apr 5 00:00 UTC (Sun)
    const now = new Date("2026-04-05T00:00:00Z");
    expect(isFirstSundayOfMonthInTimezone(now, "Asia/Tokyo")).toBe(
      true
    );
  });

  it("is false on Sunday Apr 12 2026 in Tokyo", () => {
    const now = new Date("2026-04-12T00:00:00Z");
    expect(isFirstSundayOfMonthInTimezone(now, "Asia/Tokyo")).toBe(
      false
    );
  });
});

describe("wallClockToUtc + coveredMonthBoundsInTimezone", () => {
  it("anchors May 1 00:00 Vancouver to the right UTC instant", () => {
    // May 1 2026 00:00 PDT (UTC-7) = May 1 2026 07:00 UTC.
    const dt = wallClockToUtc({
      year: 2026,
      month: 5,
      day: 1,
      hour: 0,
      minute: 0,
      tz: "America/Vancouver",
    });
    expect(dt.toISOString()).toBe("2026-05-01T07:00:00.000Z");
  });

  it("anchors Apr 1 00:00 Tokyo to the right UTC instant", () => {
    // Apr 1 2026 00:00 JST (UTC+9) = Mar 31 2026 15:00 UTC.
    const dt = wallClockToUtc({
      year: 2026,
      month: 4,
      day: 1,
      hour: 0,
      minute: 0,
      tz: "Asia/Tokyo",
    });
    expect(dt.toISOString()).toBe("2026-03-31T15:00:00.000Z");
  });

  it("covers April when fired on May 3 in Vancouver", () => {
    const now = new Date("2026-05-04T00:00:00Z"); // Vancouver: May 3 17:00
    const { monthStart, monthEnd, isoMonthKey } =
      coveredMonthBoundsInTimezone(now, "America/Vancouver");
    expect(isoMonthKey).toBe("2026-04");
    // Apr 1 PDT (UTC-7) = Apr 1 07:00 UTC.
    expect(monthStart.toISOString()).toBe("2026-04-01T07:00:00.000Z");
    // May 1 PDT (UTC-7) = May 1 07:00 UTC.
    expect(monthEnd.toISOString()).toBe("2026-05-01T07:00:00.000Z");
  });

  it("covers March when fired on April 5 in Tokyo", () => {
    const now = new Date("2026-04-05T01:00:00Z"); // Tokyo: Apr 5 10:00
    const { monthStart, monthEnd, isoMonthKey } =
      coveredMonthBoundsInTimezone(now, "Asia/Tokyo");
    expect(isoMonthKey).toBe("2026-03");
    expect(monthStart.toISOString()).toBe("2026-02-28T15:00:00.000Z");
    expect(monthEnd.toISOString()).toBe("2026-03-31T15:00:00.000Z");
  });

  it("priorMonthStart is the month before the covered month", () => {
    // Vancouver, May 3 17:00 — covered=April, prior=March.
    const now = new Date("2026-05-04T00:00:00Z");
    const prior = priorMonthStartInTimezone(now, "America/Vancouver");
    // Mar 1 PDT (UTC-8 in PST during DST shift) — actually March 1
    // 2026 is in PST (UTC-8) because DST started March 8 2026.
    // 00:00 PST = 08:00 UTC.
    expect(prior.toISOString()).toBe("2026-03-01T08:00:00.000Z");
  });

  it("wraps year correctly when covered month is January", () => {
    // Feb 1 2026 in Vancouver — covered=Jan 2026, prior=Dec 2025.
    const now = new Date("2026-02-02T00:00:00Z"); // Vancouver: Feb 1 16:00
    const { isoMonthKey } = coveredMonthBoundsInTimezone(
      now,
      "America/Vancouver"
    );
    expect(isoMonthKey).toBe("2026-01");
    const prior = priorMonthStartInTimezone(now, "America/Vancouver");
    // Dec 1 2025 PST (UTC-8) = Dec 1 2025 08:00 UTC.
    expect(prior.toISOString()).toBe("2025-12-01T08:00:00.000Z");
  });
});
