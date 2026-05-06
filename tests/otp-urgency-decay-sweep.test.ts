import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-33 — urgency-decay sweep. We mock the DB client so the
// helper's select → update → audit-insert chain is exercised
// end-to-end without touching Postgres.

vi.mock("server-only", () => ({}));

type Row = {
  id: string;
  userId: string;
  autoArchived: boolean;
  urgencyExpiresAt: Date | null;
  deletedAt: Date | null;
  bucket: string;
  riskTier: string | null;
  status: string;
};

type AuditRow = {
  userId: string;
  action: string;
  resourceId: string | null;
  detail: Record<string, unknown> | null;
};

const inboxStore = new Map<string, Row>();
const auditStore: AuditRow[] = [];

let lastUpdateValue: Record<string, unknown> | null = null;

const mockDb = {
  select(_shape: unknown) {
    void _shape;
    return {
      from(_table: unknown) {
        void _table;
        return {
          where(_predicate: unknown) {
            void _predicate;
            // The sweep filter: userId match + autoArchived=false +
            // urgency_expires_at < now(). We re-implement the predicate
            // here by reading the mock store. Caller passes the userId
            // through a closure-captured variable below.
            const now = Date.now();
            const matches = [...inboxStore.values()]
              .filter(
                (r) =>
                  r.userId === currentSweepUserId &&
                  r.autoArchived === false &&
                  r.deletedAt === null &&
                  r.urgencyExpiresAt !== null &&
                  r.urgencyExpiresAt.getTime() < now
              )
              .map((r) => ({ id: r.id }));
            return Promise.resolve(matches);
          },
        };
      },
    };
  },
  update(_table: unknown) {
    void _table;
    return {
      set(value: Record<string, unknown>) {
        lastUpdateValue = value;
        return {
          where(_predicate: unknown) {
            void _predicate;
            // Apply to every row in inboxStore that's a candidate. The
            // real impl uses inArray(ids); we get the same effect by
            // applying to all matching rows (the select narrowed the set
            // already).
            const now = Date.now();
            for (const row of inboxStore.values()) {
              if (
                row.userId === currentSweepUserId &&
                row.autoArchived === false &&
                row.urgencyExpiresAt !== null &&
                row.urgencyExpiresAt.getTime() < now
              ) {
                Object.assign(row, value);
              }
            }
            return Promise.resolve(undefined);
          },
        };
      },
    };
  },
  insert(_table: unknown) {
    void _table;
    return {
      values(value: AuditRow) {
        auditStore.push(value);
        return Promise.resolve(undefined);
      },
    };
  },
};

let currentSweepUserId = "";

vi.mock("@/lib/db/client", () => ({ db: mockDb }));
vi.mock("@/lib/db/schema", () => ({
  inboxItems: {
    id: { _name: "id" },
    userId: { _name: "user_id" },
    autoArchived: { _name: "auto_archived" },
    deletedAt: { _name: "deleted_at" },
    urgencyExpiresAt: { _name: "urgency_expires_at" },
  },
  auditLog: { name: { _name: "audit_log" } },
}));

beforeEach(() => {
  inboxStore.clear();
  auditStore.length = 0;
  lastUpdateValue = null;
  currentSweepUserId = "";
});

describe("decayUrgentInboxItems", () => {
  it("returns 0 and writes nothing when no rows have expired", async () => {
    currentSweepUserId = "u1";
    inboxStore.set("a", {
      id: "a",
      userId: "u1",
      autoArchived: false,
      // 5 minutes in the future — still pending decay.
      urgencyExpiresAt: new Date(Date.now() + 5 * 60 * 1000),
      deletedAt: null,
      bucket: "auto_high",
      riskTier: null,
      status: "open",
    });

    const { decayUrgentInboxItems } = await import(
      "@/lib/agent/email/urgency-decay"
    );
    const n = await decayUrgentInboxItems("u1");

    expect(n).toBe(0);
    expect(lastUpdateValue).toBeNull();
    expect(auditStore.length).toBe(0);
    // Row is unchanged.
    expect(inboxStore.get("a")?.autoArchived).toBe(false);
  });

  it("flips an expired row to auto_archived=true and writes an audit row", async () => {
    currentSweepUserId = "u1";
    inboxStore.set("a", {
      id: "a",
      userId: "u1",
      autoArchived: false,
      // 1 minute in the past — past expiry.
      urgencyExpiresAt: new Date(Date.now() - 60 * 1000),
      deletedAt: null,
      bucket: "auto_high",
      riskTier: null,
      status: "open",
    });

    const { decayUrgentInboxItems } = await import(
      "@/lib/agent/email/urgency-decay"
    );
    const n = await decayUrgentInboxItems("u1");

    expect(n).toBe(1);
    expect(inboxStore.get("a")?.autoArchived).toBe(true);
    expect(inboxStore.get("a")?.bucket).toBe("auto_low");
    expect(inboxStore.get("a")?.riskTier).toBe("low");
    expect(inboxStore.get("a")?.status).toBe("archived");
    expect(auditStore).toHaveLength(1);
    expect(auditStore[0]?.action).toBe("auto_archive");
    expect(auditStore[0]?.resourceId).toBe("a");
    expect(auditStore[0]?.detail?.reason).toBe("urgency_decay");
  });

  it("writes one audit row per expired item", async () => {
    currentSweepUserId = "u1";
    const past = new Date(Date.now() - 60 * 1000);
    for (const id of ["a", "b", "c"]) {
      inboxStore.set(id, {
        id,
        userId: "u1",
        autoArchived: false,
        urgencyExpiresAt: past,
        deletedAt: null,
        bucket: "auto_high",
        riskTier: null,
        status: "open",
      });
    }

    const { decayUrgentInboxItems } = await import(
      "@/lib/agent/email/urgency-decay"
    );
    const n = await decayUrgentInboxItems("u1");

    expect(n).toBe(3);
    expect(auditStore).toHaveLength(3);
    expect(auditStore.map((r) => r.resourceId).sort()).toEqual([
      "a",
      "b",
      "c",
    ]);
    for (const r of auditStore) {
      expect(r.detail?.reason).toBe("urgency_decay");
    }
  });

  it("skips rows that are already auto_archived (idempotent on re-run)", async () => {
    currentSweepUserId = "u1";
    inboxStore.set("a", {
      id: "a",
      userId: "u1",
      // Already archived on a prior tick — sweep must not re-write or
      // re-audit.
      autoArchived: true,
      urgencyExpiresAt: new Date(Date.now() - 60 * 1000),
      deletedAt: null,
      bucket: "auto_low",
      riskTier: "low",
      status: "archived",
    });

    const { decayUrgentInboxItems } = await import(
      "@/lib/agent/email/urgency-decay"
    );
    const n = await decayUrgentInboxItems("u1");

    expect(n).toBe(0);
    expect(auditStore.length).toBe(0);
  });
});
