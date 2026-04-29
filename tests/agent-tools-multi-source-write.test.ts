import { describe, it, expect, beforeEach, vi } from "vitest";

// Stub env so the encrypted-adapter and helpers don't require real secrets.
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_GOOGLE_ID: "google-id",
    AUTH_GOOGLE_SECRET: "google-secret",
    AUTH_MS_ID: "ms-id",
    AUTH_MS_SECRET: "ms-secret",
    AUTH_MS_TENANT_ID: "common",
    ENCRYPTION_KEY: "k".repeat(64),
    NODE_ENV: "test",
  }),
}));

// Drive the connected-providers helper deterministically. We're testing the
// multi-source dispatch logic in calendar.ts and tasks.ts, not the helper
// itself — that's covered by other tests.
let connectedCalendars: Array<"google" | "microsoft-entra-id"> = [];
let connectedTasks: Array<"google" | "microsoft-entra-id"> = [];
let lookupSourceType: string | null = null;

vi.mock("@/lib/agent/tools/connected-providers", () => ({
  getConnectedCalendarProviders: async () => connectedCalendars,
  getConnectedTasksProviders: async () => connectedTasks,
  lookupEventSource: async () => lookupSourceType,
}));

// Track audit log + scan triggers so we can assert side effects.
vi.mock("@/lib/db/client", () => ({
  db: {
    insert: () => ({ values: async () => {} }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/agent/proactive/scanner", () => ({
  triggerScanInBackground: () => {},
}));

vi.mock("@/lib/calendar/events-store", () => ({
  upsertFromSourceRow: async () => {},
  markDeletedByExternalId: async () => {},
  shouldSync: () => false,
  syncAllForRange: async () => ({ bySource: {} }),
  listEventsInRange: async () => [],
  getGoogleAccountId: async () => "google-account",
}));

vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));

// Capture Google calls so we can assert dual-write.
const googleInsertCalls: unknown[] = [];
const googlePatchCalls: unknown[] = [];
const googleDeleteCalls: unknown[] = [];
let googleInsertImpl: () => Promise<unknown> = async () => ({
  data: { id: "google-event-1", htmlLink: "https://google.example/x" },
});

vi.mock("@/lib/integrations/google/calendar", () => ({
  CalendarNotConnectedError: class extends Error {
    code = "CALENDAR_NOT_CONNECTED" as const;
  },
  getCalendarForUser: async () => ({
    events: {
      insert: async (req: unknown) => {
        googleInsertCalls.push(req);
        return googleInsertImpl();
      },
      patch: async (req: unknown) => {
        googlePatchCalls.push(req);
        return { data: { id: "google-event-1" } };
      },
      delete: async (req: unknown) => {
        googleDeleteCalls.push(req);
        return undefined;
      },
    },
  }),
}));

vi.mock("@/lib/integrations/google/tasks", () => ({
  TasksNotConnectedError: class extends Error {
    code = "TASKS_NOT_CONNECTED" as const;
  },
  dueFromDateOnly: (s: string) => `${s}T00:00:00.000Z`,
  dueDateOnly: (s: string | null | undefined) => (s ? s.slice(0, 10) : null),
  getTasksForUser: async () => ({
    tasks: {
      insert: async () => ({ data: { id: "google-task-1" } }),
      patch: async () => ({ data: { id: "google-task-1", status: "completed" } }),
      delete: async () => undefined,
    },
  }),
}));

// Capture MS calls.
const msCreateEventCalls: unknown[] = [];
const msPatchEventCalls: unknown[] = [];
const msDeleteEventCalls: unknown[] = [];
let msCreateEventImpl: () => Promise<{ id: string; webLink: string | null }> =
  async () => ({ id: "ms-event-1", webLink: "https://outlook.example/x" });

vi.mock("@/lib/integrations/microsoft/calendar", () => ({
  createMsEvent: async (input: unknown) => {
    msCreateEventCalls.push(input);
    return msCreateEventImpl();
  },
  patchMsEvent: async (input: unknown) => {
    msPatchEventCalls.push(input);
    return { id: "ms-event-1" };
  },
  deleteMsEvent: async (input: unknown) => {
    msDeleteEventCalls.push(input);
  },
}));

const msCreateTaskCalls: unknown[] = [];
const msPatchTaskCalls: unknown[] = [];

vi.mock("@/lib/integrations/microsoft/tasks", () => ({
  createMsTask: async (input: unknown) => {
    msCreateTaskCalls.push(input);
    return { id: "ms-task-1", listId: "default-list" };
  },
  patchMsTask: async (input: unknown) => {
    msPatchTaskCalls.push(input);
    return { id: "ms-task-1" };
  },
  deleteMsTask: async () => {},
}));

import { calendarCreateEvent } from "@/lib/agent/tools/calendar";
import { tasksCreateTask } from "@/lib/agent/tools/tasks";

beforeEach(() => {
  connectedCalendars = [];
  connectedTasks = [];
  lookupSourceType = null;
  googleInsertCalls.length = 0;
  googlePatchCalls.length = 0;
  googleDeleteCalls.length = 0;
  msCreateEventCalls.length = 0;
  msPatchEventCalls.length = 0;
  msDeleteEventCalls.length = 0;
  msCreateTaskCalls.length = 0;
  msPatchTaskCalls.length = 0;
  googleInsertImpl = async () => ({
    data: { id: "google-event-1", htmlLink: "https://google.example/x" },
  });
  msCreateEventImpl = async () => ({
    id: "ms-event-1",
    webLink: "https://outlook.example/x",
  });
});

describe("calendar_create_event multi-source dispatch", () => {
  it("writes to both Google and Microsoft when both are connected", async () => {
    connectedCalendars = ["google", "microsoft-entra-id"];
    const out = await calendarCreateEvent.execute(
      { userId: "u1" },
      {
        summary: "Coffee",
        start: "2026-04-26T10:00:00Z",
        end: "2026-04-26T11:00:00Z",
      }
    );
    expect(googleInsertCalls).toHaveLength(1);
    expect(msCreateEventCalls).toHaveLength(1);
    expect(out.createdIn).toEqual(["google_calendar", "microsoft_graph"]);
    expect(out.failedIn).toEqual([]);
    // Primary id should be Google (first dispatched)
    expect(out.eventId).toBe("google-event-1");
  });

  it("writes only to Google when only Google is connected", async () => {
    connectedCalendars = ["google"];
    const out = await calendarCreateEvent.execute(
      { userId: "u1" },
      {
        summary: "Coffee",
        start: "2026-04-26T10:00:00Z",
        end: "2026-04-26T11:00:00Z",
      }
    );
    expect(googleInsertCalls).toHaveLength(1);
    expect(msCreateEventCalls).toHaveLength(0);
    expect(out.createdIn).toEqual(["google_calendar"]);
  });

  it("writes only to Microsoft when only MS is connected", async () => {
    connectedCalendars = ["microsoft-entra-id"];
    const out = await calendarCreateEvent.execute(
      { userId: "u1" },
      {
        summary: "Coffee",
        start: "2026-04-26T10:00:00Z",
        end: "2026-04-26T11:00:00Z",
      }
    );
    expect(googleInsertCalls).toHaveLength(0);
    expect(msCreateEventCalls).toHaveLength(1);
    expect(out.createdIn).toEqual(["microsoft_graph"]);
    expect(out.eventId).toBe("ms-event-1");
  });

  it("surfaces partial failure when one source errors and the other succeeds", async () => {
    connectedCalendars = ["google", "microsoft-entra-id"];
    msCreateEventImpl = async () => {
      throw new Error("MS Graph 503");
    };
    const out = await calendarCreateEvent.execute(
      { userId: "u1" },
      {
        summary: "Coffee",
        start: "2026-04-26T10:00:00Z",
        end: "2026-04-26T11:00:00Z",
      }
    );
    expect(out.createdIn).toEqual(["google_calendar"]);
    expect(out.failedIn).toEqual([
      { source: "microsoft_graph", error: "MS Graph 503" },
    ]);
    // Primary stays the surviving source's id.
    expect(out.eventId).toBe("google-event-1");
  });

  it("throws when every source fails", async () => {
    connectedCalendars = ["google", "microsoft-entra-id"];
    googleInsertImpl = async () => {
      throw new Error("Google 500");
    };
    msCreateEventImpl = async () => {
      throw new Error("MS 500");
    };
    await expect(
      calendarCreateEvent.execute(
        { userId: "u1" },
        {
          summary: "x",
          start: "2026-04-26T10:00:00Z",
          end: "2026-04-26T11:00:00Z",
        }
      )
    ).rejects.toThrow(/Google 500|MS 500/);
  });
});

describe("tasks_create multi-source dispatch", () => {
  it("writes to both Google and Microsoft when both are connected", async () => {
    connectedTasks = ["google", "microsoft-entra-id"];
    const out = await tasksCreateTask.execute(
      { userId: "u1" },
      { title: "Pset 5", due: "2026-04-26" }
    );
    expect(msCreateTaskCalls).toHaveLength(1);
    expect(out.createdIn).toEqual(["google_tasks", "microsoft_todo"]);
    expect(out.failedIn).toEqual([]);
  });

  it("writes only to Microsoft when only MS is connected", async () => {
    connectedTasks = ["microsoft-entra-id"];
    const out = await tasksCreateTask.execute(
      { userId: "u1" },
      { title: "Pset 5", due: "2026-04-26" }
    );
    expect(msCreateTaskCalls).toHaveLength(1);
    expect(out.createdIn).toEqual(["microsoft_todo"]);
    expect(out.taskId).toBe("ms-task-1");
    expect(out.taskListId).toBe("default-list");
  });
});
