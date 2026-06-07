import { beforeEach, describe, expect, it, vi } from "vitest";

// Env stub — needed by lib/db/client.ts import chain.
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

// auto-cal-slot.ts is server-only — stub the marker so the sweep's import
// of isAutoCalProposalStale resolves in the test environment.
vi.mock("server-only", () => ({}));

import type { AutoCreatedAgreedSlot } from "@/lib/db/schema";

// Hoisted mock state so the vi.mock factory below can close over it
// without TDZ issues.
const mocks = vi.hoisted(() => {
  type Row = {
    id: string;
    status: "proposed" | "provisional" | "confirmed" | "cancelled";
    kind: "deadline" | "event" | "mutual_agreement";
    agreedSlot: {
      date: string;
      startTime: string;
      timezone: string;
      durationMin: number;
    };
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
      orderBy: () => c,
      limit: () => c,
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    return c;
  };

  return {
    db: {
      // The production SELECT now fetches ALL status='proposed' rows
      // (ordered by grace_expires_at ASC) and decides cancellation in
      // code, so the mock only filters on status — not on grace.
      select: () => chain(mocks.state.rows.filter((r) => r.status === "proposed")),
      update: () => ({
        set: (vals: { status: string }) => ({
          where: async () => {
            // We can't observe the per-id WHERE in this thin mock, but
            // the production code issues one UPDATE per cancelled row in a
            // loop; counting set() calls is enough to verify the sweep's
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

// A timed-event slot far in the future so grace-window behavior is tested
// in isolation from date-staleness (the slot itself is never stale).
function freshSlot(): AutoCreatedAgreedSlot {
  return {
    date: "2026-12-31",
    startTime: "09:00",
    timezone: "America/Vancouver",
    durationMin: 60,
  };
}

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.updates = [];
});

describe("runAutoCalProposalExpirySweep — grace-window expiry", () => {
  it("flips expired 'proposed' rows to 'cancelled' and reports counts", () => {
    return (async () => {
      mocks.state.rows = [
        {
          id: "r1",
          status: "proposed",
          kind: "event",
          agreedSlot: freshSlot(),
          graceExpiresAt: new Date(NOW_MS - 60 * 1000), // 1 min ago
        },
        {
          id: "r2",
          status: "proposed",
          kind: "event",
          agreedSlot: freshSlot(),
          graceExpiresAt: new Date(NOW_MS - 24 * 60 * 60 * 1000), // 1 day ago
        },
      ];

      const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

      // Both rows are scanned; both are cancelled.
      expect(result.scanned).toBe(2);
      expect(result.cancelled).toBe(2);
      expect(mocks.state.updates).toHaveLength(2);
      expect(mocks.state.updates.every((u) => u.status === "cancelled")).toBe(
        true,
      );
    })();
  });

  it("scans but does NOT cancel a fresh proposal (grace not elapsed, date not stale)", async () => {
    mocks.state.rows = [
      {
        id: "r-fresh",
        status: "proposed",
        kind: "event",
        agreedSlot: freshSlot(),
        graceExpiresAt: new Date(NOW_MS + 24 * 60 * 60 * 1000), // 1 day from now
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("does NOT touch 'provisional', 'confirmed', or 'cancelled' rows even when expired", async () => {
    mocks.state.rows = [
      {
        id: "r-prov",
        status: "provisional",
        kind: "event",
        agreedSlot: freshSlot(),
        graceExpiresAt: new Date(NOW_MS - 60 * 1000),
      },
      {
        id: "r-conf",
        status: "confirmed",
        kind: "event",
        agreedSlot: freshSlot(),
        graceExpiresAt: new Date(NOW_MS - 60 * 1000),
      },
      {
        id: "r-canc",
        status: "cancelled",
        kind: "event",
        agreedSlot: freshSlot(),
        graceExpiresAt: new Date(NOW_MS - 60 * 1000),
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(0);
    expect(result.cancelled).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
  });
});

describe("runAutoCalProposalExpirySweep — date-staleness expiry", () => {
  it("cancels a date-stale deadline whose 7d grace has NOT yet elapsed", async () => {
    // Deadline due 2026-05-23 (yesterday relative to NOW_MS's tz day) but
    // grace_expires_at is still 6 days out. Pre-fix this would linger the
    // full grace window; now it's cancelled immediately.
    mocks.state.rows = [
      {
        id: "r-stale-deadline",
        status: "proposed",
        kind: "deadline",
        agreedSlot: {
          date: "2026-05-23",
          startTime: "00:00",
          timezone: "America/Vancouver",
          durationMin: 0,
        },
        graceExpiresAt: new Date(NOW_MS + 6 * 24 * 60 * 60 * 1000),
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(1);
    expect(result.cancelled).toBe(1);
    expect(mocks.state.updates).toHaveLength(1);
    expect(mocks.state.updates[0].status).toBe("cancelled");
  });

  it("cancels a date-stale timed event (already ended) with grace not elapsed", async () => {
    // Event 2026-05-24 08:00–09:00 PT = 15:00–16:00 UTC. NOW_MS is 12:00
    // UTC... that's BEFORE the event, so use an earlier event time.
    mocks.state.rows = [
      {
        id: "r-stale-event",
        status: "proposed",
        kind: "event",
        agreedSlot: {
          date: "2026-05-24",
          startTime: "00:00", // 00:00 PT = 07:00 UTC, ends 08:00 UTC
          timezone: "America/Vancouver",
          durationMin: 60,
        },
        graceExpiresAt: new Date(NOW_MS + 6 * 24 * 60 * 60 * 1000),
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(1);
    expect(result.cancelled).toBe(1);
  });

  it("does NOT cancel a deadline due TODAY (in its tz) even past noon UTC", async () => {
    // Deadline due 2026-05-24; NOW_MS = 2026-05-24 12:00 UTC = 05:00 PT,
    // still the 24th in Vancouver → not stale, grace not elapsed.
    mocks.state.rows = [
      {
        id: "r-today",
        status: "proposed",
        kind: "deadline",
        agreedSlot: {
          date: "2026-05-24",
          startTime: "00:00",
          timezone: "America/Vancouver",
          durationMin: 0,
        },
        graceExpiresAt: new Date(NOW_MS + 6 * 24 * 60 * 60 * 1000),
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(1);
    expect(result.cancelled).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("cancels grace-expired AND date-stale rows together, leaves fresh ones", async () => {
    mocks.state.rows = [
      {
        id: "r-grace-expired",
        status: "proposed",
        kind: "event",
        agreedSlot: freshSlot(),
        graceExpiresAt: new Date(NOW_MS - 60 * 1000),
      },
      {
        id: "r-date-stale",
        status: "proposed",
        kind: "deadline",
        agreedSlot: {
          date: "2026-05-20",
          startTime: "00:00",
          timezone: "America/Vancouver",
          durationMin: 0,
        },
        graceExpiresAt: new Date(NOW_MS + 5 * 24 * 60 * 60 * 1000),
      },
      {
        id: "r-fresh",
        status: "proposed",
        kind: "event",
        agreedSlot: freshSlot(),
        graceExpiresAt: new Date(NOW_MS + 5 * 24 * 60 * 60 * 1000),
      },
    ];

    const result = await runAutoCalProposalExpirySweep({ nowMs: NOW_MS });

    expect(result.scanned).toBe(3);
    expect(result.cancelled).toBe(2);
    expect(mocks.state.updates).toHaveLength(2);
  });
});
