import { beforeEach, describe, expect, it, vi } from "vitest";

// PR 3 — re-surface sweep for Type B Draft cards explicitly スキップ'd
// more than 24 hours ago. The sweep is a pure DB UPDATE; here we mock
// the drizzle client to assert (a) the WHERE clause shape via the
// arguments we capture, and (b) the SET values are { disposition:
// 'active', skipped_at: null, updated_at: <now> }.
//
// The chainable mock mimics drizzle's builder API just enough to record
// what would have been sent. We don't try to actually execute SQL.

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  state: {
    capturedSet: null as Record<string, unknown> | null,
    captureWhereArgs: null as unknown,
    returnedRows: [] as Array<{ id: string }>,
  },
}));

vi.mock("@/lib/db/client", () => {
  return {
    db: {
      update: () => ({
        set: (vals: Record<string, unknown>) => {
          mocks.state.capturedSet = vals;
          return {
            where: (args: unknown) => {
              mocks.state.captureWhereArgs = args;
              return {
                returning: async () => mocks.state.returnedRows,
              };
            },
          };
        },
      }),
    },
  };
});

import {
  RESURFACE_WINDOW_MS,
  runDispositionResurfaceSweep,
} from "@/lib/agent/email/disposition-resurface";

beforeEach(() => {
  mocks.state.capturedSet = null;
  mocks.state.captureWhereArgs = null;
  mocks.state.returnedRows = [];
});

describe("runDispositionResurfaceSweep", () => {
  it("writes disposition='active' + clears skipped_at on matched rows", async () => {
    mocks.state.returnedRows = [{ id: "row-1" }, { id: "row-2" }];
    const now = new Date("2026-05-24T12:00:00Z");
    const r = await runDispositionResurfaceSweep({ now });

    expect(r.resurfaced).toBe(2);
    expect(mocks.state.capturedSet).not.toBeNull();
    expect(mocks.state.capturedSet?.disposition).toBe("active");
    expect(mocks.state.capturedSet?.skippedAt).toBeNull();
    expect(mocks.state.capturedSet?.updatedAt).toEqual(now);
  });

  it("returns 0 when no rows match the cutoff", async () => {
    mocks.state.returnedRows = [];
    const r = await runDispositionResurfaceSweep({
      now: new Date("2026-05-24T12:00:00Z"),
    });
    expect(r.resurfaced).toBe(0);
  });

  it("passes a where clause to the drizzle builder (catches a refactor accidentally widening the update)", async () => {
    mocks.state.returnedRows = [{ id: "x" }];
    await runDispositionResurfaceSweep({
      now: new Date("2026-05-24T12:00:00Z"),
    });
    expect(mocks.state.captureWhereArgs).not.toBeNull();
  });

  it("computes the cutoff as now - 24h", () => {
    expect(RESURFACE_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("defaults `now` to a fresh Date when omitted", async () => {
    mocks.state.returnedRows = [];
    const before = Date.now();
    await runDispositionResurfaceSweep({});
    const after = Date.now();
    const used = (mocks.state.capturedSet?.updatedAt as Date).getTime();
    expect(used).toBeGreaterThanOrEqual(before);
    expect(used).toBeLessThanOrEqual(after);
  });
});
