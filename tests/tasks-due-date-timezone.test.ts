import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// dueDayLabel is the timezone-aware day-diff helper that computes labels
// like "due today / 1 日超過 / 3 日後". Lives in the tasks page module;
// exported for testing per the 2026-05-05 sparring incident where a
// "due 2026-05-05" Google Task read on a Vancouver afternoon rendered
// "1 日超過". Tests below cover the common timezone-boundary cases.

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({ orderBy: async () => [] }),
        }),
        where: () => ({ orderBy: async () => [] }),
      }),
    }),
  },
}));

vi.mock("@/lib/integrations/google/tasks", () => ({
  fetchUpcomingTasks: async () => [],
}));

vi.mock("@/lib/integrations/microsoft/tasks", () => ({
  fetchMsUpcomingTasks: async () => [],
}));

vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));

import { dueDayLabel } from "@/app/app/tasks/page";

const t = (key: string, vars?: Record<string, string | number>): string => {
  if (!vars) return key;
  return `${key}:${Object.entries(vars)
    .map(([k, v]) => `${k}=${v}`)
    .join(",")}`;
};

describe("dueDayLabel — timezone-aware day-diff", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("Google Task due='2026-05-05' on Vancouver afternoon renders 'due_today' (regression for 2026-05-05 incident)", () => {
    // 2026-05-05 14:00 PT (= 21:00 UTC). Naïve impl computed -21h /
    // 24h ≈ -1, rendering "1 日超過". Fix: compare YYYY-MM-DD strings
    // in user TZ, both come out '2026-05-05', diff=0.
    vi.setSystemTime(new Date("2026-05-05T21:00:00Z"));
    const due = new Date("2026-05-05T12:00:00Z"); // Google Task date-only
    expect(dueDayLabel(due, t, "America/Vancouver")).toBe("due_today");
  });

  it("returns 'overdue_days:n=1' when due is yesterday in user tz", () => {
    vi.setSystemTime(new Date("2026-05-05T21:00:00Z"));
    const due = new Date("2026-05-04T12:00:00Z");
    expect(dueDayLabel(due, t, "America/Vancouver")).toBe(
      "overdue_days:n=1"
    );
  });

  it("returns 'due_tomorrow' when due is the next day in user tz", () => {
    vi.setSystemTime(new Date("2026-05-05T21:00:00Z"));
    const due = new Date("2026-05-06T12:00:00Z");
    expect(dueDayLabel(due, t, "America/Vancouver")).toBe("due_tomorrow");
  });

  it("returns 'due_in_days:n=3' for a date 3 days out", () => {
    vi.setSystemTime(new Date("2026-05-05T21:00:00Z"));
    const due = new Date("2026-05-08T12:00:00Z");
    expect(dueDayLabel(due, t, "America/Vancouver")).toBe("due_in_days:n=3");
  });

  it("Tokyo (UTC+9): 'due 2026-05-06' viewed at 2026-05-06 02:00 JST (= 17:00 UTC May 5) is 'due_today'", () => {
    // Tokyo case — 2026-05-06 at 2 AM local. Naive impl would have
    // raw diff = (May 6 00 UTC − May 5 17 UTC) / 24h = +0.29 → 0,
    // which is correct in this specific case but coincidence.
    // Test confirms our TZ-aware path also gets it right.
    vi.setSystemTime(new Date("2026-05-05T17:00:00Z"));
    const due = new Date("2026-05-06T12:00:00Z");
    expect(dueDayLabel(due, t, "Asia/Tokyo")).toBe("due_today");
  });

  it("UTC viewer with the buggy raw-ms behavior: 'due 2026-05-05 00:00 UTC' viewed at 2026-05-04 23:00 UTC is 'due_tomorrow'", () => {
    vi.setSystemTime(new Date("2026-05-04T23:00:00Z"));
    const due = new Date("2026-05-05T12:00:00Z");
    expect(dueDayLabel(due, t, "UTC")).toBe("due_tomorrow");
  });

  it("falls back to short_date format for due dates ≥ 7 days out", () => {
    vi.setSystemTime(new Date("2026-05-05T21:00:00Z"));
    const due = new Date("2026-05-20T12:00:00Z");
    const label = dueDayLabel(due, t, "America/Vancouver");
    expect(label.startsWith("due_short_date:date=")).toBe(true);
  });
});
