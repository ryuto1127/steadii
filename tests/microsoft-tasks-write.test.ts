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
  createMsTask,
  patchMsTask,
  deleteMsTask,
} from "@/lib/integrations/microsoft/tasks";
import { MsNotConnectedError } from "@/lib/integrations/microsoft/graph-client";

beforeEach(() => {
  acct = null;
  captured.length = 0;
  upserts.length = 0;
  for (const k of Object.keys(graphResponses)) delete graphResponses[k];
});

describe("createMsTask", () => {
  it("throws MsNotConnectedError when scope lacks Tasks.ReadWrite", async () => {
    acct = {
      scope: "openid email Tasks.Read",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    await expect(
      createMsTask({ userId: "u1", title: "x" })
    ).rejects.toBeInstanceOf(MsNotConnectedError);
  });

  it("resolves the wellknown defaultList and POSTs the task", async () => {
    acct = {
      scope: "openid email Tasks.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    graphResponses["GET /me/todo/lists"] = {
      value: [
        { id: "list-A", displayName: "Other", wellknownListName: "none" },
        { id: "list-default", displayName: "Tasks", wellknownListName: "defaultList" },
      ],
    };
    graphResponses["POST /me/todo/lists/list-default/tasks"] = {
      id: "task-1",
      title: "Pset 5",
      dueDateTime: { dateTime: "2026-04-26T00:00:00.0000000", timeZone: "America/Vancouver" },
      status: "notStarted",
    };
    const out = await createMsTask({
      userId: "u1",
      title: "Pset 5",
      notes: "due Friday",
      due: "2026-04-26",
    });
    expect(out).toEqual({ id: "task-1", listId: "list-default" });
    const post = captured.find((c) => c.method === "POST");
    expect(post?.path).toBe("/me/todo/lists/list-default/tasks");
    expect(post?.body).toMatchObject({
      title: "Pset 5",
      body: { contentType: "text", content: "due Friday" },
      dueDateTime: {
        dateTime: "2026-04-26T00:00:00",
        timeZone: "America/Vancouver",
      },
    });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({
      sourceType: "microsoft_todo",
      externalParentId: "list-default",
      externalId: "task-1",
      title: "Pset 5",
      kind: "task",
    });
  });

  it("uses an explicit listId when provided (skips default-list lookup)", async () => {
    acct = {
      scope: "openid email Tasks.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    graphResponses["POST /me/todo/lists/custom-list/tasks"] = { id: "t-2", title: "x" };
    await createMsTask({ userId: "u1", title: "x", listId: "custom-list" });
    const lookup = captured.find((c) => c.method === "GET" && c.path === "/me/todo/lists");
    expect(lookup).toBeUndefined();
    const post = captured.find((c) => c.method === "POST");
    expect(post?.path).toBe("/me/todo/lists/custom-list/tasks");
  });
});

describe("patchMsTask", () => {
  it("PATCHes status=completed for completion", async () => {
    acct = {
      scope: "openid email Tasks.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    graphResponses["PATCH /me/todo/lists/L/tasks/T"] = {
      id: "T",
      title: "x",
      status: "completed",
    };
    await patchMsTask({
      userId: "u1",
      taskId: "T",
      listId: "L",
      patch: { status: "completed" },
    });
    const patch = captured.find((c) => c.method === "PATCH");
    expect(patch?.path).toBe("/me/todo/lists/L/tasks/T");
    expect(patch?.body).toEqual({ status: "completed" });
  });
});

describe("deleteMsTask", () => {
  it("DELETEs /me/todo/lists/{listId}/tasks/{taskId}", async () => {
    acct = {
      scope: "openid email Tasks.ReadWrite",
      access_token: "t",
      expires_at: 9999999999,
      providerAccountId: "msuser",
    };
    await deleteMsTask({ userId: "u1", listId: "L", taskId: "T" });
    const del = captured.find((c) => c.method === "DELETE");
    expect(del?.path).toBe("/me/todo/lists/L/tasks/T");
  });
});
