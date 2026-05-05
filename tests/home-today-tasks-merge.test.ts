import { describe, expect, it, vi } from "vitest";

// Pure-function unit tests for the merge logic that powers
// /app (home) "tasks due today". Surfaced because Ryuto's iPhone-return
// task (Google Tasks origin, due today) was missing from the home
// briefing — fetchTodayTasks pre-fix only queried Steadii's assignments
// table. The merge helper now folds Steadii + Google + MS sources into
// the home list with a TZ-aware "today" filter applied client-side.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/config", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/integrations/google/tasks", () => ({
  fetchUpcomingTasks: async () => [],
}));
vi.mock("@/lib/integrations/microsoft/tasks", () => ({
  fetchMsUpcomingTasks: async () => [],
}));
vi.mock("@/lib/agent/queue/build", () => ({ buildQueueForUser: vi.fn() }));
vi.mock("@/lib/dashboard/today", () => ({
  getDueSoonAssignments: vi.fn(),
  getTodaysEvents: vi.fn(),
  todayDateInTz: () => "2026-05-05",
}));
vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));
vi.mock("@/lib/calendar/tz-utils", () => ({
  FALLBACK_TZ: "UTC",
  addDaysToDateStr: (s: string, n: number) => s,
  localMidnightAsUtc: () => new Date(),
}));

import { mergeTodayTasks } from "@/app/app/page";

describe("mergeTodayTasks", () => {
  it("returns Steadii rows verbatim when no external tasks match today", () => {
    const out = mergeTodayTasks(
      [
        { id: "a-1", title: "ECON essay", classTitle: "ECON 200" },
      ],
      [{ due: "2026-05-06", title: "Tomorrow's Google task" }],
      [{ due: "2026-05-04", title: "Yesterday's MS task" }],
      "2026-05-05"
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      id: "a-1",
      title: "ECON essay",
      classTitle: "ECON 200",
    });
  });

  it("includes a Google task whose `due` matches today", () => {
    const out = mergeTodayTasks(
      [],
      [{ due: "2026-05-05", title: "iPhone を Apple に送り返す" }],
      [],
      "2026-05-05"
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("iPhone を Apple に送り返す");
    expect(out[0].classTitle).toBeNull();
    expect(out[0].id.startsWith("external:")).toBe(true);
  });

  it("includes an MS task whose `due` matches today", () => {
    const out = mergeTodayTasks(
      [],
      [],
      [{ due: "2026-05-05", title: "Pick up dry cleaning" }],
      "2026-05-05"
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Pick up dry cleaning");
  });

  it("orders Steadii rows before external tasks (academic priority)", () => {
    const out = mergeTodayTasks(
      [{ id: "a-1", title: "Lab report", classTitle: "BIOL 110" }],
      [{ due: "2026-05-05", title: "Google task today" }],
      [{ due: "2026-05-05", title: "MS task today" }],
      "2026-05-05"
    );
    expect(out.map((r) => r.title)).toEqual([
      "Lab report",
      "Google task today",
      "MS task today",
    ]);
  });

  it("respects the limit cap (Steadii overflow drops external)", () => {
    const steadii = Array.from({ length: 10 }, (_, i) => ({
      id: `a-${i}`,
      title: `Steadii task ${i}`,
      classTitle: null,
    }));
    const google = [{ due: "2026-05-05", title: "Google overflow" }];
    const out = mergeTodayTasks(steadii, google, [], "2026-05-05", 10);
    expect(out).toHaveLength(10);
    expect(out[9].title).toBe("Steadii task 9"); // external dropped
  });

  it("filters external tasks by exact `due` string match — date-only semantics", () => {
    const out = mergeTodayTasks(
      [],
      [
        { due: "2026-05-05", title: "Match" },
        { due: "2026-05-06", title: "Tomorrow" },
        { due: "2026-05-04", title: "Yesterday" },
      ],
      [],
      "2026-05-05"
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Match");
  });
});
