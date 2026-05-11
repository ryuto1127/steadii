import { describe, expect, it, vi } from "vitest";

// engineer-41 — infer_sender_timezone offset heuristic.
//
// We unit-test the pure inferOffsetFromTimestamps helper. The DB +
// LLM-fallback paths live behind the L2 tool and are exercised in
// integration tests at the agentic-loop level.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/integrations/openai/client", () => ({ openai: () => ({}) }));
vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({ usd: 0, credits: 0, usageId: null }),
}));
vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4-mini",
}));

import { inferOffsetFromTimestamps } from "@/lib/agent/email/l2-tools/infer-sender-timezone";

describe("inferOffsetFromTimestamps", () => {
  it("returns null when the timestamps are an empty array", () => {
    expect(inferOffsetFromTimestamps([])).toBeNull();
  });

  it("infers Asia/Tokyo from a tight UTC-04 cluster (= JST midday)", () => {
    // JST 13:00 = UTC 04:00. A tight cluster around 04:00 UTC implies
    // the sender lives in a +9 zone.
    const dates = [
      new Date("2026-05-01T04:00:00Z"),
      new Date("2026-05-02T03:30:00Z"),
      new Date("2026-05-03T04:30:00Z"),
      new Date("2026-05-04T05:00:00Z"),
      new Date("2026-05-05T04:00:00Z"),
    ];
    const out = inferOffsetFromTimestamps(dates);
    expect(out).not.toBeNull();
    expect(out?.timezone).toBe("Asia/Tokyo");
    expect(out?.confidence).toBeGreaterThanOrEqual(0.6);
  });

  it("returns null when timestamps are diffuse across the day", () => {
    const dates = [
      new Date("2026-05-01T01:00:00Z"),
      new Date("2026-05-02T07:00:00Z"),
      new Date("2026-05-03T13:00:00Z"),
      new Date("2026-05-04T19:00:00Z"),
      new Date("2026-05-05T22:00:00Z"),
    ];
    expect(inferOffsetFromTimestamps(dates)).toBeNull();
  });

  it("infers a NA-Pacific zone from a tight UTC+20 cluster", () => {
    // PT 13:00 = UTC 20:00 (DST). A tight cluster around 20:00 UTC
    // implies a -8/-7 zone.
    const dates = [
      new Date("2026-05-01T20:00:00Z"),
      new Date("2026-05-02T19:30:00Z"),
      new Date("2026-05-03T20:30:00Z"),
      new Date("2026-05-04T21:00:00Z"),
      new Date("2026-05-05T20:00:00Z"),
    ];
    const out = inferOffsetFromTimestamps(dates);
    expect(out).not.toBeNull();
    expect(out?.timezone).toContain("America/Los_Angeles");
  });
});
