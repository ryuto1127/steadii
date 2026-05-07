import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_MS_ID: "ms-id",
    AUTH_MS_SECRET: "ms-secret",
    AUTH_MS_TENANT_ID: "common",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

let acct: { scope: string; access_token: string | null; expires_at: number | null } | null = null;
const graphResponses: Record<string, unknown> = {};
let lastApiPath = "";

vi.mock("@/lib/db/client", () => {
  const chain = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    const c: Record<string, unknown> = {
      from: () => c,
      where: () => c,
      limit: () => c,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    return c;
  };
  return {
    db: {
      select: () => chain(acct ? [acct] : []),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    },
  };
});

vi.mock("@/lib/auth/oauth-tokens", () => ({
  decryptOAuthToken: (v: string | null) => v,
  encryptOAuthToken: (v: string) => v,
}));

// Stub the SDK so we can assert on the api path and return canned data.
vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: {
    init: () => ({
      api: (path: string) => {
        lastApiPath = path;
        const resp = graphResponses[path] ?? { value: [] };
        const builder: Record<string, unknown> = {
          query: () => builder,
          header: () => builder,
          get: async () => resp,
        };
        return builder;
      },
    }),
  },
}));

import { fetchMsUpcomingEvents } from "@/lib/integrations/microsoft/calendar";
import { fetchMsUpcomingTasks } from "@/lib/integrations/microsoft/tasks";

beforeEach(() => {
  acct = null;
  for (const k of Object.keys(graphResponses)) delete graphResponses[k];
  lastApiPath = "";
});

describe("fetchMsUpcomingEvents", () => {
  it("soft-fails when no MS account is linked", async () => {
    acct = null;
    expect(await fetchMsUpcomingEvents("u1")).toEqual([]);
  });

  it("soft-fails when Calendars.Read scope is missing", async () => {
    acct = { scope: "openid email", access_token: "t", expires_at: 9999999999 };
    expect(await fetchMsUpcomingEvents("u1")).toEqual([]);
  });

  it("flattens Graph events into the DraftCalendarEvent shape", async () => {
    acct = {
      scope: "openid email Calendars.Read",
      access_token: "t",
      expires_at: 9999999999,
    };
    graphResponses["/me/calendarView"] = {
      value: [
        {
          subject: "CSC108 lecture",
          start: { dateTime: "2026-04-26T15:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-04-26T16:00:00.0000000", timeZone: "UTC" },
          location: { displayName: "BA1190" },
        },
        {
          subject: "Office hours",
          start: { dateTime: "2026-04-27T09:00:00Z" },
          end: { dateTime: "2026-04-27T10:00:00Z" },
          location: null,
        },
        {
          // Missing start — should be filtered.
          subject: "broken",
          start: null,
          end: null,
        },
      ],
    };
    const out = await fetchMsUpcomingEvents("u1");
    expect(lastApiPath).toBe("/me/calendarView");
    expect(out).toEqual([
      {
        title: "CSC108 lecture",
        start: "2026-04-26T15:00:00Z",
        end: "2026-04-26T16:00:00Z",
        location: "BA1190",
      },
      {
        title: "Office hours",
        start: "2026-04-27T09:00:00Z",
        end: "2026-04-27T10:00:00Z",
        location: null,
      },
    ]);
  });
});

describe("fetchMsUpcomingTasks", () => {
  it("soft-fails when Tasks.Read scope is missing", async () => {
    acct = {
      scope: "openid Calendars.Read",
      access_token: "t",
      expires_at: 9999999999,
    };
    expect(await fetchMsUpcomingTasks("u1")).toEqual([]);
  });

  it("flattens To Do tasks into DraftCalendarTask shape", async () => {
    acct = {
      scope: "openid Tasks.Read",
      access_token: "t",
      expires_at: 9999999999,
    };
    graphResponses["/me/todo/lists"] = {
      value: [{ id: "list-A" }, { id: "list-B" }],
    };
    graphResponses["/me/todo/lists/list-A/tasks"] = {
      value: [
        {
          id: "task-A-1",
          title: "Pset 5",
          body: { content: "due Friday" },
          dueDateTime: { dateTime: "2026-04-26T00:00:00.0000000", timeZone: "UTC" },
          status: "notStarted",
        },
      ],
    };
    graphResponses["/me/todo/lists/list-B/tasks"] = {
      value: [
        {
          id: "task-B-1",
          title: "Lab report",
          body: null,
          dueDateTime: { dateTime: "2026-04-25T00:00:00.0000000", timeZone: "UTC" },
          status: "inProgress",
        },
      ],
    };
    const out = await fetchMsUpcomingTasks("u1", { days: 30, max: 50 });
    // Sorted by due date ascending — Lab report (4/25) before Pset 5 (4/26).
    // Engineer-37: rows now carry source IDs for the home one-click flow.
    expect(out).toEqual([
      {
        title: "Lab report",
        due: "2026-04-25",
        notes: null,
        completed: false,
        taskId: "task-B-1",
        taskListId: "list-B",
      },
      {
        title: "Pset 5",
        due: "2026-04-26",
        notes: "due Friday",
        completed: false,
        taskId: "task-A-1",
        taskListId: "list-A",
      },
    ]);
  });
});
