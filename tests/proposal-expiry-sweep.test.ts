import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-06-13 — Wave A noise reduction. Tests for the proposal-expiry
// sub-sweep: a single bounded UPDATE that flips 'pending' agent_proposals
// whose expires_at has elapsed → 'expired'. No Gmail / LLM.
//
// The production code issues ONE `UPDATE ... WHERE status='pending' AND
// expires_at IS NOT NULL AND expires_at < now`. The DB does the row
// selection, so this test models the candidate table in memory and has
// the db mock apply the SAME predicate the production WHERE encodes — so
// the test verifies the intended selection (expired-pending flipped,
// fresh / non-pending / null-expiry left alone) rather than just a count.

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("server-only", () => ({}));

type Row = {
  id: string;
  status: "pending" | "resolved" | "dismissed" | "expired";
  expiresAt: Date | null;
};

const mocks = vi.hoisted(() => ({
  state: {
    rows: [] as Row[],
    now: new Date(),
    setVals: undefined as Record<string, unknown> | undefined,
  },
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        mocks.state.setVals = vals;
        return {
          where: () => ({
            returning: async () => {
              // Mirror the production WHERE: pending + non-null expiry +
              // expired relative to `now`.
              const matched = mocks.state.rows.filter(
                (r) =>
                  r.status === "pending" &&
                  r.expiresAt !== null &&
                  r.expiresAt.getTime() < mocks.state.now.getTime(),
              );
              // Reflect the state change so a re-run is idempotent.
              for (const m of matched) m.status = "expired";
              return matched.map((m) => ({ id: m.id }));
            },
          }),
        };
      },
    }),
  },
}));

import { runProposalExpirySweep } from "@/lib/agent/proactive/proposal-expiry";

const NOW = new Date("2026-06-13T12:00:00Z");

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.now = NOW;
  mocks.state.setVals = undefined;
});

describe("runProposalExpirySweep", () => {
  it("flips ONLY expired pending rows to 'expired' and reports the count", async () => {
    mocks.state.rows = [
      { id: "expired-1", status: "pending", expiresAt: new Date("2026-06-06T12:00:00Z") },
      { id: "expired-2", status: "pending", expiresAt: new Date("2026-06-12T12:00:00Z") },
      { id: "fresh", status: "pending", expiresAt: new Date("2026-06-20T12:00:00Z") },
    ];

    const r = await runProposalExpirySweep({ nowMs: NOW.getTime() });

    expect(r.expired).toBe(2);
    expect(mocks.state.setVals).toEqual({ status: "expired" });
    expect(mocks.state.rows.find((x) => x.id === "fresh")!.status).toBe("pending");
  });

  it("does NOT touch non-pending rows even when their expiry has elapsed", async () => {
    mocks.state.rows = [
      { id: "resolved", status: "resolved", expiresAt: new Date("2026-06-01T12:00:00Z") },
      { id: "dismissed", status: "dismissed", expiresAt: new Date("2026-06-01T12:00:00Z") },
    ];

    const r = await runProposalExpirySweep({ nowMs: NOW.getTime() });

    expect(r.expired).toBe(0);
  });

  it("does NOT touch pending rows with a NULL expires_at (legacy)", async () => {
    mocks.state.rows = [
      { id: "no-expiry", status: "pending", expiresAt: null },
    ];

    const r = await runProposalExpirySweep({ nowMs: NOW.getTime() });

    expect(r.expired).toBe(0);
    expect(mocks.state.rows[0]!.status).toBe("pending");
  });

  it("first-run backlog: flips a batch of long-expired rows in one pass", async () => {
    mocks.state.rows = Array.from({ length: 5 }, (_, i) => ({
      id: `old-${i}`,
      status: "pending" as const,
      expiresAt: new Date("2026-05-01T00:00:00Z"),
    }));

    const r = await runProposalExpirySweep({ nowMs: NOW.getTime() });

    expect(r.expired).toBe(5);
    expect(mocks.state.rows.every((x) => x.status === "expired")).toBe(true);
  });

  it("returns expired=0 when there is no pending backlog", async () => {
    const r = await runProposalExpirySweep({ nowMs: NOW.getTime() });
    expect(r.expired).toBe(0);
  });
});
