import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  agentDrafts: {},
  agentProposals: {},
  assignments: {},
  auditLog: {},
  chats: {},
  events: {},
  inboxItems: {},
  messages: {},
  usageEvents: {},
}));
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  between: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  gte: () => ({}),
  inArray: () => ({}),
  isNotNull: () => ({}),
  lt: () => ({}),
  ne: () => ({}),
  sql: () => ({}),
}));

import { priorMonthRange } from "@/lib/agent/digest/monthly-aggregation";

// priorMonthRange is the pure-helper inside monthly-aggregation that
// derives the comparison window. The DB-heavy aggregator itself is
// integration-tested via dogfood (the cron route hands it a real
// userId + monthStart). We pin the date math here so a leap year or
// year-wrap can't silently break the comparison.

describe("priorMonthRange", () => {
  it("steps back one calendar month with year-wrap", () => {
    // Jan 1 2026 (start) → prior = Dec 1 2025.
    const start = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
    const range = priorMonthRange(start);
    expect(range.start.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("steps back from May 2026 to April 2026", () => {
    const start = new Date(Date.UTC(2026, 4, 1, 0, 0, 0)); // May
    const range = priorMonthRange(start);
    expect(range.start.getUTCMonth()).toBe(3); // April
    expect(range.start.getUTCFullYear()).toBe(2026);
    expect(range.end.toISOString()).toBe(start.toISOString());
  });

  it("preserves the wall-clock day for non-edge cases", () => {
    // The aggregator passes monthStart = day 1 always, but the helper
    // shouldn't break on different day values — verify it preserves
    // the day, hour, minute components.
    const start = new Date(Date.UTC(2026, 5, 15, 7, 30, 0));
    const range = priorMonthRange(start);
    expect(range.start.getUTCDate()).toBe(15);
    expect(range.start.getUTCHours()).toBe(7);
    expect(range.start.getUTCMinutes()).toBe(30);
  });
});
