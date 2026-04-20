import { describe, expect, it, beforeEach, vi } from "vitest";

type ConnRow = {
  id: string;
  userId: string;
  workspaceId: string;
  workspaceName: string | null;
  workspaceIcon: string | null;
  botId: string;
  accessTokenEncrypted: string;
  parentPageId: string | null;
  classesDbId: string | null;
  mistakesDbId: string | null;
  assignmentsDbId: string | null;
  syllabiDbId: string | null;
  setupCompletedAt: Date | null;
};

const hoist = vi.hoisted(() => {
  const state = {
    conn: null as ConnRow | null,
    resources: [] as Array<Record<string, unknown>>,
    audit: [] as Array<Record<string, unknown>>,
    notionAlive: new Set<string>(), // database ids the fake Notion still has
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
          const rows = table.__name === "conn" && state.conn && matches(state.conn as unknown as Record<string, unknown>, filter)
            ? [state.conn]
            : [];
          return {
            limit: () => rows,
            [Symbol.iterator]: () => rows[Symbol.iterator](),
          };
        },
      }),
    }),
    update: (table: { __name: string }) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (filter: unknown) => {
          if (table.__name === "conn" && state.conn) {
            if (matches(state.conn as unknown as Record<string, unknown>, filter)) {
              Object.assign(state.conn, patch);
            }
          }
          if (table.__name === "resources") {
            for (const r of state.resources) {
              if (matches(r, filter)) Object.assign(r, patch);
            }
          }
        },
      }),
    }),
    insert: (table: { __name: string }) => ({
      values: async (v: unknown) => {
        const arr = Array.isArray(v) ? v : [v];
        if (table.__name === "resources") state.resources.push(...(arr as Record<string, unknown>[]));
        if (table.__name === "audit") state.audit.push(...(arr as Record<string, unknown>[]));
      },
    }),
  };

  return { state, dbMock };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.dbMock }));
vi.mock("@/lib/db/schema", () => ({
  notionConnections: { __name: "conn", userId: "userId", id: "id" },
  registeredResources: { __name: "resources", userId: "userId", connectionId: "connectionId" },
  auditLog: { __name: "audit" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (col: unknown, val: unknown) => ({
    __op: "eq",
    col: typeof col === "string" ? col : (col as { toString: () => string }).toString(),
    val,
  }),
  and: (...children: unknown[]) => ({ __op: "and", children }),
  isNull: (col: unknown) => ({
    __op: "isNull",
    col: typeof col === "string" ? col : (col as { toString: () => string }).toString(),
  }),
}));
vi.mock("@/lib/utils/crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/integrations/notion/client", () => ({
  notionClientFromToken: () => ({}),
}));

// runNotionSetup spy: controlled via hoist.state
vi.mock("@/lib/integrations/notion/setup", () => {
  return {
    runNotionSetup: vi.fn(async () => ({
      parentPageId: "new-parent",
      classesDbId: "new-classes",
      mistakesDbId: "new-mistakes",
      assignmentsDbId: "new-assignments",
      syllabiDbId: "new-syllabi",
    })),
    NotionSetupNoAccessiblePageError: class extends Error {},
  };
});

import { ensureNotionSetup } from "@/lib/integrations/notion/ensure-setup";
import { runNotionSetup } from "@/lib/integrations/notion/setup";

function setupConn(fields: Partial<ConnRow> = {}) {
  hoist.state.conn = {
    id: "conn-1",
    userId: "user-1",
    workspaceId: "ws-1",
    workspaceName: "WS",
    workspaceIcon: null,
    botId: "bot",
    accessTokenEncrypted: "tok",
    parentPageId: null,
    classesDbId: null,
    mistakesDbId: null,
    assignmentsDbId: null,
    syllabiDbId: null,
    setupCompletedAt: null,
    ...fields,
  };
  hoist.state.resources = [];
  hoist.state.audit = [];
}

beforeEach(() => {
  (runNotionSetup as unknown as { mockClear: () => void }).mockClear();
});

// Also mock probe to rely on state.notionAlive
vi.mock("@/lib/integrations/notion/probe", () => ({
  databaseStillExists: async (_client: unknown, id: string) => {
    return hoist.state.notionAlive.has(id);
  },
  pageStillExists: async () => true,
}));

describe("ensureNotionSetup", () => {
  it("throws when the user has no Notion connection", async () => {
    hoist.state.conn = null;
    await expect(ensureNotionSetup("user-1")).rejects.toMatchObject({
      code: "NOTION_NOT_CONNECTED",
    });
  });

  it("no-ops when setup is complete and Classes DB is still alive", async () => {
    setupConn({
      parentPageId: "parent",
      classesDbId: "existing-classes",
      mistakesDbId: "m",
      assignmentsDbId: "a",
      syllabiDbId: "s",
      setupCompletedAt: new Date(),
    });
    hoist.state.notionAlive = new Set(["existing-classes"]);
    const out = await ensureNotionSetup("user-1");
    expect(out.status).toBe("already_complete");
    expect(out.result.classesDbId).toBe("existing-classes");
    expect(runNotionSetup).not.toHaveBeenCalled();
  });

  it("re-runs setup when Classes DB is missing in Notion", async () => {
    setupConn({
      parentPageId: "parent",
      classesDbId: "dead-classes",
      mistakesDbId: "m",
      assignmentsDbId: "a",
      syllabiDbId: "s",
      setupCompletedAt: new Date(),
    });
    hoist.state.notionAlive = new Set(); // nothing alive
    const out = await ensureNotionSetup("user-1");
    expect(out.status).toBe("re_set_up");
    expect((out as { reason?: string }).reason).toBe("deleted_in_notion");
    expect(runNotionSetup).toHaveBeenCalledTimes(1);
    expect(hoist.state.conn!.classesDbId).toBe("new-classes");
    // Audit trail records the re-run
    expect(
      hoist.state.audit.some((r) => r.action === "notion.setup.re_run")
    ).toBe(true);
  });

  it("runs fresh setup when classes_db_id is not set yet", async () => {
    setupConn();
    const out = await ensureNotionSetup("user-1");
    expect(out.status).toBe("freshly_set_up");
    expect(runNotionSetup).toHaveBeenCalledTimes(1);
    expect(hoist.state.conn!.classesDbId).toBe("new-classes");
    expect(hoist.state.conn!.setupCompletedAt).toBeInstanceOf(Date);
    // 5 auto-registered resources seeded (parent + 4 DBs)
    expect(hoist.state.resources).toHaveLength(5);
  });

  it("force=true always re-runs even if current setup is healthy", async () => {
    setupConn({
      parentPageId: "parent",
      classesDbId: "existing-classes",
      mistakesDbId: "m",
      assignmentsDbId: "a",
      syllabiDbId: "s",
      setupCompletedAt: new Date(),
    });
    hoist.state.notionAlive = new Set(["existing-classes"]);
    const out = await ensureNotionSetup("user-1", { force: true });
    expect(out.status).toBe("re_set_up");
    expect((out as { reason?: string }).reason).toBe("forced");
    expect(runNotionSetup).toHaveBeenCalledTimes(1);
  });
});
