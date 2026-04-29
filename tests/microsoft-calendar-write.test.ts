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

let acct:
  | {
      scope: string;
      access_token: string | null;
      expires_at: number | null;
      providerAccountId?: string;
    }
  | null = null;
const graphResponses: Record<string, unknown> = {};
const captured: Array<{ method: string; path: string; body?: unknown }> = [];
const upserts: Array<Record<string, unknown>> = [];

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
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: async () => {},
        }),
      }),
    },
  };
});

vi.mock("@/lib/auth/oauth-tokens", () => ({
  decryptOAuthToken: (v: string | null) => v,
  encryptOAuthToken: (v: string) => v,
}));

vi.mock("@/lib/agent/preferences", () => ({
  getUserTimezone: async () => "America/Vancouver",
}));

vi.mock("@/lib/calendar/events-store", () => ({
  upsertFromSourceRow: async (row: Record<string, unknown>) => {
    upserts.push(row);
  },
  markDeletedByExternalId: async () => {},
}));

vi.mock("@microsoft/microsoft-graph-client", () => ({
  Client: {
    init: () => ({
      api: (path: string) => {
        const builder: Record<string, unknown> = {
          query: () => builder,
          header: () => builder,
          get: async () => {
            captured.push({ method: "GET", path });
            return graphResponses[`GET ${path}`] ?? graphResponses[path] ?? { value: [] };
          },
          post: async (body: unknown) => {
            captured.push({ method: "POST", path, body });
            return graphResponses[`POST ${path}`] ?? {};
          },
          patch: async (body: unknown) => {
            captured.push({ method: "PATCH", path, body });
            return graphResponses[`PATCH ${path}`] ?? {};
          },
          delete: async () => {
            captured.push({ method: "DELETE", path });
            return undefined;
          },
        };
        return builder;
      },
    }),
  },
}));

import {
  createMsEvent,
  patchMsEvent,
  deleteMsEvent,
} from "@/lib/integrations/microsoft/calendar";
import { MsNotConnectedError } from "@/lib/integrations/microsoft/graph-client";

beforeEach(() => {
  acct = null;
  captured.length = 0;
  upserts.length = 0;
  for (const k of Object.keys(graphResponses)) delete graphResponses[k];
});

describe("createMsEvent", () => {
  it("throws MsNotConnectedError when no account exists", async () => {
    acct = null;
    await expect(
      createMsEvent({
        userId: "u1",
        summary: "x",
        start: "2026-04-26T10:00:00Z",
        end: "2026-04-26T11:00:00Z",
      })
    ).rejects.toBeInstanceOf(MsNotConnectedError);
  });

  it("throws MsNotConnectedError when scope lacks Calendars.ReadWrite", async () => {
    acct = {
      scope: "openid email Calendars.Read",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    await expect(
      createMsEvent({
        userId: "u1",
        summary: "x",
        start: "2026-04-26T10:00:00Z",
        end: "2026-04-26T11:00:00Z",
      })
    ).rejects.toBeInstanceOf(MsNotConnectedError);
  });

  it("POSTs the correct Graph shape for a timed event", async () => {
    acct = {
      scope: "openid email Calendars.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    graphResponses["POST /me/events"] = {
      id: "ms-event-1",
      subject: "Coffee",
      webLink: "https://outlook.office.com/calendar/item/ms-event-1",
      start: { dateTime: "2026-04-26T10:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-04-26T11:00:00.0000000", timeZone: "UTC" },
      isAllDay: false,
    };
    const out = await createMsEvent({
      userId: "u1",
      summary: "Coffee",
      description: "with prof",
      location: "Robarts",
      start: "2026-04-26T10:00:00Z",
      end: "2026-04-26T11:00:00Z",
      reminderMinutesBeforeStart: 15,
    });
    expect(out).toEqual({
      id: "ms-event-1",
      webLink: "https://outlook.office.com/calendar/item/ms-event-1",
    });
    const post = captured.find((c) => c.method === "POST");
    expect(post?.path).toBe("/me/events");
    expect(post?.body).toMatchObject({
      subject: "Coffee",
      start: { dateTime: "2026-04-26T10:00:00", timeZone: "UTC" },
      end: { dateTime: "2026-04-26T11:00:00", timeZone: "UTC" },
      isAllDay: false,
      body: { contentType: "text", content: "with prof" },
      location: { displayName: "Robarts" },
      reminderMinutesBeforeStart: 15,
      isReminderOn: true,
    });
    // Mirror should have been written with sourceType microsoft_graph.
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      sourceType: "microsoft_graph",
      externalId: "ms-event-1",
      title: "Coffee",
      kind: "event",
      isAllDay: false,
    });
  });

  it("handles all-day events with date-only inputs", async () => {
    acct = {
      scope: "openid email Calendars.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    graphResponses["POST /me/events"] = {
      id: "ms-event-allday",
      subject: "Holiday",
      start: { dateTime: "2026-04-26T00:00:00.0000000", timeZone: "America/Vancouver" },
      end: { dateTime: "2026-04-27T00:00:00.0000000", timeZone: "America/Vancouver" },
      isAllDay: true,
    };
    await createMsEvent({
      userId: "u1",
      summary: "Holiday",
      start: "2026-04-26",
      end: "2026-04-26",
    });
    const post = captured.find((c) => c.method === "POST");
    expect(post?.body).toMatchObject({
      isAllDay: true,
      start: { dateTime: "2026-04-26T00:00:00" },
      end: { dateTime: "2026-04-27T00:00:00" },
    });
  });
});

describe("patchMsEvent", () => {
  it("PATCHes /me/events/{id} with summary update", async () => {
    acct = {
      scope: "openid email Calendars.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    graphResponses["PATCH /me/events/ms-event-1"] = {
      id: "ms-event-1",
      subject: "Renamed",
    };
    await patchMsEvent({
      userId: "u1",
      eventId: "ms-event-1",
      patch: { summary: "Renamed" },
    });
    const patch = captured.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/me/events/ms-event-1");
    expect(patch?.body).toEqual({ subject: "Renamed" });
  });
});

describe("deleteMsEvent", () => {
  it("DELETEs /me/events/{id}", async () => {
    acct = {
      scope: "openid email Calendars.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    await deleteMsEvent({ userId: "u1", eventId: "ms-event-1" });
    const del = captured.find((c) => c.method === "DELETE");
    expect(del?.path).toBe("/me/events/ms-event-1");
  });
});
