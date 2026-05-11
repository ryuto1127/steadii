import { describe, expect, it, vi } from "vitest";

// engineer-41 — check_availability formatter. Verifies the dual-tz
// display helper that the orchestrator splices into draft bodies.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/calendar/events-store", () => ({
  listEventsInRange: async () => [],
}));
vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Los_Angeles",
}));
vi.mock("@/lib/calendar/tz-utils", () => ({
  FALLBACK_TZ: "America/Los_Angeles",
}));

import { formatInTimezone } from "@/lib/agent/email/l2-tools/check-availability";

describe("formatInTimezone", () => {
  it("renders a JP wall-clock string for Asia/Tokyo", () => {
    const start = new Date("2026-05-15T01:00:00Z"); // JST 10:00
    const end = new Date("2026-05-15T02:00:00Z"); // JST 11:00
    const out = formatInTimezone(start, end, "Asia/Tokyo");
    expect(out).toContain("Asia/Tokyo");
    expect(out).toContain("10:00");
    expect(out).toContain("11:00");
  });

  it("renders a PT wall-clock string for America/Los_Angeles", () => {
    const start = new Date("2026-05-15T17:00:00Z"); // PT 10:00 (DST)
    const end = new Date("2026-05-15T18:00:00Z"); // PT 11:00 (DST)
    const out = formatInTimezone(start, end, "America/Los_Angeles");
    expect(out).toContain("America/Los_Angeles");
    expect(out).toContain("10:00");
    expect(out).toContain("11:00");
  });

  it("falls back to ISO strings when the timezone is invalid", () => {
    const start = new Date("2026-05-15T01:00:00Z");
    const end = new Date("2026-05-15T02:00:00Z");
    const out = formatInTimezone(start, end, "Mars/Olympus_Mons");
    expect(out).toContain("Mars/Olympus_Mons");
  });
});
