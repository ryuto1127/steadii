import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-06-13 — Wave A noise reduction. Tests for the draft-ttl sub-sweep.
// Stale pending agent_drafts age out SILENTLY (disposition='resolved' +
// neutral audit row); the Gmail message is untouched.
//
// Tiers:
//   - notify_only / low-value FYI → 48h
//   - decision-required (draft_reply / ask_clarifying, OR high/med risk)
//     → 5 days
//
// The pure tier/age predicates are tested directly; the sweep itself runs
// against an in-memory candidate table whose db mock applies the same
// `created_at < now-48h` prune the production SELECT uses (48h is the
// shortest TTL, so nothing newer is age-out-eligible in either tier).

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

type Action = "draft_reply" | "ask_clarifying" | "notify_only";
type Risk = "low" | "medium" | "high";
type Row = {
  id: string;
  userId: string;
  action: Action;
  riskTier: Risk;
  createdAt: Date;
  disposition: "active" | "resolved" | "skipped" | "ignored";
};

const mocks = vi.hoisted(() => ({
  state: {
    rows: [] as Row[],
    now: new Date(),
    updates: [] as Array<{ id: string; set: Record<string, unknown> }>,
    audits: [] as Array<{ resourceId?: string | null; detail?: Record<string, unknown> | null }>,
  },
}));

vi.mock("@/lib/db/client", () => {
  // SELECT chain: the production query prunes status='pending' +
  // disposition='active' + action in (...) + created_at < now-48h. The
  // mock applies the created_at prune (the load-bearing DB-side cut) and
  // returns the surviving candidate rows; the in-code predicate then
  // makes the tier/age decision.
  const selectChain = () => {
    const oldestEligible = mocks.state.now.getTime() - 48 * 60 * 60 * 1000;
    const rows = mocks.state.rows.filter(
      (r) => r.disposition === "active" && r.createdAt.getTime() < oldestEligible,
    );
    const promise = Promise.resolve(
      rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        action: r.action,
        riskTier: r.riskTier,
        createdAt: r.createdAt,
      })),
    );
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
      select: () => selectChain(),
      update: () => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            // The thin mock can't observe the per-id WHERE; the sweep
            // issues one UPDATE per aged-out row, so we record the set
            // payload and rely on the audit hook below for the id.
            mocks.state.updates.push({ id: "*", set: vals });
          },
        }),
      }),
    },
  };
});

vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: vi.fn(async (params: {
    resourceId?: string | null;
    detail?: Record<string, unknown> | null;
  }) => {
    mocks.state.audits.push({
      resourceId: params.resourceId,
      detail: params.detail,
    });
  }),
}));

import {
  draftTtlTier,
  isDraftAgedOut,
  runDraftTtlSweep,
  DRAFT_FYI_TTL_MS,
  DRAFT_DECISION_TTL_MS,
} from "@/lib/agent/email/draft-ttl-sweep";

const NOW = new Date("2026-06-13T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function row(partial: Partial<Row> & Pick<Row, "id" | "action" | "riskTier" | "createdAt">): Row {
  return {
    userId: "u1",
    disposition: "active",
    ...partial,
  };
}

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.now = NOW;
  mocks.state.updates = [];
  mocks.state.audits = [];
});

describe("draftTtlTier — pure tier predicate", () => {
  it("draft_reply is decision-required regardless of risk", () => {
    expect(draftTtlTier({ action: "draft_reply", riskTier: "low" })).toBe("decision");
  });
  it("ask_clarifying is decision-required regardless of risk", () => {
    expect(draftTtlTier({ action: "ask_clarifying", riskTier: "low" })).toBe("decision");
  });
  it("high/medium-risk notify_only is decision-required", () => {
    expect(draftTtlTier({ action: "notify_only", riskTier: "high" })).toBe("decision");
    expect(draftTtlTier({ action: "notify_only", riskTier: "medium" })).toBe("decision");
  });
  it("low-risk notify_only is the FYI (short-TTL) tier", () => {
    expect(draftTtlTier({ action: "notify_only", riskTier: "low" })).toBe("fyi");
  });
});

describe("isDraftAgedOut — tiered age-out", () => {
  it("ages out a low-risk FYI after 48h, not before", () => {
    const base = { action: "notify_only" as const, riskTier: "low" as const };
    expect(isDraftAgedOut({ ...base, createdAt: new Date(NOW.getTime() - 47 * HOUR) }, NOW)).toBe(false);
    expect(isDraftAgedOut({ ...base, createdAt: new Date(NOW.getTime() - 49 * HOUR) }, NOW)).toBe(true);
  });
  it("does NOT age out a decision-required draft at 48h (needs 5 days)", () => {
    const base = { action: "draft_reply" as const, riskTier: "low" as const };
    // 3 days old: past the FYI window but well inside the 5-day backstop.
    expect(isDraftAgedOut({ ...base, createdAt: new Date(NOW.getTime() - 72 * HOUR) }, NOW)).toBe(false);
  });
  it("ages out a decision-required draft after 5 days", () => {
    const base = { action: "draft_reply" as const, riskTier: "low" as const };
    expect(isDraftAgedOut({ ...base, createdAt: new Date(NOW.getTime() - DRAFT_DECISION_TTL_MS - HOUR) }, NOW)).toBe(true);
  });
  it("the two TTL constants are 48h and 5 days", () => {
    expect(DRAFT_FYI_TTL_MS).toBe(48 * HOUR);
    expect(DRAFT_DECISION_TTL_MS).toBe(5 * 24 * HOUR);
  });
});

describe("runDraftTtlSweep", () => {
  it("ages out a 49h-old low-risk FYI (fyi tier) and writes a silent audit row", async () => {
    mocks.state.rows = [
      row({ id: "fyi-old", action: "notify_only", riskTier: "low", createdAt: new Date(NOW.getTime() - 49 * HOUR) }),
    ];

    const r = await runDraftTtlSweep({ nowMs: NOW.getTime() });

    expect(r.agedOut).toBe(1);
    expect(r.agedOutFyi).toBe(1);
    expect(r.agedOutDecision).toBe(0);
    // disposition flipped to resolved (silent — no status/tag column).
    expect(mocks.state.updates).toHaveLength(1);
    expect(mocks.state.updates[0]!.set.disposition).toBe("resolved");
    // neutral audit row carries the silent subAction + tier.
    expect(mocks.state.audits).toHaveLength(1);
    expect(mocks.state.audits[0]!.detail).toEqual({ subAction: "aged_out", tier: "fyi" });
    expect(mocks.state.audits[0]!.resourceId).toBe("fyi-old");
  });

  it("does NOT age out a 3-day-old decision-required draft (5d backstop)", async () => {
    mocks.state.rows = [
      row({ id: "decision-3d", action: "draft_reply", riskTier: "low", createdAt: new Date(NOW.getTime() - 72 * HOUR) }),
    ];

    const r = await runDraftTtlSweep({ nowMs: NOW.getTime() });

    expect(r.agedOut).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
    expect(mocks.state.audits).toHaveLength(0);
  });

  it("ages out a 6-day-old decision-required draft (decision tier)", async () => {
    mocks.state.rows = [
      row({ id: "decision-6d", action: "ask_clarifying", riskTier: "high", createdAt: new Date(NOW.getTime() - 6 * 24 * HOUR) }),
    ];

    const r = await runDraftTtlSweep({ nowMs: NOW.getTime() });

    expect(r.agedOut).toBe(1);
    expect(r.agedOutDecision).toBe(1);
    expect(r.agedOutFyi).toBe(0);
    expect(mocks.state.audits[0]!.detail).toEqual({ subAction: "aged_out", tier: "decision" });
  });

  it("processes a mixed batch: ages FYI@49h + decision@6d, leaves FYI@40h + decision@3d", async () => {
    mocks.state.rows = [
      row({ id: "fyi-old", action: "notify_only", riskTier: "low", createdAt: new Date(NOW.getTime() - 49 * HOUR) }),
      row({ id: "fyi-fresh", action: "notify_only", riskTier: "low", createdAt: new Date(NOW.getTime() - 40 * HOUR) }),
      row({ id: "decision-old", action: "draft_reply", riskTier: "medium", createdAt: new Date(NOW.getTime() - 6 * 24 * HOUR) }),
      row({ id: "decision-young", action: "draft_reply", riskTier: "medium", createdAt: new Date(NOW.getTime() - 3 * 24 * HOUR) }),
    ];

    const r = await runDraftTtlSweep({ nowMs: NOW.getTime() });

    // fyi-fresh (40h) is pruned at the DB level (< 48h); the others are
    // candidates but only the two genuinely-aged ones flip.
    expect(r.agedOut).toBe(2);
    expect(r.agedOutFyi).toBe(1);
    expect(r.agedOutDecision).toBe(1);
    const auditedIds = mocks.state.audits.map((a) => a.resourceId).sort();
    expect(auditedIds).toEqual(["decision-old", "fyi-old"]);
  });

  it("does not touch already-resolved drafts (disposition != active)", async () => {
    mocks.state.rows = [
      row({ id: "resolved", action: "notify_only", riskTier: "low", createdAt: new Date(NOW.getTime() - 10 * 24 * HOUR), disposition: "resolved" }),
    ];

    const r = await runDraftTtlSweep({ nowMs: NOW.getTime() });

    expect(r.agedOut).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("returns zeros when there is no stale backlog", async () => {
    const r = await runDraftTtlSweep({ nowMs: NOW.getTime() });
    expect(r).toEqual({ scanned: 0, agedOut: 0, agedOutFyi: 0, agedOutDecision: 0 });
  });
});
