import { describe, expect, it, beforeEach, vi } from "vitest";

const hoist = vi.hoisted(() => {
  const state = {
    conn: null as null | {
      accessTokenEncrypted: string;
      classesDbId: string | null;
      mistakesDbId: string | null;
    },
    alive: new Set<string>(),
  };
  const dbMock = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (state.conn ? [state.conn] : []),
        }),
      }),
    }),
  };
  return { state, dbMock };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.dbMock }));
vi.mock("@/lib/db/schema", () => ({ notionConnections: { __name: "conn", userId: "userId" } }));
vi.mock("drizzle-orm", () => ({
  eq: () => ({}),
  and: () => ({}),
  isNull: () => ({}),
}));
vi.mock("@/lib/utils/crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/integrations/notion/client", () => ({
  notionClientFromToken: () => ({}),
}));
vi.mock("@/lib/integrations/notion/probe", () => ({
  databaseStillExists: async (_client: unknown, id: string) =>
    hoist.state.alive.has(id),
}));

import { checkDatabaseHealth } from "@/lib/views/notion-health";

beforeEach(() => {
  hoist.state.conn = null;
  hoist.state.alive = new Set();
});

describe("checkDatabaseHealth", () => {
  it("returns not_connected when no notion_connections row exists", async () => {
    const h = await checkDatabaseHealth({
      userId: "u",
      databaseSelector: "mistakesDbId",
    });
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.reason).toBe("not_connected");
  });

  it("returns not_set_up when the selected DB id is null", async () => {
    hoist.state.conn = {
      accessTokenEncrypted: "tok",
      classesDbId: "c",
      mistakesDbId: null,
    };
    const h = await checkDatabaseHealth({
      userId: "u",
      databaseSelector: "mistakesDbId",
    });
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.reason).toBe("not_set_up");
  });

  it("returns deleted when the DB id is set but Notion no longer has it", async () => {
    hoist.state.conn = {
      accessTokenEncrypted: "tok",
      classesDbId: "c",
      mistakesDbId: "m",
    };
    hoist.state.alive = new Set(); // nothing alive
    const h = await checkDatabaseHealth({
      userId: "u",
      databaseSelector: "mistakesDbId",
    });
    expect(h.ok).toBe(false);
    if (!h.ok) expect(h.reason).toBe("deleted");
  });

  it("returns ok when the DB is alive in Notion", async () => {
    hoist.state.conn = {
      accessTokenEncrypted: "tok",
      classesDbId: "c",
      mistakesDbId: "m",
    };
    hoist.state.alive = new Set(["m"]);
    const h = await checkDatabaseHealth({
      userId: "u",
      databaseSelector: "mistakesDbId",
    });
    expect(h.ok).toBe(true);
    if (h.ok) expect(h.databaseId).toBe("m");
  });
});
