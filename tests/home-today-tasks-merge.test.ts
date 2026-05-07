import { describe, expect, it, vi } from "vitest";

// Pure-function unit tests for the merge logic that powers
// /app (home) today-briefing tasks pane. Engineer-37 widened the
// shape: rows now carry a `kind` discriminator ("steadii" | "google" |
// "microsoft") so the home one-click checkbox can route the right
// server action, and the window expanded from "today + overdue" to
// "overdue → next 7 days".

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
  addDaysToDateStr: (s: string, _n: number) => s,
  localMidnightAsUtc: () => new Date(),
}));

import { mergeTodayTasks } from "@/app/app/page";

describe("mergeTodayTasks", () => {
  it("returns Steadii rows + overdue + within-week external", () => {
    const out = mergeTodayTasks(
      [
        { id: "a-1", title: "ECON essay", classTitle: "ECON 200", due: "2026-05-05" },
      ],
      [
        {
          due: "2026-05-08",
          title: "Future Google task — within week",
          taskId: "g-1",
          taskListId: "list-G",
        },
      ],
      [
        {
          due: "2026-05-04",
          title: "Yesterday's MS task (overdue)",
          taskId: "m-1",
          taskListId: "list-M",
        },
      ],
      "2026-05-05",
      "2026-05-12",
    );
    expect(out.map((r) => r.title)).toEqual([
      "ECON essay",
      "Future Google task — within week",
      "Yesterday's MS task (overdue)",
    ]);
  });

  it("excludes external tasks past the week-end upper bound", () => {
    const out = mergeTodayTasks(
      [],
      [
        {
          due: "2026-05-13",
          title: "Out of window",
          taskId: "g-1",
          taskListId: "list-G",
        },
      ],
      [],
      "2026-05-05",
      "2026-05-12",
    );
    expect(out).toHaveLength(0);
  });

  it("preserves kind=steadii for Steadii rows", () => {
    const out = mergeTodayTasks(
      [
        { id: "a-1", title: "Lab report", classTitle: "BIOL 110", due: "2026-05-05" },
      ],
      [],
      [],
      "2026-05-05",
      "2026-05-12",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      kind: "steadii",
      id: "a-1",
      title: "Lab report",
      classTitle: "BIOL 110",
    });
  });

  it("preserves kind=google + taskId/taskListId for Google rows", () => {
    const out = mergeTodayTasks(
      [],
      [
        {
          due: "2026-05-05",
          title: "iPhone を Apple に送り返す",
          taskId: "google-task-id-123",
          taskListId: "@default",
        },
      ],
      [],
      "2026-05-05",
      "2026-05-12",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "google",
      taskId: "google-task-id-123",
      taskListId: "@default",
      title: "iPhone を Apple に送り返す",
      due: "2026-05-05",
    });
  });

  it("preserves kind=microsoft + taskId/taskListId for MS rows", () => {
    const out = mergeTodayTasks(
      [],
      [],
      [
        {
          due: "2026-05-05",
          title: "Pick up dry cleaning",
          taskId: "ms-task-id-456",
          taskListId: "ms-default-list",
        },
      ],
      "2026-05-05",
      "2026-05-12",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      kind: "microsoft",
      taskId: "ms-task-id-456",
      taskListId: "ms-default-list",
      title: "Pick up dry cleaning",
      due: "2026-05-05",
    });
  });

  it("orders Steadii rows before external tasks (academic priority)", () => {
    const out = mergeTodayTasks(
      [{ id: "a-1", title: "Lab report", classTitle: "BIOL 110", due: "2026-05-05" }],
      [
        {
          due: "2026-05-05",
          title: "Google task today",
          taskId: "g-1",
          taskListId: "list-G",
        },
      ],
      [
        {
          due: "2026-05-05",
          title: "MS task today",
          taskId: "m-1",
          taskListId: "list-M",
        },
      ],
      "2026-05-05",
      "2026-05-12",
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
      due: "2026-05-05",
    }));
    const google = [
      {
        due: "2026-05-05",
        title: "Google overflow",
        taskId: "g-1",
        taskListId: "list-G",
      },
    ];
    const out = mergeTodayTasks(
      steadii,
      google,
      [],
      "2026-05-05",
      "2026-05-12",
      25,
    );
    expect(out).toHaveLength(25);
    expect(out[24].title).toBe("Steadii task 24"); // external dropped
  });

  it("filters external tasks to overdue + within week (not future-of-week)", () => {
    const out = mergeTodayTasks(
      [],
      [
        {
          due: "2026-05-05",
          title: "Today",
          taskId: "g-today",
          taskListId: "list-G",
        },
        {
          due: "2026-05-08",
          title: "Mid week",
          taskId: "g-mid",
          taskListId: "list-G",
        },
        {
          due: "2026-05-04",
          title: "Yesterday — overdue",
          taskId: "g-yest",
          taskListId: "list-G",
        },
        {
          due: "2026-04-30",
          title: "Last week — still pending",
          taskId: "g-old",
          taskListId: "list-G",
        },
        {
          due: "2026-05-15",
          title: "Two weeks out — drops",
          taskId: "g-far",
          taskListId: "list-G",
        },
      ],
      [],
      "2026-05-05",
      "2026-05-12",
    );
    expect(out.map((r) => r.title)).toEqual([
      "Today",
      "Mid week",
      "Yesterday — overdue",
      "Last week — still pending",
    ]);
  });

  it("regression: Ryuto's overdue iPhone task on 2026-05-05 home (PR #157)", () => {
    const out = mergeTodayTasks(
      [],
      [
        {
          due: "2026-05-04",
          title: "iPhone を Apple に送り返す",
          taskId: "g-iphone",
          taskListId: "@default",
        },
      ],
      [],
      "2026-05-05",
      "2026-05-12",
    );
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("iPhone を Apple に送り返す");
    expect(out[0].kind).toBe("google");
  });
});
