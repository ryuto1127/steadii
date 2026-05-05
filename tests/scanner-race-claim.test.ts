import { beforeEach, describe, expect, it, vi } from "vitest";

// Tests for the polish-13b race-condition fix in the proactive scanner.
// The in-memory 5-minute debounce was replaced by a DB-level claim using
// a partial unique index on agent_events (user_id) WHERE status='running'.
// These tests prove the orchestration:
//   - When the claim insert returns no row (simulating the partial
//     index conflict), runScanner returns { ran: false, reason:
//     'concurrent' } and does NOT run the snapshot / rule pipeline.
//   - When two concurrent triggers race, exactly one wins.
//   - When a recent 'analyzed' row exists, runScanner returns
//     { ran: false, reason: 'debounced' } and skips the claim entirely.
//   - cron.daily bypasses the debounce check.

vi.mock("server-only", () => ({}));

// Per-test-controllable behavior. `insertResults` is a queue: each
// successive INSERT pops one entry; `null` simulates the partial unique
// index rejection (no row returned). `recentExists` controls whether
// the 5-min debounce SELECT finds a hit.
const fixture = {
  recentExists: false,
  insertResults: [] as Array<{ id: string } | null>,
};
const calls: string[] = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: async () => {
          calls.push("update");
          return undefined;
        },
      }),
    }),
    select: () => ({
      from: () => ({
        // The .where() chain end is dual-shape:
        //   * findRecentCompletedScan → calls .limit(1) on top of .where()
        //   * autoResolveAbsentPending → awaits .where() directly (no limit)
        // To support both, .where() returns an awaitable that resolves to
        // [] (= no pending proposals to auto-resolve in these tests) and
        // also exposes .limit() for the recency debounce path.
        where: () => {
          const promise = Promise.resolve([] as Array<Record<string, unknown>>);
          return {
            limit: async () => {
              calls.push("select");
              return fixture.recentExists ? [{ id: "recent-scan" }] : [];
            },
            then: promise.then.bind(promise),
            catch: promise.catch.bind(promise),
            finally: promise.finally.bind(promise),
          };
        },
      }),
    }),
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            calls.push("insert.claim");
            const next = fixture.insertResults.shift();
            return next ? [next] : [];
          },
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agentEvents: {
    id: {},
    userId: {},
    status: {},
    analyzedAt: {},
    createdAt: {},
  },
  agentProposals: {
    id: {},
    userId: {},
    dedupKey: {},
    status: {},
    issueType: {},
  },
}));

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  gte: () => ({}),
  inArray: () => ({}),
  lt: () => ({}),
  sql: Object.assign(
    (strings: TemplateStringsArray) => strings.join(""),
    { raw: () => ({}) }
  ),
}));

const snapshotMock = vi.fn();
vi.mock("@/lib/agent/proactive/snapshot", () => ({
  buildUserSnapshot: () => snapshotMock(),
}));

vi.mock("@/lib/agent/proactive/rules", () => ({
  ALL_RULES: [],
}));

vi.mock("@/lib/agent/proactive/dedup", () => ({
  buildDedupKey: () => "test-key",
}));

vi.mock("@/lib/agent/proactive/proposal-generator", () => ({
  generateProposalActions: vi.fn(),
  shouldGenerateActionsFor: () => false,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

beforeEach(() => {
  fixture.recentExists = false;
  fixture.insertResults = [];
  calls.length = 0;
  snapshotMock.mockReset();
  snapshotMock.mockResolvedValue({});
});

describe("runScanner — concurrent-claim arbitration", () => {
  it("returns 'concurrent' when the partial unique index rejects the claim", async () => {
    // INSERT returns [] (rejected by partial unique index).
    fixture.insertResults = [null];
    const { runScanner } = await import("@/lib/agent/proactive/scanner");
    const result = await runScanner("user-1", {
      source: "calendar.created",
    });
    expect(result).toMatchObject({ ran: false, reason: "concurrent" });
    // Snapshot must NOT have been built — the loser short-circuits
    // before any LLM-adjacent work.
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it("two simultaneous triggers for the same user produce exactly one scan", async () => {
    // First INSERT wins, second is rejected (simulates the partial
    // unique index — only one running row per user).
    fixture.insertResults = [{ id: "winner" }, null];
    const { runScanner } = await import("@/lib/agent/proactive/scanner");

    const [r1, r2] = await Promise.all([
      runScanner("user-1", { source: "calendar.created" }),
      runScanner("user-1", { source: "syllabus.uploaded" }),
    ]);

    const winners = [r1, r2].filter((r) => r.ran);
    const losers = [r1, r2].filter((r) => !r.ran);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0].reason).toBe("concurrent");
    // Snapshot built only for the winner.
    expect(snapshotMock).toHaveBeenCalledTimes(1);
  });
});

describe("runScanner — recency debounce", () => {
  it("returns 'debounced' when a recent completed scan exists (non-cron)", async () => {
    fixture.recentExists = true;
    const { runScanner } = await import("@/lib/agent/proactive/scanner");
    const result = await runScanner("user-1", {
      source: "calendar.created",
    });
    expect(result).toMatchObject({ ran: false, reason: "debounced" });
    // No claim attempted when debounced — the SELECT short-circuits the
    // INSERT entirely so we don't waste an event row on a no-op trigger.
    expect(calls.filter((c) => c === "insert.claim")).toHaveLength(0);
    expect(snapshotMock).not.toHaveBeenCalled();
  });

  it("cron.daily bypasses recency debounce", async () => {
    fixture.recentExists = true;
    fixture.insertResults = [{ id: "cron-claim" }];
    const { runScanner } = await import("@/lib/agent/proactive/scanner");
    const result = await runScanner("user-1", { source: "cron.daily" });
    expect(result.ran).toBe(true);
    // Daily cron's job is to be the catch-all, so it skips the SELECT
    // and proceeds straight to claim.
    expect(calls.filter((c) => c === "insert.claim")).toHaveLength(1);
  });
});
