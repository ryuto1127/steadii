import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-06-13 — FORWARD-ONLY briefing parity. The in-app TodayBriefing and
// the email digest's "Today" section must agree on the forward window:
// lower bound = the user's LOCAL midnight today, upper bound = local
// midnight today + BRIEFING_FORWARD_DAYS. This test asserts the two
// assignment loaders (getDueSoonAssignments — in-app; getDigestDueOrOverdue
// — digest) compute IDENTICAL bounds for the same (tz, now), so the
// surfaces can't drift on the horizon.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/integrations/google/calendar", () => ({
  getCalendarForUser: async () => {
    throw new Error("not used");
  },
  CalendarNotConnectedError: class extends Error {},
}));
vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));

// Record the gte()/lte()/lt() bounds the assignment queries build.
const bounds: { gte: Date[]; lte: Date[]; lt: Date[] } = {
  gte: [],
  lte: [],
  lt: [],
};
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  asc: () => ({}),
  eq: () => ({}),
  gte: (_col: unknown, v: unknown) => {
    if (v instanceof Date) bounds.gte.push(v);
    return {};
  },
  isNotNull: () => ({}),
  isNull: () => ({}),
  lt: (_col: unknown, v: unknown) => {
    if (v instanceof Date) bounds.lt.push(v);
    return {};
  },
  lte: (_col: unknown, v: unknown) => {
    if (v instanceof Date) bounds.lte.push(v);
    return {};
  },
  ne: () => ({}),
}));

vi.mock("@/lib/db/client", () => {
  const chain: Record<string, unknown> = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: async () => [],
  };
  return { db: { select: () => chain } };
});

vi.mock("@/lib/db/schema", () => ({
  assignments: {
    id: {},
    title: {},
    dueAt: {},
    classId: {},
    userId: {},
    status: {},
    deletedAt: {},
  },
  classes: { id: {}, name: {}, color: {} },
}));

import {
  BRIEFING_FORWARD_DAYS,
  BRIEFING_FORWARD_HOURS,
  getDueSoonAssignments,
  getDigestDueOrOverdue,
} from "@/lib/dashboard/today";

const TZ = "America/Vancouver";
const NOW = new Date("2026-06-09T14:00:00Z"); // 07:00 local Vancouver

beforeEach(() => {
  bounds.gte.length = 0;
  bounds.lte.length = 0;
  bounds.lt.length = 0;
});

describe("forward-window parity", () => {
  it("BRIEFING_FORWARD_HOURS is BRIEFING_FORWARD_DAYS * 24", () => {
    expect(BRIEFING_FORWARD_HOURS).toBe(BRIEFING_FORWARD_DAYS * 24);
    expect(BRIEFING_FORWARD_DAYS).toBe(3);
  });

  it("both loaders use the same forward window (lower = local midnight today, upper = +3d)", async () => {
    await getDueSoonAssignments("u1", BRIEFING_FORWARD_HOURS, TZ, NOW);
    const inAppLower = bounds.gte[bounds.gte.length - 1]!;
    const inAppUpper = bounds.lte[bounds.lte.length - 1]!;

    bounds.gte.length = 0;
    bounds.lte.length = 0;
    bounds.lt.length = 0;

    await getDigestDueOrOverdue("u1", TZ, NOW);
    const digestLower = bounds.gte[bounds.gte.length - 1]!;
    const digestUpper = bounds.lt[bounds.lt.length - 1]!;

    // Lower bound = local midnight TODAY (2026-06-09 Vancouver PDT-7).
    expect(inAppLower.toISOString()).toBe("2026-06-09T07:00:00.000Z");
    // Upper bound = local midnight today + 3d (2026-06-12 Vancouver).
    expect(inAppUpper.toISOString()).toBe("2026-06-12T07:00:00.000Z");

    // The two surfaces AGREE — identical lower/upper bounds.
    expect(digestLower.toISOString()).toBe(inAppLower.toISOString());
    expect(digestUpper.toISOString()).toBe(inAppUpper.toISOString());
  });
});
