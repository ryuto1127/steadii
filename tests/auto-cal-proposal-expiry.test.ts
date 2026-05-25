import { beforeEach, describe, expect, it, vi } from "vitest";

// Env stub — needed by lib/db/client.ts import chain.
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

// Hoisted mock state so the vi.mock factory below can close over it
// without TDZ issues.
const mocks = vi.hoisted(() => {
  type Row = {
    id: string;
    status: "proposed" | "provisional" | "confirmed" | "cancelled";
    graceExpiresAt: Date;
  };
  return {
    state: {
      rows: [] as Row[],
      updates: [] as Array<{ id: string; status: string }>,
    },
  };
});

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
      select: () => chain(filterExpiredProposed(mocks.state.rows)),
      update: () => ({
        set: (vals: { status: string }) => ({
          where: async () => {
            // We can't observe the per-id WHERE in this thin mock, but
            // the production code issues one UPDATE per row in a loop;
            // counting set() calls is enough to verify the sweep's
            // intent. `id` is stamped as a placeholder.
            mocks.state.updates.push({ id: "*", status: vals.status });
          },
        }),
      }),
    },
  };
});

import { runAutoCalProposalExpirySweep } from "@/lib/agent/proactive/auto-cal-proposal-expiry";

const NOW_MS = Date.UTC(2026, 4, 24, 12, 0, 0); // 2026-05-24 12:00 UTC

function filterExpiredProposed(rows: typeof mocks.state.rows) {
  // Mimic the production WHERE clause: status='proposed' AND
  // grace_expires_at < now. Mock returns matching rows; .limit() is
  // a no-op which is fine — tests assert at small N.
  return rows.filter(
    (r) => r.status === "proposed" && r.graceExpiresAt.getTime() < NOW_MS,
  );
}

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.updates = [];
});

describe("runAutoCalProposalExpirySweep — happy path", () => {
  it("flips expired 'proposed' rows to 'cancelled' and reports counts", async () => {
    mocks.state.rows = [
      {
        id: "r1",
        status: "proposed",
        graceExpiresAt: new Date(NOW_MS - 60 * 1000), // 1 min ago
      },
      {
        id: "r2",
        status: "proposed",
        graceExpiresAt: new Date(NOW_MS - 24 * 60 * 60 * 1000), // 1 day ago
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(2);
    expect(result.cancelled).toBe(2);
    expect(mocks.state.updates).toHaveLength(2);
    expect(mocks.state.updates.every((u) => u.status === "cancelled")).toBe(
      true,
    );
  });

  it("returns scanned=0 when no expired proposals exist", async () => {
    mocks.state.rows = [
      {
        id: "r-fresh",
        status: "proposed",
        graceExpiresAt: new Date(NOW_MS + 24 * 60 * 60 * 1000), // 1 day from now
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("does NOT touch 'provisional', 'confirmed', or 'cancelled' rows even when expired", async () => {
    mocks.state.rows = [
      {
        id: "r-prov",
        status: "provisional",
        graceExpiresAt: new Date(NOW_MS - 60 * 1000),
      },
      {
        id: "r-conf",
        status: "confirmed",
        graceExpiresAt: new Date(NOW_MS - 60 * 1000),
      },
      {
        id: "r-canc",
        status: "cancelled",
        graceExpiresAt: new Date(NOW_MS - 60 * 1000),
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
  });
});
