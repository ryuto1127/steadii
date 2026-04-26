import { beforeEach, describe, expect, it, vi } from "vitest";

// Verify computeAgentMetrics aggregates the SQL output the way the admin
// page expects: rates are computed off the reviewable subset (action ∈
// {draft_reply, ask_clarifying}), distributions sort by count desc, and
// percentages add up to ~100% (mod rounding).

type Row = Record<string, unknown>;

// Each call to db.select(...).from(...).where(...) returns the next
// prepared payload from this queue. Order matters and matches the
// order in computeAgentMetrics. computeAgentMetrics has two query
// shapes: `.where().groupBy()` (group queries) and `.where()` (count
// queries that await directly), so the mock returns a thenable with
// `.groupBy` attached — both terminals resolve to the same row.
const responses: Row[][] = [];

vi.mock("@/lib/db/client", () => {
  const mock = {
    select: () => ({
      from: () => ({
        where: () => {
          const next = responses.shift() ?? [];
          const thenable = Promise.resolve(next);
          (thenable as unknown as { groupBy: () => Promise<Row[]> }).groupBy =
            () => Promise.resolve(next);
          return thenable;
        },
      }),
    }),
  };
  return { db: mock };
});

vi.mock("@/lib/db/schema", () => ({
  agentDrafts: {
    id: {},
    userId: {},
    createdAt: {},
    action: {},
    status: {},
    riskTier: {},
    retrievalProvenance: {},
  },
  inboxItems: {
    id: {},
    userId: {},
    receivedAt: {},
    deletedAt: {},
    bucket: {},
    riskTier: {},
  },
}));

vi.mock("drizzle-orm", () => ({
  and: () => ({}),
  eq: () => ({}),
  gte: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
  desc: () => ({}),
  sql: Object.assign(
    (..._args: unknown[]) => ({}),
    {
      raw: (s: string) => s,
    }
  ),
}));

vi.mock("server-only", () => ({}));

beforeEach(() => {
  responses.length = 0;
});

describe("computeAgentMetrics", () => {
  it("computes rates off reviewable drafts only, not the no_op denominator", async () => {
    // Order: bucket, riskTier, action, status, reviewableTotal,
    // reviewableEdited, reviewableDismissed, reviewableSent, retrieval.
    responses.push(
      // bucket distribution
      [
        { bucket: "ignore", count: 5 },
        { bucket: "auto_high", count: 2 },
        { bucket: "auto_medium", count: 3 },
      ],
      // risk tier distribution
      [{ tier: "medium", count: 3 }, { tier: "high", count: 2 }],
      // action distribution
      [
        { action: "no_op", count: 7 },
        { action: "draft_reply", count: 4 },
        { action: "ask_clarifying", count: 1 },
      ],
      // status distribution
      [
        { status: "pending", count: 8 },
        { status: "edited", count: 1 },
        { status: "dismissed", count: 0 },
        { status: "sent", count: 3 },
      ],
      // reviewable total (where action IN reviewable) — 4 + 1 = 5
      [{ n: 5 }],
      // reviewable edited
      [{ n: 1 }],
      // reviewable dismissed
      [{ n: 0 }],
      // reviewable sent (sent + sent_pending + approved)
      [{ n: 3 }],
      // retrieval rows (high-risk only)
      [],
      // all-provenance rows (Phase 7 W1 fanout aggregates)
      []
    );

    const { computeAgentMetrics } = await import(
      "@/lib/agent/dogfood/metrics"
    );
    const m = await computeAgentMetrics({ days: 7 });

    expect(m.windowDays).toBe(7);
    expect(m.totalInbox).toBe(10);
    expect(m.totalDrafts).toBe(12);

    expect(m.reviewableDrafts).toBe(5);
    expect(m.editRatePct).toBeCloseTo(20.0, 1); // 1/5
    expect(m.dismissRatePct).toBe(0);
    expect(m.sendRatePct).toBeCloseTo(60.0, 1); // 3/5

    // Bucket distribution sorted by count desc.
    expect(m.bucketCounts[0]?.bucket).toBe("ignore");
    expect(m.bucketCounts[0]?.pct).toBeCloseTo(50.0, 1);

    // L2 referral pct — no l2_pending rows in this fixture so it's 0.
    expect(m.l2ReferralPct).toBe(0);
  });

  it("returns zero rates and no NaNs when no drafts exist", async () => {
    responses.push(
      [], // bucket
      [], // risk tier
      [], // action
      [], // status
      [{ n: 0 }], // reviewable total
      [{ n: 0 }], // edited
      [{ n: 0 }], // dismissed
      [{ n: 0 }], // sent
      [], // retrieval (high-risk)
      [] // all-provenance rows (fanout aggregates)
    );

    const { computeAgentMetrics } = await import(
      "@/lib/agent/dogfood/metrics"
    );
    const m = await computeAgentMetrics({ days: 7 });

    expect(m.totalInbox).toBe(0);
    expect(m.totalDrafts).toBe(0);
    expect(m.reviewableDrafts).toBe(0);
    expect(m.editRatePct).toBe(0);
    expect(m.dismissRatePct).toBe(0);
    expect(m.sendRatePct).toBe(0);
    expect(m.l2ReferralPct).toBe(0);
  });
});
