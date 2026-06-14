import { describe, expect, it, vi } from "vitest";

// Pure-function unit tests for the merge logic that powers the /app (home)
// today-briefing tasks pane.
//
// 2026-06-13 — the briefing is now FORWARD-ONLY: window = today + the next
// 3 days (BRIEFING_FORWARD_DAYS), with a SYMMETRIC lower bound so NO
// past-due item appears. mergeTodayTasks filters external tasks to the
// closed band [todayStr, weekEndStr]; Steadii rows with a concrete due
// date get the same lower-bound guard, while null-due Steadii rows (no
// deadline) are always kept.

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
  BRIEFING_FORWARD_DAYS: 3,
  BRIEFING_FORWARD_HOURS: 72,
  getDueSoonAssignments: vi.fn(),
  getTodaysEvents: vi.fn(),
  todayDateInTz: () => "2026-05-05",
}));
vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));
vi.mock("@/lib/calendar/tz-utils", () => ({
  FALLBACK_TZ: "UTC",
  addDaysToDateStr: (s: string, _n: number) => s,
  localMidnightAsUtc: () => new Date(),
}));

import { mergeTodayTasks } from "@/app/app/page";

// today = 2026-05-05, forward window end = 2026-05-08 (today + 3 days).
const TODAY = "2026-05-05";
const WINDOW_END = "2026-05-08";

describe("mergeTodayTasks — forward-only window", () => {
  it("keeps Steadii rows + forward external; DROPS past-due external", () => {
    const out = mergeTodayTasks(
      [{ id: "a-1", title: "Essay draft", classTitle: "Class A", due: TODAY }],
      [
        {
          due: "2026-05-07",
          title: "Forward Google task",
          taskId: "g-1",
          taskListId: "list-G",
        },
      ],
      [
        {
          due: "2026-05-04", // yesterday → past-due, must be dropped
          title: "Past-due MS task",
          taskId: "m-1",
          taskListId: "list-M",
        },
      ],
      TODAY,
      WINDOW_END,
    );
    expect(out.map((r) => r.title)).toEqual([
      "Essay draft",
      "Forward Google task",
    ]);
  });

  it("excludes external tasks past the window-end upper bound", () => {
    const out = mergeTodayTasks(
      [],
      [
        {
          due: "2026-05-09", // one day past the +3d window → dropped
          title: "Out of window",
          taskId: "g-1",
          taskListId: "list-G",
        },
      ],
      [],
      TODAY,
      WINDOW_END,
    );
    expect(out).toHaveLength(0);
  });

  it("drops a past-due Steadii row but keeps a null-due (no deadline) row", () => {
    const out = mergeTodayTasks(
      [
        { id: "a-past", title: "Past-due assignment", classTitle: null, due: "2026-05-01" },
        { id: "a-none", title: "No-deadline assignment", classTitle: null, due: null },
        { id: "a-fwd", title: "Forward assignment", classTitle: null, due: "2026-05-06" },
      ],
      [],
      [],
      TODAY,
      WINDOW_END,
    );
    expect(out.map((r) => r.title)).toEqual([
      "No-deadline assignment",
      "Forward assignment",
    ]);
  });

  it("preserves kind=steadii for Steadii rows", () => {
    const out = mergeTodayTasks(
      [{ id: "a-1", title: "Lab report", classTitle: "Class B", due: TODAY }],
      [],
      [],
      TODAY,
      WINDOW_END,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "steadii",
      id: "a-1",
      title: "Lab report",
      classTitle: "Class B",
    });
  });

  it("preserves kind=google + taskId/taskListId for Google rows", () => {
    const out = mergeTodayTasks(
      [],
      [
        {
          due: TODAY,
          title: "Return a parcel",
          taskId: "google-task-id-123",
          taskListId: "@default",
        },
      ],
      [],
      TODAY,
      WINDOW_END,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "google",
      taskId: "google-task-id-123",
      taskListId: "@default",
      title: "Return a parcel",
      due: TODAY,
    });
  });

  it("preserves kind=microsoft + taskId/taskListId for MS rows", () => {
    const out = mergeTodayTasks(
      [],
      [],
      [
        {
          due: TODAY,
          title: "Run an errand",
          taskId: "ms-task-id-456",
          taskListId: "ms-default-list",
        },
      ],
      TODAY,
      WINDOW_END,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "microsoft",
      taskId: "ms-task-id-456",
      taskListId: "ms-default-list",
      title: "Run an errand",
      due: TODAY,
    });
  });

  it("orders Steadii rows before external tasks (academic priority)", () => {
    const out = mergeTodayTasks(
      [{ id: "a-1", title: "Lab report", classTitle: "Class B", due: TODAY }],
      [{ due: TODAY, title: "Google task today", taskId: "g-1", taskListId: "list-G" }],
      [{ due: TODAY, title: "MS task today", taskId: "m-1", taskListId: "list-M" }],
      TODAY,
      WINDOW_END,
    );
    expect(out.map((r) => r.title)).toEqual([
      "Lab report",
      "Google task today",
      "MS task today",
    ]);
  });

  it("respects the limit cap (Steadii overflow drops external)", () => {
    const steadii = Array.from({ length: 25 }, (_, i) => ({
      id: `a-${i}`,
      title: `Steadii task ${i}`,
      classTitle: null,
      due: TODAY,
    }));
    const google = [
      { due: TODAY, title: "Google overflow", taskId: "g-1", taskListId: "list-G" },
    ];
    const out = mergeTodayTasks(steadii, google, [], TODAY, WINDOW_END, 25);
    expect(out).toHaveLength(25);
    expect(out[24].title).toBe("Steadii task 24"); // external dropped
  });

  it("window boundary: keeps day-3 external (upper bound inclusive), drops day-4", () => {
    const out = mergeTodayTasks(
      [
        {
          id: "a-1",
          title: "Steadii deadline within window",
          classTitle: "Class A",
          due: "2026-05-07",
        },
      ],
      [
        {
          due: WINDOW_END, // exactly the upper bound → kept
          title: "External on day 3",
          taskId: "g-edge",
          taskListId: "list-G",
        },
        {
          due: "2026-05-09", // one day past → dropped
          title: "External on day 4",
          taskId: "g-out",
          taskListId: "list-G",
        },
      ],
      [],
      TODAY,
      WINDOW_END,
    );
    expect(out.map((r) => r.title)).toEqual([
      "Steadii deadline within window",
      "External on day 3",
    ]);
  });

  it("window boundary: keeps a task due exactly today (lower bound inclusive)", () => {
    const out = mergeTodayTasks(
      [],
      [{ due: TODAY, title: "Due today", taskId: "g-today", taskListId: "list-G" }],
      [],
      TODAY,
      WINDOW_END,
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Due today");
  });
});
