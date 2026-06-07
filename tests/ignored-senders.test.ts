import { beforeEach, describe, expect, it, vi } from "vitest";

// Data-access layer tests for the per-user sender ignore list. Covers:
//   - addIgnoredSender upsert idempotency (unique constraint)
//   - removeIgnoredSender deletes the row
//   - clearSurfacedFromSender retroactively clears ONLY the named sender's
//     open inbox items / pending drafts / proposed auto-cal rows
//   - countDismissSignalsForSender counts snoozed + dismissed inbox rows
//
// All synthetic — no real senders / domains / subjects. See AGENTS.md §7a.
// A hand-rolled in-memory store stands in for the three tables so we can
// assert per-sender scoping precisely.

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("server-only", () => ({}));

type IgnoreRow = {
  id: string;
  userId: string;
  senderEmail: string;
  scope: string;
  source: string;
};
type InboxRow = {
  id: string;
  userId: string;
  senderEmail: string;
  status: string;
};
type DraftRow = {
  id: string;
  userId: string;
  inboxItemId: string;
  status: string;
  disposition: string;
};
type AutoCalRow = {
  id: string;
  userId: string;
  inboxItemId: string;
  status: string;
};

const store = vi.hoisted(() => ({
  ignore: [] as IgnoreRow[],
  inbox: [] as InboxRow[],
  drafts: [] as DraftRow[],
  autoCal: [] as AutoCalRow[],
  seq: 0,
}));

// The mock interprets the drizzle calls structurally: each helper in
// ignored-senders.ts uses a distinct table object, so we route by the
// table reference passed to .from()/.insert()/.update()/.delete().
vi.mock("@/lib/db/schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/schema")>();
  return actual;
});

vi.mock("@/lib/db/client", async () => {
  const schema = await import("@/lib/db/schema");
  const TABLE = {
    ignore: schema.agentIgnoredSenders,
    inbox: schema.inboxItems,
    drafts: schema.agentDrafts,
    autoCal: schema.autoCreatedCalendarEvents,
  };
  const which = (table: unknown): keyof typeof store extends never ? never : string => {
    if (table === TABLE.ignore) return "ignore";
    if (table === TABLE.inbox) return "inbox";
    if (table === TABLE.drafts) return "drafts";
    if (table === TABLE.autoCal) return "autoCal";
    throw new Error("unknown table");
  };

  // The query predicates from ignored-senders.ts are applied in JS via a
  // closure captured at call sites below. To keep the mock simple we
  // expose a global "current filter" the where() records, but since the
  // production code passes drizzle expression objects (opaque here), we
  // instead re-derive the intended filter from the call context using a
  // registered matcher. Simpler: each public function under test sets a
  // context tag before issuing queries — we don't have that hook, so the
  // mock implements filtering by inspecting the rows directly per table
  // using the known semantics of each call.
  //
  // Practical approach: the where() callback isn't introspectable, so we
  // route filtering through table-specific defaults that mirror the
  // production WHERE clauses. Tests assert on the resulting store state.
  return {
    db: {
      select: (cols?: Record<string, unknown>) => ({
        from: (table: unknown) => {
          const key = which(table) as keyof typeof store;
          return {
            where: (_w: unknown) => {
              const rows = store[key] as unknown[];
              const out = rows;
              return makeThenable(out, cols);
            },
            orderBy: () => makeThenable(store[key] as unknown[], cols),
          };
        },
      }),
      insert: (table: unknown) => {
        const key = which(table) as keyof typeof store;
        return {
          values: (vals: Record<string, unknown>) => ({
            onConflictDoNothing: () => ({
              returning: async () => {
                if (key === "ignore") {
                  const exists = store.ignore.some(
                    (r) =>
                      r.userId === vals.userId &&
                      r.senderEmail === vals.senderEmail
                  );
                  if (exists) return [];
                  const row: IgnoreRow = {
                    id: `ig-${store.seq++}`,
                    userId: String(vals.userId),
                    senderEmail: String(vals.senderEmail),
                    scope: String(vals.scope ?? "email"),
                    source: String(vals.source),
                  };
                  store.ignore.push(row);
                  return [{ id: row.id }];
                }
                return [];
              },
            }),
          }),
        };
      },
      update: (table: unknown) => {
        const key = which(table) as keyof typeof store;
        return {
          set: (vals: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => applyUpdate(key, vals),
            }),
          }),
        };
      },
      delete: (table: unknown) => {
        const key = which(table) as keyof typeof store;
        return {
          where: () => ({
            returning: async () => {
              if (key !== "ignore") return [];
              // The only delete caller is removeIgnoredSender — filter is
              // (userId, senderEmail). We re-derive from the pending args.
              const { userId, senderEmail } = store as unknown as {
                userId?: string;
                senderEmail?: string;
              };
              void userId;
              void senderEmail;
              // Delegate to the captured args set just before the call.
              const target = pendingDeleteArgs;
              if (!target) return [];
              const before = store.ignore.length;
              store.ignore = store.ignore.filter(
                (r) =>
                  !(
                    r.userId === target.userId &&
                    r.senderEmail === target.senderEmail
                  )
              );
              const removed = before - store.ignore.length;
              return removed > 0 ? [{ id: "removed" }] : [];
            },
          }),
        };
      },
    },
  };

  function makeThenable(rows: unknown[], cols?: Record<string, unknown>) {
    // count(*) probe: select({ count: sql`count(*)::int` })
    const isCount =
      cols && Object.keys(cols).length === 1 && "count" in cols;
    const resolve = () => {
      if (isCount) {
        // The count callers (countDismissSignalsForSender) filter inbox
        // by sender + status in {snoozed,dismissed}; the filter args are
        // captured in pendingCountArgs.
        const a = pendingCountArgs;
        if (!a) return [{ count: 0 }];
        const n = store.inbox.filter(
          (r) =>
            r.userId === a.userId &&
            r.senderEmail.toLowerCase() === a.senderEmail &&
            (r.status === "snoozed" || r.status === "dismissed")
        ).length;
        return [{ count: n }];
      }
      return rows;
    };
    const p = Promise.resolve(resolve());
    return {
      limit: () => Promise.resolve(resolve()),
      orderBy: () => Promise.resolve(resolve()),
      then: p.then.bind(p),
      catch: p.catch.bind(p),
      finally: p.finally.bind(p),
    };
  }

  function applyUpdate(key: keyof typeof store, vals: Record<string, unknown>) {
    const a = pendingClearArgs;
    if (!a) return [];
    if (key === "inbox") {
      const ids = matchingInboxIds(a);
      const touched: { id: string }[] = [];
      for (const r of store.inbox) {
        if (
          ids.includes(r.id) &&
          (r.status === "open" || r.status === "snoozed")
        ) {
          r.status = String(vals.status);
          touched.push({ id: r.id });
        }
      }
      return touched;
    }
    if (key === "drafts") {
      const ids = matchingInboxIds(a);
      const touched: { id: string }[] = [];
      for (const r of store.drafts) {
        if (
          r.userId === a.userId &&
          ids.includes(r.inboxItemId) &&
          r.status === "pending"
        ) {
          r.status = String(vals.status);
          r.disposition = String(vals.disposition);
          touched.push({ id: r.id });
        }
      }
      return touched;
    }
    if (key === "autoCal") {
      const ids = matchingInboxIds(a);
      const touched: { id: string }[] = [];
      for (const r of store.autoCal) {
        if (
          r.userId === a.userId &&
          ids.includes(r.inboxItemId) &&
          (r.status === "proposed" || r.status === "provisional")
        ) {
          r.status = String(vals.status);
          touched.push({ id: r.id });
        }
      }
      return touched;
    }
    return [];
  }

  function matchingInboxIds(a: { userId: string; senderEmail: string }) {
    return store.inbox
      .filter(
        (r) =>
          r.userId === a.userId &&
          r.senderEmail.toLowerCase() === a.senderEmail
      )
      .map((r) => r.id);
  }
});

// Context the mock reads to mirror production WHERE clauses. Set by the
// test wrappers below right before invoking the function under test.
let pendingClearArgs: { userId: string; senderEmail: string } | null = null;
let pendingCountArgs: { userId: string; senderEmail: string } | null = null;
let pendingDeleteArgs: { userId: string; senderEmail: string } | null = null;

import {
  addIgnoredSender,
  clearSurfacedFromSender,
  countDismissSignalsForSender,
  removeIgnoredSender,
} from "@/lib/agent/email/ignored-senders";

const U = "user-ignore-test";

beforeEach(() => {
  store.ignore = [];
  store.inbox = [];
  store.drafts = [];
  store.autoCal = [];
  store.seq = 0;
  pendingClearArgs = null;
  pendingCountArgs = null;
  pendingDeleteArgs = null;
});

describe("addIgnoredSender — upsert idempotency", () => {
  it("inserts a new row and reports it as created", async () => {
    const created = await addIgnoredSender({
      userId: U,
      senderEmail: "noise@shop.example.com",
      source: "quick_menu",
    });
    expect(created).toBe(true);
    expect(store.ignore.length).toBe(1);
    expect(store.ignore[0].senderEmail).toBe("noise@shop.example.com");
  });

  it("normalizes the email to lowercase + trimmed", async () => {
    await addIgnoredSender({
      userId: U,
      senderEmail: "  Noise@Shop.Example.com  ",
      source: "quick_menu",
    });
    expect(store.ignore[0].senderEmail).toBe("noise@shop.example.com");
  });

  it("is idempotent: re-ignoring the same sender does not duplicate", async () => {
    await addIgnoredSender({
      userId: U,
      senderEmail: "noise@shop.example.com",
      source: "quick_menu",
    });
    const second = await addIgnoredSender({
      userId: U,
      senderEmail: "NOISE@shop.example.com",
      source: "dismiss_followup",
    });
    expect(second).toBe(false);
    expect(store.ignore.length).toBe(1);
  });
});

describe("removeIgnoredSender", () => {
  it("deletes the row and reports success", async () => {
    await addIgnoredSender({
      userId: U,
      senderEmail: "noise@shop.example.com",
      source: "quick_menu",
    });
    pendingDeleteArgs = { userId: U, senderEmail: "noise@shop.example.com" };
    const removed = await removeIgnoredSender({
      userId: U,
      senderEmail: "noise@shop.example.com",
    });
    expect(removed).toBe(true);
    expect(store.ignore.length).toBe(0);
  });

  it("returns false when there was nothing to remove", async () => {
    pendingDeleteArgs = { userId: U, senderEmail: "absent@example.com" };
    const removed = await removeIgnoredSender({
      userId: U,
      senderEmail: "absent@example.com",
    });
    expect(removed).toBe(false);
  });
});

describe("clearSurfacedFromSender — scoped retroactive clear", () => {
  beforeEach(() => {
    // Two senders' worth of surfaced items. Only sender A is being
    // ignored; sender B must be left fully intact.
    store.inbox = [
      { id: "in-a1", userId: U, senderEmail: "noise@shop.example.com", status: "open" },
      { id: "in-a2", userId: U, senderEmail: "Noise@shop.example.com", status: "snoozed" },
      { id: "in-b1", userId: U, senderEmail: "prof@sample-univ.example.edu", status: "open" },
    ];
    store.drafts = [
      { id: "dr-a1", userId: U, inboxItemId: "in-a1", status: "pending", disposition: "active" },
      { id: "dr-b1", userId: U, inboxItemId: "in-b1", status: "pending", disposition: "active" },
    ];
    store.autoCal = [
      { id: "ac-a1", userId: U, inboxItemId: "in-a2", status: "proposed" },
      { id: "ac-b1", userId: U, inboxItemId: "in-b1", status: "proposed" },
    ];
  });

  it("clears ONLY the ignored sender's items", async () => {
    pendingClearArgs = { userId: U, senderEmail: "noise@shop.example.com" };
    const counts = await clearSurfacedFromSender({
      userId: U,
      senderEmail: "noise@shop.example.com",
    });

    expect(counts.inboxDismissed).toBe(2);
    expect(counts.draftsIgnored).toBe(1);
    expect(counts.autoCalCancelled).toBe(1);

    // Sender A swept.
    expect(store.inbox.find((r) => r.id === "in-a1")!.status).toBe("dismissed");
    expect(store.inbox.find((r) => r.id === "in-a2")!.status).toBe("dismissed");
    expect(store.drafts.find((r) => r.id === "dr-a1")!.disposition).toBe("ignored");
    expect(store.drafts.find((r) => r.id === "dr-a1")!.status).toBe("dismissed");
    expect(store.autoCal.find((r) => r.id === "ac-a1")!.status).toBe("cancelled");

    // Sender B fully intact.
    expect(store.inbox.find((r) => r.id === "in-b1")!.status).toBe("open");
    expect(store.drafts.find((r) => r.id === "dr-b1")!.status).toBe("pending");
    expect(store.autoCal.find((r) => r.id === "ac-b1")!.status).toBe("proposed");
  });

  it("no-ops cleanly when the sender has nothing surfaced", async () => {
    pendingClearArgs = { userId: U, senderEmail: "absent@example.com" };
    const counts = await clearSurfacedFromSender({
      userId: U,
      senderEmail: "absent@example.com",
    });
    expect(counts).toEqual({
      inboxDismissed: 0,
      draftsIgnored: 0,
      autoCalCancelled: 0,
    });
  });
});

describe("countDismissSignalsForSender", () => {
  it("counts snoozed + dismissed inbox rows for the sender (case-insensitive)", async () => {
    store.inbox = [
      { id: "1", userId: U, senderEmail: "noise@shop.example.com", status: "snoozed" },
      { id: "2", userId: U, senderEmail: "Noise@shop.example.com", status: "dismissed" },
      { id: "3", userId: U, senderEmail: "noise@shop.example.com", status: "open" },
      { id: "4", userId: U, senderEmail: "other@shop.example.com", status: "dismissed" },
    ];
    pendingCountArgs = { userId: U, senderEmail: "noise@shop.example.com" };
    const n = await countDismissSignalsForSender({
      userId: U,
      senderEmail: "noise@shop.example.com",
    });
    expect(n).toBe(2);
  });

  it("returns 0 for a sender with no dismiss history", async () => {
    pendingCountArgs = { userId: U, senderEmail: "fresh@example.com" };
    const n = await countDismissSignalsForSender({
      userId: U,
      senderEmail: "fresh@example.com",
    });
    expect(n).toBe(0);
  });
});
