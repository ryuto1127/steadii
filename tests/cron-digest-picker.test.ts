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
  sql: Object.assign(
    (strings: TemplateStringsArray) => strings.join(""),
    { raw: () => ({}) }
  ),
}));

import { hourInTimezone } from "@/lib/digest/picker";

// The picker's DB query logic is straightforward; the interesting part
// is the per-user hourInTimezone computation that decides whether a
// given tick matches a user's digest_hour_local. We test that directly.

describe("hourInTimezone", () => {
  it("returns 7 for 7am Vancouver when now is 7:15 Vancouver (UTC-8)", () => {
    // 2026-04-23 14:15 UTC = 07:15 America/Vancouver (PDT, UTC-7)
    const now = new Date("2026-04-23T14:15:00Z");
    expect(hourInTimezone(now, "America/Vancouver")).toBe(7);
  });

  it("returns 22 for 10pm Tokyo (Asia/Tokyo UTC+9)", () => {
    // 2026-04-23 13:00 UTC = 22:00 Tokyo
    const now = new Date("2026-04-23T13:00:00Z");
    expect(hourInTimezone(now, "Asia/Tokyo")).toBe(22);
  });

  it("returns 0 for midnight", () => {
    // 2026-04-23 00:00 UTC = 00:00 UTC
    const now = new Date("2026-04-23T00:00:00Z");
    expect(hourInTimezone(now, "UTC")).toBe(0);
  });

  it("returns null on invalid timezone", () => {
    const now = new Date("2026-04-23T12:00:00Z");
    expect(hourInTimezone(now, "Not/A_Real_Zone")).toBeNull();
  });
});
