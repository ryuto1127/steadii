import { beforeEach, describe, expect, it, vi } from "vitest";

// WRONG_TZ_DIRECTION guard for the digest "Today" loaders. "Today" is the
// user's LOCAL day, not UTC. The classic regression: a Vancouver user runs
// the 7am digest; an event at 23:30 LOCAL the previous night (which is the
// NEXT UTC day) must NOT be counted as today, and the events query window
// must start at LOCAL midnight today (so it excludes that 23:30 instant).

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

// Capture the calendar events.list args so we can assert the window.
type EventsListArgs = { timeMin: string; timeMax: string };
const eventsListMock = vi.fn<
  (args: EventsListArgs) => Promise<{ data: { items: unknown[] } }>
>(async () => ({ data: { items: [] } }));
vi.mock("@/lib/integrations/google/calendar", () => ({
  getCalendarForUser: async () => ({
    events: { list: eventsListMock },
  }),
  CalendarNotConnectedError: class extends Error {},
}));

// Capture the assignment where-clause cutoff via a recording lt().
const ltCalls: Array<{ col: unknown; value: unknown }> = [];
vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  asc: () => ({}),
  eq: () => ({}),
  gte: () => ({}),
  isNotNull: () => ({}),
  isNull: () => ({}),
  lt: (col: unknown, value: unknown) => {
    ltCalls.push({ col, value });
    return {};
  },
  lte: () => ({}),
  ne: () => ({}),
}));

const assignmentRows: Array<{
  id: string;
  title: string;
  dueAt: Date | null;
  classTitle: string | null;
}> = [];
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => assignmentRows,
            }),
          }),
        }),
      }),
    }),
  },
}));

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

// getUserTimezone is used by the home loaders but not the digest ones; stub
// it anyway so the module imports cleanly.
vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));

beforeEach(() => {
  eventsListMock.mockClear();
  ltCalls.length = 0;
  assignmentRows.length = 0;
});

async function load() {
  return import("@/lib/dashboard/today");
}

describe("getDigestTodayEvents — TZ window", () => {
  it("queries from local midnight today, excluding 23:30-yesterday-local", async () => {
    const { getDigestTodayEvents } = await load();
    // "Now" = 2026-06-09 07:00 local Vancouver == 14:00 UTC.
    const now = new Date("2026-06-09T14:00:00Z");
    // Freeze time so todayDateInTz resolves the local day deterministically.
    vi.useFakeTimers();
    vi.setSystemTime(now);
    try {
      await getDigestTodayEvents("user-1", "America/Vancouver");
    } finally {
      vi.useRealTimers();
    }

    expect(eventsListMock).toHaveBeenCalledTimes(1);
    const args = eventsListMock.mock.calls[0][0];
    // Local midnight 2026-06-09 Vancouver (PDT -7) == 2026-06-09T07:00:00Z.
    expect(args.timeMin).toBe("2026-06-09T07:00:00.000Z");
    // Next local midnight 2026-06-10 == 2026-06-10T07:00:00Z.
    expect(args.timeMax).toBe("2026-06-10T07:00:00.000Z");

    // The 23:30-local-yesterday instant (2026-06-08T23:30 local ==
    // 2026-06-09T06:30Z) is strictly BEFORE timeMin → excluded.
    const yesterdayLate = new Date("2026-06-09T06:30:00Z");
    expect(yesterdayLate.getTime()).toBeLessThan(
      new Date(args.timeMin).getTime()
    );
  });
});

describe("getDigestDueOrOverdue — TZ cutoff + overdue flag", () => {
  it("cutoff is next local midnight, and overdue is flagged vs now", async () => {
    const now = new Date("2026-06-09T14:00:00Z"); // 07:00 local Vancouver
    assignmentRows.push(
      {
        id: "a-overdue",
        title: "Late one",
        dueAt: new Date("2026-06-08T20:00:00Z"),
        classTitle: "CS",
      },
      {
        id: "a-today",
        title: "Tonight",
        dueAt: new Date("2026-06-10T05:00:00Z"), // 22:00 local today
        classTitle: null,
      }
    );

    const { getDigestDueOrOverdue } = await load();
    const out = await getDigestDueOrOverdue(
      "user-1",
      "America/Vancouver",
      now
    );

    // The lt() cutoff passed to the query is the next local midnight
    // (2026-06-10 Vancouver == 2026-06-10T07:00:00Z).
    expect(ltCalls.length).toBeGreaterThanOrEqual(1);
    const cutoff = ltCalls[ltCalls.length - 1].value as Date;
    expect(cutoff.toISOString()).toBe("2026-06-10T07:00:00.000Z");

    // overdue flag: due before `now` → true; due tonight → false.
    const overdue = out.find((a) => a.id === "a-overdue");
    const today = out.find((a) => a.id === "a-today");
    expect(overdue?.overdue).toBe(true);
    expect(today?.overdue).toBe(false);
  });
});
