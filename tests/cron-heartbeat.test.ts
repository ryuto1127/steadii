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
      withHeartbeat("send-queue", async () => {
        throw new Error("bad");
      })
    ).rejects.toThrow("bad");
    expect(store.get("send-queue")?.lastStatus).toBe("error");
    expect(store.get("send-queue")?.lastError).toBe("bad");
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
    await recordHeartbeat("digest", { durationMs: 100, status: "ok" });
    const rows = await readCronHealth();
    const digest = rows.find((r) => r.name === "digest");
    expect(digest?.stale).toBe(false);
  });

  it("marks ancient ticks as stale", async () => {
    const { readCronHealth } = await import(
      "@/lib/observability/cron-heartbeat"
    );
    // Plant an ancient row directly so the helper's age math runs.
    store.set("digest", {
      name: "digest",
      lastTickAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
      lastStatus: "ok",
      lastDurationMs: 100,
      lastError: null,
      updatedAt: new Date(),
    });
    const rows = await readCronHealth();
    const digest = rows.find((r) => r.name === "digest");
    expect(digest?.stale).toBe(true);
  });
});
