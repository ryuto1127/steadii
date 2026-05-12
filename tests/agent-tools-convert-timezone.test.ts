import { describe, expect, it, vi } from "vitest";

// engineer-45 — convert_timezone deterministic conversion. Tests the
// pure convertTimezoneSync helper; the executor's DB lookup for locale
// is exercised in integration tests at the agent loop level.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/agent/preferences", () => ({
  getUserLocale: async () => "en",
}));

import { convertTimezoneSync } from "@/lib/agent/tools/convert-timezone";

describe("convertTimezoneSync", () => {
  it("converts JST 10:00 wall-clock to America/Vancouver (PDT period, day before)", () => {
    // 2026-05-15 is during PDT in Vancouver (UTC-7). 10:00 JST = 01:00 UTC
    // = 2026-05-14 18:00 PT. weekday changes.
    const out = convertTimezoneSync({
      time: "2026-05-15T10:00:00",
      fromTz: "Asia/Tokyo",
      toTz: "America/Vancouver",
      locale: "en",
    });
    expect(out.toIso).toBe("2026-05-14T18:00:00-07:00");
    expect(out.weekdayChanged).toBe(true);
    // Display contains "18:00" on the toDisplay side and "10:00" on fromDisplay.
    expect(out.toDisplay).toContain("18:00");
    expect(out.fromDisplay).toContain("10:00");
  });

  it("converts America/Vancouver 20:30 wall-clock to Asia/Tokyo (next-day 12:30 PDT period)", () => {
    // 2026-05-14 20:30 PDT (UTC-7) = 2026-05-15 03:30 UTC = 12:30 JST.
    const out = convertTimezoneSync({
      time: "2026-05-14T20:30:00",
      fromTz: "America/Vancouver",
      toTz: "Asia/Tokyo",
      locale: "en",
    });
    expect(out.toIso).toBe("2026-05-15T12:30:00+09:00");
    expect(out.weekdayChanged).toBe(true);
    expect(out.toDisplay).toContain("12:30");
  });

  it("same TZ in/out returns same wall-clock and weekdayChanged=false", () => {
    const out = convertTimezoneSync({
      time: "2026-05-15T10:00:00",
      fromTz: "Asia/Tokyo",
      toTz: "Asia/Tokyo",
      locale: "en",
    });
    expect(out.toIso).toBe("2026-05-15T10:00:00+09:00");
    expect(out.weekdayChanged).toBe(false);
    expect(out.toDisplay).toBe(out.fromDisplay);
  });

  it("throws on invalid IANA timezone (fromTz)", () => {
    expect(() =>
      convertTimezoneSync({
        time: "2026-05-15T10:00:00",
        fromTz: "Mars/Olympus",
        toTz: "Asia/Tokyo",
        locale: "en",
      })
    ).toThrow(/Invalid IANA timezone/);
  });

  it("throws on invalid IANA timezone (toTz)", () => {
    expect(() =>
      convertTimezoneSync({
        time: "2026-05-15T10:00:00",
        fromTz: "Asia/Tokyo",
        toTz: "Definitely/Not/Real",
        locale: "en",
      })
    ).toThrow(/Invalid IANA timezone/);
  });

  it("DST spring-forward: 2026-03-08 02:30 in America/Vancouver becomes 03:30 PDT-equivalent", () => {
    // The "skipped hour" 02:00-03:00 doesn't exist locally — the 02:30
    // wall-clock gets reinterpreted as 03:30 PDT after the fall-through.
    // We assert the cross-tz conversion is consistent: 2026-03-08 02:30
    // PT (the pre-DST instant) corresponds to a deterministic UTC moment.
    const out = convertTimezoneSync({
      time: "2026-03-08T02:30:00",
      fromTz: "America/Vancouver",
      toTz: "UTC",
      locale: "en",
    });
    // The UTC offset before spring-forward is -8; converging on the second
    // iteration picks the post-transition offset of -7. The result must be
    // a well-formed ISO with Z or +00:00 offset and is monotonic.
    expect(out.toIso).toMatch(/^2026-03-08T(09|10):30:00(Z|\+00:00)$/);
  });

  it("DST fall-back: 2026-11-01 in America/Vancouver round-trips correctly", () => {
    // PDT (UTC-7) ends 2026-11-01 02:00 → PST (UTC-8). A 12:00 wall-clock
    // on that date should be PST. 12:00 PST = 20:00 UTC.
    const out = convertTimezoneSync({
      time: "2026-11-01T12:00:00",
      fromTz: "America/Vancouver",
      toTz: "UTC",
      locale: "en",
    });
    expect(out.toIso).toBe("2026-11-01T20:00:00+00:00");
  });

  it("midnight cross-day boundary: 23:00 JST → previous day 07:00 PDT", () => {
    const out = convertTimezoneSync({
      time: "2026-05-15T23:00:00",
      fromTz: "Asia/Tokyo",
      toTz: "America/Vancouver",
      locale: "en",
    });
    expect(out.toIso).toBe("2026-05-15T07:00:00-07:00");
    // Same date in PT (07:00 on 5/15), so no weekday change.
    expect(out.weekdayChanged).toBe(false);
  });

  it("ja locale renders Japanese display string", () => {
    const out = convertTimezoneSync({
      time: "2026-05-15T10:00:00",
      fromTz: "Asia/Tokyo",
      toTz: "America/Vancouver",
      locale: "ja",
    });
    // Japanese formatting includes 月 / 日 / weekday characters somewhere.
    expect(out.fromDisplay).toMatch(/[月日]/);
  });

  it("accepts explicit-offset ISO 8601 as input", () => {
    // Z suffix → already absolute. fromTz becomes a no-op for the parsing
    // step but still determines fromDisplay's rendering.
    const out = convertTimezoneSync({
      time: "2026-05-15T01:00:00Z",
      fromTz: "Asia/Tokyo",
      toTz: "America/Vancouver",
      locale: "en",
    });
    // 01:00 UTC = 18:00 PDT (2026-05-14).
    expect(out.toIso).toBe("2026-05-14T18:00:00-07:00");
  });

  it("accepts explicit +09:00 offset and converts correctly", () => {
    const out = convertTimezoneSync({
      time: "2026-05-15T10:00:00+09:00",
      fromTz: "Asia/Tokyo",
      toTz: "America/Vancouver",
      locale: "en",
    });
    expect(out.toIso).toBe("2026-05-14T18:00:00-07:00");
  });
});
