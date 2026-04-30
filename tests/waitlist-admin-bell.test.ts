import { describe, expect, it, beforeEach, vi } from "vitest";

// Mocks the Drizzle query builder shape that admin-bell.ts uses:
//   db.select({...}).from(t).where(...).orderBy(...).limit(...) → rows
//   db.select({...}).from(t).where(...) → rows  (admin lookup, count)
//   db.insert(t).values([...]).onConflictDoNothing(...) → void
//   db.update(t).set({...}).where(...) → void
//
// Each call records what it was given so tests can assert on the
// recorded fan-out (one insert per admin), the dedupKey passed to
// dismiss, etc.
const hoist = vi.hoisted(() => {
  type SelectShape = "admins" | "list" | "count";
  type Recorded = {
    table: string;
    op: "insert" | "update" | "select";
    values?: unknown;
    setValues?: unknown;
  };
  const state = {
    calls: [] as Recorded[],
    admins: [] as Array<{ id: string }>,
    listRows: [] as Array<Record<string, unknown>>,
    countRow: 0,
    nextSelectShape: "admins" as SelectShape,
  };

  function makeSelect(_cols?: Record<string, unknown>) {
    // The admin-bell module makes three different select shapes. We
    // detect which by inspecting the requested column keys when present;
    // when absent (cols undefined) we fall back to the queue.
    const cols = _cols ? Object.keys(_cols) : [];
    let shape: SelectShape = state.nextSelectShape;
    if (cols.length === 1 && cols[0] === "id") shape = "admins";
    if (cols.includes("summary")) shape = "list";
    if (cols.length === 1 && cols[0] === "n") shape = "count";

    function result(): unknown[] {
      if (shape === "admins") return state.admins;
      if (shape === "list") return state.listRows;
      return [{ n: state.countRow }];
    }

    return {
      from: (_t: unknown) => ({
        where: (..._args: unknown[]) => {
          const r = result();
          return Object.assign(r, {
            orderBy: (..._a: unknown[]) => ({
              limit: (_n: number) => result(),
            }),
            limit: (_n: number) => result(),
          });
        },
      }),
    };
  }

  const db = {
    insert: (t: { __name?: string }) => ({
      values: (vals: unknown[] | unknown) => ({
        onConflictDoNothing: async (_arg?: unknown) => {
          state.calls.push({
            table: t.__name ?? "agent_proposals",
            op: "insert",
            values: vals,
          });
        },
      }),
    }),
    update: (t: { __name?: string }) => ({
      set: (setValues: Record<string, unknown>) => ({
        where: async (..._args: unknown[]) => {
          state.calls.push({
            table: t.__name ?? "agent_proposals",
            op: "update",
            setValues,
          });
        },
      }),
    }),
    select: (cols?: Record<string, unknown>) => makeSelect(cols),
  };

  return { state, db };
});

vi.mock("@/lib/db/client", () => ({ db: hoist.db }));

vi.mock("@/lib/db/schema", () => {
  // Drizzle column proxies — callers chain `.eq`, `.inArray`, etc., but
  // our mock builder ignores the predicates entirely. We just need the
  // imported symbols to exist.
  const col = (name: string) => ({ name });
  return {
    agentProposals: {
      __name: "agent_proposals",
      id: col("id"),
      userId: col("user_id"),
      issueType: col("issue_type"),
      issueSummary: col("issue_summary"),
      sourceRefs: col("source_refs"),
      status: col("status"),
      dedupKey: col("dedup_key"),
      createdAt: col("created_at"),
      resolvedAt: col("resolved_at"),
    },
    users: {
      __name: "users",
      id: col("id"),
      isAdmin: col("is_admin"),
    },
  };
});

import {
  dedupKeyForWaitlistRequest,
  dismissWaitlistAdminNotifications,
  loadWaitlistAdminPending,
  recordWaitlistAdminNotification,
} from "@/lib/waitlist/admin-bell";

beforeEach(() => {
  hoist.state.calls = [];
  hoist.state.admins = [];
  hoist.state.listRows = [];
  hoist.state.countRow = 0;
});

describe("recordWaitlistAdminNotification", () => {
  it("inserts one agent_proposals row per admin user", async () => {
    hoist.state.admins = [{ id: "admin-1" }, { id: "admin-2" }];

    await recordWaitlistAdminNotification({
      waitlistRequestId: "wl-123",
      email: "alice@uni.edu",
      name: "Alice",
      requestedAt: new Date("2026-04-29T12:00:00Z"),
    });

    const inserts = hoist.state.calls.filter((c) => c.op === "insert");
    expect(inserts).toHaveLength(1);
    const values = inserts[0].values as Array<Record<string, unknown>>;
    expect(values).toHaveLength(2);
    expect(values.map((v) => v.userId).sort()).toEqual(["admin-1", "admin-2"]);
    expect(values[0].issueType).toBe("admin_waitlist_pending");
    expect(values[0].issueSummary).toBe("New waitlist request from alice@uni.edu");
    expect(values[0].dedupKey).toBe("admin_waitlist_pending:wl-123");
    expect(values[0].sourceRefs).toEqual([
      { kind: "waitlist_request", id: "wl-123", label: "alice@uni.edu" },
    ]);
  });

  it("no-ops when there are no admin users", async () => {
    hoist.state.admins = [];

    await recordWaitlistAdminNotification({
      waitlistRequestId: "wl-empty",
      email: "lonely@example.com",
      name: null,
      requestedAt: new Date(),
    });

    expect(hoist.state.calls.filter((c) => c.op === "insert")).toHaveLength(0);
  });

  it("omits the name parenthetical from reasoning when name is null", async () => {
    hoist.state.admins = [{ id: "admin-1" }];

    await recordWaitlistAdminNotification({
      waitlistRequestId: "wl-noname",
      email: "anon@example.com",
      name: null,
      requestedAt: new Date("2026-04-29T00:00:00Z"),
    });

    const values = hoist.state.calls[0].values as Array<Record<string, unknown>>;
    expect(values[0].reasoning).not.toMatch(/\(/);
    expect(values[0].reasoning).toContain("anon@example.com requested access");
  });
});

describe("dismissWaitlistAdminNotifications", () => {
  it("flips matching rows to status='dismissed' with resolvedAt", async () => {
    await dismissWaitlistAdminNotifications(["wl-1", "wl-2"]);

    const updates = hoist.state.calls.filter((c) => c.op === "update");
    expect(updates).toHaveLength(1);
    const set = updates[0].setValues as Record<string, unknown>;
    expect(set.status).toBe("dismissed");
    expect(set.resolvedAt).toBeInstanceOf(Date);
  });

  it("no-ops on empty input (avoids an empty inArray)", async () => {
    await dismissWaitlistAdminNotifications([]);
    expect(hoist.state.calls.filter((c) => c.op === "update")).toHaveLength(0);
  });
});

describe("loadWaitlistAdminPending", () => {
  it("returns items + total count, deriving waitlistRequestId from sourceRefs", async () => {
    hoist.state.listRows = [
      {
        id: "p1",
        summary: "New waitlist request from a@x.com",
        sourceRefs: [{ kind: "waitlist_request", id: "wl-1", label: "a@x.com" }],
        createdAt: new Date("2026-04-29T10:00:00Z"),
      },
      {
        id: "p2",
        summary: "New waitlist request from b@x.com",
        sourceRefs: [{ kind: "waitlist_request", id: "wl-2", label: "b@x.com" }],
        createdAt: new Date("2026-04-29T09:00:00Z"),
      },
    ];
    hoist.state.countRow = 7;

    const result = await loadWaitlistAdminPending("admin-1", 5);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].waitlistRequestId).toBe("wl-1");
    expect(result.items[1].waitlistRequestId).toBe("wl-2");
    expect(result.total).toBe(7);
  });

  it("falls back to empty waitlistRequestId when sourceRefs lack the expected entry", async () => {
    hoist.state.listRows = [
      {
        id: "p1",
        summary: "stray row",
        sourceRefs: [],
        createdAt: new Date(),
      },
    ];
    hoist.state.countRow = 1;

    const result = await loadWaitlistAdminPending("admin-1", 5);
    expect(result.items[0].waitlistRequestId).toBe("");
  });
});

describe("dedupKeyForWaitlistRequest", () => {
  it("matches the format used by dismiss", () => {
    expect(dedupKeyForWaitlistRequest("abc")).toBe("admin_waitlist_pending:abc");
  });
});
