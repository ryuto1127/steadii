import { describe, expect, it, beforeEach, vi } from "vitest";

type ConnectionRow = {
  id: string;
  userId: string;
  workspaceId: string;
  parentPageId: string | null;
  accessTokenEncrypted: string;
};

type ResourceRow = {
  id: string;
  userId: string;
  connectionId: string;
  resourceType: "page" | "database";
  notionId: string;
  title: string | null;
  parentNotionId: string | null;
  autoRegistered: number;
  createdAt: Date;
  archivedAt: Date | null;
};

const hoist = vi.hoisted(() => {
  const state = {
    connections: [] as ConnectionRow[],
    resources: [] as ResourceRow[],
    audit: [] as Array<Record<string, unknown>>,
    idSeq: 0,
  };

  function matches(row: Record<string, unknown>, filter: unknown): boolean {
    if (!filter) return true;
    const f = filter as { __op: string; [k: string]: unknown };
    if (f.__op === "eq") return row[f.col as string] === f.val;
    if (f.__op === "and")
      return (f.children as unknown[]).every((c) => matches(row, c));
    if (f.__op === "isNull") return row[f.col as string] == null;
    return true;
  }

  const dbMock = {
    select: () => ({
      from: (table: { __name: string }) => ({
        where: (filter: unknown) => {
          const all =
            table.__name === "connections" ? state.connections : state.resources;
          const rows = all.filter((r) =>
            matches(r as Record<string, unknown>, filter)
          );
          return {
            limit: (_n: number) => rows,
            // plain iterable for plain .where().then(...)
            then: (cb: (v: unknown) => unknown) => cb(rows),
            [Symbol.iterator]: () => rows[Symbol.iterator](),
          };
        },
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: async (
        vals: Record<string, unknown> | Record<string, unknown>[]
      ) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        if (table.__name === "resources") {
          for (const v of arr) {
            state.idSeq += 1;
            state.resources.push({
              id: `r-${state.idSeq}`,
              createdAt: new Date(),
              archivedAt: null,
              ...v,
            } as ResourceRow);
          }
        } else if (table.__name === "audit") {
          state.audit.push(...arr);
        }
      },
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (filter: unknown) => {
          if (table.__name !== "resources") return;
          for (const r of state.resources) {
            if (matches(r as Record<string, unknown>, filter)) {
              Object.assign(r, patch);
            }
          }
        },
      }),
    }),
  };

  return { state, dbMock };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.dbMock }));

vi.mock("@/lib/db/schema", () => ({
  notionConnections: { __name: "connections", userId: "userId", id: "id" },
  registeredResources: {
    __name: "resources",
    userId: "userId",
    connectionId: "connectionId",
    archivedAt: "archivedAt",
    id: "id",
  },
  auditLog: { __name: "audit" },
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: { toString: () => string } | string, val: unknown) => ({
    __op: "eq",
    col: typeof col === "string" ? col : col.toString(),
    val,
  }),
  and: (...children: unknown[]) => ({ __op: "and", children }),
  isNull: (col: { toString: () => string } | string) => ({
    __op: "isNull",
    col: typeof col === "string" ? col : col.toString(),
  }),
}));

vi.mock("@/lib/utils/crypto", () => ({
  decrypt: (s: string) => s,
}));

vi.mock("@/lib/integrations/notion/client", () => ({
  notionClientFromToken: () => ({}),
}));

import {
  discoverResources,
  clearDiscoveryCache,
} from "@/lib/integrations/notion/discovery";

function makeClient(
  children: Array<
    | { id: string; type: "child_database"; child_database: { title: string } }
    | { id: string; type: "child_page"; child_page: { title: string } }
  >
) {
  return {
    blocks: {
      children: {
        list: vi.fn(async () => ({ results: children, next_cursor: null })),
      },
    },
  };
}

beforeEach(() => {
  hoist.state.connections = [
    {
      id: "conn-1",
      userId: "user-1",
      workspaceId: "ws-1",
      parentPageId: "steadii-parent",
      accessTokenEncrypted: "tok",
    },
  ];
  hoist.state.resources = [];
  hoist.state.audit = [];
  hoist.state.idSeq = 0;
  clearDiscoveryCache();
});

describe("discoverResources", () => {
  it("inserts new databases and pages found under the Steadii parent", async () => {
    const client = makeClient([
      {
        id: "db-classes",
        type: "child_database",
        child_database: { title: "Classes" },
      },
      {
        id: "page-prof-bio",
        type: "child_page",
        child_page: { title: "Prof bio" },
      },
    ]);

    const res = await discoverResources("user-1", {
      force: true,
      client: client as never,
    });

    expect(res.inserted.sort()).toEqual(["db-classes", "page-prof-bio"].sort());
    expect(res.archived).toEqual([]);
    expect(hoist.state.resources).toHaveLength(2);
    expect(
      hoist.state.resources.find((r) => r.notionId === "db-classes")?.resourceType
    ).toBe("database");
    expect(
      hoist.state.resources.find((r) => r.notionId === "page-prof-bio")?.resourceType
    ).toBe("page");
    expect(
      hoist.state.resources.every(
        (r) => r.autoRegistered === 1 && r.archivedAt === null
      )
    ).toBe(true);
  });

  it("archives resources that disappear from Notion", async () => {
    hoist.state.resources.push({
      id: "r-existing",
      userId: "user-1",
      connectionId: "conn-1",
      resourceType: "database",
      notionId: "db-old",
      title: "Old DB",
      parentNotionId: "steadii-parent",
      autoRegistered: 1,
      createdAt: new Date(),
      archivedAt: null,
    });

    const client = makeClient([]);
    const res = await discoverResources("user-1", {
      force: true,
      client: client as never,
    });

    expect(res.archived).toEqual(["db-old"]);
    expect(hoist.state.resources[0].archivedAt).toBeInstanceOf(Date);
  });

  it("caches results for 60 seconds", async () => {
    const client = makeClient([
      { id: "db-a", type: "child_database", child_database: { title: "A" } },
    ]);
    const t0 = 1_700_000_000_000;
    await discoverResources("user-1", { now: t0, client: client as never });
    expect(client.blocks.children.list).toHaveBeenCalledTimes(1);

    await discoverResources("user-1", {
      now: t0 + 30_000,
      client: client as never,
    });
    expect(client.blocks.children.list).toHaveBeenCalledTimes(1);

    await discoverResources("user-1", {
      now: t0 + 61_000,
      client: client as never,
    });
    expect(client.blocks.children.list).toHaveBeenCalledTimes(2);
  });

  it("force bypasses the cache", async () => {
    const client = makeClient([]);
    const t0 = 1_700_000_000_000;
    await discoverResources("user-1", { now: t0, client: client as never });
    await discoverResources("user-1", {
      now: t0 + 10_000,
      client: client as never,
      force: true,
    });
    expect(client.blocks.children.list).toHaveBeenCalledTimes(2);
  });

  it("does not re-insert an already-registered resource", async () => {
    hoist.state.resources.push({
      id: "r-existing",
      userId: "user-1",
      connectionId: "conn-1",
      resourceType: "database",
      notionId: "db-classes",
      title: "Classes",
      parentNotionId: "steadii-parent",
      autoRegistered: 1,
      createdAt: new Date(),
      archivedAt: null,
    });

    const client = makeClient([
      {
        id: "db-classes",
        type: "child_database",
        child_database: { title: "Classes" },
      },
    ]);
    const res = await discoverResources("user-1", {
      force: true,
      client: client as never,
    });
    expect(res.inserted).toEqual([]);
    expect(res.unchanged).toBe(1);
  });
});
