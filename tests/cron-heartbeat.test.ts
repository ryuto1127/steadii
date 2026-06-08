import { beforeEach, describe, expect, it, vi } from "vitest";

// Wave 5 — cron heartbeat: insertion + missed-tick detection.
// We mock the DB client so the helper's upsert/select shape is
// exercised end-to-end without touching Postgres.

vi.mock("server-only", () => ({}));

type StoredRow = {
  name: string;
  lastTickAt: Date;
  lastStatus: "ok" | "error";
  lastDurationMs: number | null;
  lastError: string | null;
  updatedAt: Date;
};

const store = new Map<string, StoredRow>();

const mockDb = {
  insert(_table: unknown) {
    void _table;
    return {
      values(value: StoredRow) {
        return {
          onConflictDoUpdate(args: { set: Partial<StoredRow> }) {
            const existing = store.get(value.name);
            const merged = {
              ...value,
              ...args.set,
            } as StoredRow;
            store.set(value.name, merged);
            void existing;
            return Promise.resolve(undefined);
          },
        };
      },
    };
  },
  select(_shape: unknown) {
    void _shape;
    return {
      from(_table: unknown) {
        void _table;
        return Promise.resolve(
          [...store.values()].map((r) => ({
            name: r.name,
            lastTickAt: r.lastTickAt,
            lastStatus: r.lastStatus,
            lastDurationMs: r.lastDurationMs,
          }))
        );
      },
    };
  },
};

vi.mock("@/lib/db/client", () => ({ db: mockDb }));
vi.mock("@/lib/db/schema", () => ({
  cronHeartbeats: { name: { _name: "name" } },
}));

beforeEach(() => {
  store.clear();
});

describe("recordHeartbeat", () => {
  it("upserts a row on success", async () => {
    const { recordHeartbeat } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    await recordHeartbeat("digest", { durationMs: 1234, status: "ok" });
    const row = store.get("digest");
    expect(row).toBeTruthy();
    expect(row?.lastStatus).toBe("ok");
    expect(row?.lastDurationMs).toBe(1234);
  });

  it("captures error message when status is 'error'", async () => {
    const { recordHeartbeat } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    await recordHeartbeat("scanner", {
      durationMs: 50,
      status: "error",
      error: "boom",
    });
    const row = store.get("scanner");
    expect(row?.lastStatus).toBe("error");
    expect(row?.lastError).toBe("boom");
  });
});

describe("withHeartbeat wrapper", () => {
  it("stamps ok on success and returns the inner value", async () => {
    const { withHeartbeat } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    const result = await withHeartbeat("ingest-sweep", async () => 42);
    expect(result).toBe(42);
    expect(store.get("ingest-sweep")?.lastStatus).toBe("ok");
  });

  it("stamps error and re-throws when the inner throws", async () => {
    const { withHeartbeat } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    await expect(
      withHeartbeat("master-sweep", async () => {
        throw new Error("bad");
      })
    ).rejects.toThrow("bad");
    expect(store.get("master-sweep")?.lastStatus).toBe("error");
    expect(store.get("master-sweep")?.lastError).toBe("bad");
  });
});

describe("readCronHealth", () => {
  it("returns a row per known cron, marking missing rows stale", async () => {
    const { readCronHealth, CRON_EXPECTED_INTERVAL_MS } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    const rows = await readCronHealth();
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual(Object.keys(CRON_EXPECTED_INTERVAL_MS).sort());
    for (const r of rows) {
      expect(r.stale).toBe(true);
      expect(r.lastTickAt).toBeNull();
    }
  });

  it("marks fresh ticks as not-stale", async () => {
    const { recordHeartbeat, readCronHealth } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    await recordHeartbeat("master-sweep", { durationMs: 100, status: "ok" });
    const rows = await readCronHealth();
    const masterSweep = rows.find((r) => r.name === "master-sweep");
    expect(masterSweep?.stale).toBe(false);
  });

  it("marks ancient ticks as stale", async () => {
    const { readCronHealth } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    // Plant an ancient row directly so the helper's age math runs.
    store.set("master-sweep", {
      name: "master-sweep",
      lastTickAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      lastStatus: "ok",
      lastDurationMs: 100,
      lastError: null,
      updatedAt: new Date(),
    });
    const rows = await readCronHealth();
    const masterSweep = rows.find((r) => r.name === "master-sweep");
    expect(masterSweep?.stale).toBe(true);
  });
});

describe("consolidated-cron expectations (PR #305 + send-queue removal)", () => {
  it("does not expect independent heartbeats from consolidated/removed crons", async () => {
    const { CRON_EXPECTED_INTERVAL_MS } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    // These no longer own a live QStash schedule, so a frozen heartbeat
    // for them must NOT trip the health check.
    for (const dead of [
      "digest",
      "weekly-digest",
      "pre-brief",
      "ingest-sweep",
      "send-queue",
    ]) {
      expect(CRON_EXPECTED_INTERVAL_MS).not.toHaveProperty(dead);
    }
    // master-sweep is the liveness signal that replaces them.
    expect(CRON_EXPECTED_INTERVAL_MS).toHaveProperty("master-sweep");
  });

  it("a frozen digest/send-queue heartbeat does not make health degraded", async () => {
    const { recordHeartbeat, readCronHealth, CRON_EXPECTED_INTERVAL_MS } =
      await import("@/lib/observability/cron-heartbeat");
    // Every still-scheduled cron ticked just now → all fresh.
    for (const name of Object.keys(CRON_EXPECTED_INTERVAL_MS)) {
      await recordHeartbeat(name, { durationMs: 10, status: "ok" });
    }
    // Plant ancient rows for the consolidated/removed crons, exactly as
    // production currently looks (frozen since the 2026-05 cutover).
    for (const dead of ["digest", "send-queue", "pre-brief"]) {
      store.set(dead, {
        name: dead,
        lastTickAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        lastStatus: "ok",
        lastDurationMs: 10,
        lastError: null,
        updatedAt: new Date(),
      });
    }
    const rows = await readCronHealth();
    // readCronHealth only reports the expected set, so the frozen dead
    // rows are simply ignored — nothing stale, nothing failing.
    const stale = rows.filter((r) => r.stale).map((r) => r.name);
    const failing = rows
      .filter((r) => r.lastStatus === "error")
      .map((r) => r.name);
    expect(stale).toEqual([]);
    expect(failing).toEqual([]);
    // Mirror the /api/health status computation.
    const status =
      stale.length === 0 && failing.length === 0 ? "ok" : "degraded";
    expect(status).toBe("ok");
  });

  it("still trips degraded when master-sweep itself goes stale", async () => {
    const { recordHeartbeat, readCronHealth, CRON_EXPECTED_INTERVAL_MS } =
      await import("@/lib/observability/cron-heartbeat");
    // Everything fresh except master-sweep, which stopped ticking — the
    // real-outage signal we must NOT blunt.
    for (const name of Object.keys(CRON_EXPECTED_INTERVAL_MS)) {
      if (name === "master-sweep") continue;
      await recordHeartbeat(name, { durationMs: 10, status: "ok" });
    }
    store.set("master-sweep", {
      name: "master-sweep",
      lastTickAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      lastStatus: "ok",
      lastDurationMs: 10,
      lastError: null,
      updatedAt: new Date(),
    });
    const rows = await readCronHealth();
    const stale = rows.filter((r) => r.stale).map((r) => r.name);
    expect(stale).toContain("master-sweep");
  });
});
