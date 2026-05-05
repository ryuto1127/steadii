import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({ users: {} }));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  isNotNull: () => ({}),
  isNull: () => ({}),
  lt: () => ({}),
  or: () => ({}),
}));

import { dayOfWeekInTimezone } from "@/lib/digest/weekly-picker";

// The picker SQL plumbing is straightforward; the per-tick decisions are
// driven by `dayOfWeekInTimezone` paired with the existing
// `hourInTimezone`. We test the day-of-week computation directly.

describe("dayOfWeekInTimezone", () => {
  it("returns 0 (Sunday) for a Sunday in Vancouver", () => {
    // 2026-05-03 17:00 PDT (UTC-7) = 2026-05-04 00:00 UTC.
    // Pre-conversion local date is Sunday May 3 in Vancouver.
    const now = new Date("2026-05-04T00:00:00Z");
    expect(dayOfWeekInTimezone(now, "America/Vancouver")).toBe(0);
  });

  it("returns 1 (Monday) when Vancouver is past midnight on Mon", () => {
    // 2026-05-04 09:00 UTC = 2026-05-04 02:00 PDT (Mon)
    const now = new Date("2026-05-04T09:00:00Z");
    expect(dayOfWeekInTimezone(now, "America/Vancouver")).toBe(1);
  });

  it("returns 0 (Sunday) for Tokyo at Sun 17:00 JST", () => {
    // 2026-05-03 08:00 UTC = 2026-05-03 17:00 JST (Sun)
    const now = new Date("2026-05-03T08:00:00Z");
    expect(dayOfWeekInTimezone(now, "Asia/Tokyo")).toBe(0);
  });

  it("returns null on an invalid timezone", () => {
    const now = new Date("2026-05-03T17:00:00Z");
    expect(dayOfWeekInTimezone(now, "Not/A_Real_Zone")).toBeNull();
  });
});
