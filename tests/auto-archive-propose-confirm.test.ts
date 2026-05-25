import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cardHDaysUntilExpiry,
  cardHShouldShowExpiry,
} from "@/lib/agent/queue/visual";
import type { QueueCardH } from "@/lib/agent/queue/types";

// 2026-05-24 — Round 4 propose-confirm auto-archive tests.
//
// Two surfaces:
//   1. Pure helpers (no DB, no JSX) — cardHDaysUntilExpiry,
//      cardHShouldShowExpiry, QueueCardH type contract.
//   2. The 7-day expiry sweep (`expireStaleProposedArchives`) — uses
//      the same thin Drizzle mock pattern as
//      tests/auto-cal-proposal-expiry.test.ts.
//
// The queue-actions side (confirmAll / dismissAll) is covered by
// tests/queue-archive-proposal-actions.test.ts. Splitting the two
// keeps the mock surface per-file small.
//
// All synthetic data — no real subjects, senders, dates, thread ids
// (per AGENTS.md §7a).

describe("QueueCardH type contract — propose-confirm batch", () => {
  it("accepts a valid Type H card with items + soonestExpiresAt", () => {
    const card: QueueCardH = {
      id: "archive_proposals:batch",
      archetype: "H",
      title: "Confirm auto-archive",
      body: "",
      confidence: "medium",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: true,
      totalCount: 4,
      items: [
        {
          id: "00000000-0000-0000-0000-000000000001",
          senderLabel: "Synthetic Newsletter",
          subject: "Synthetic subject",
          proposedAt: new Date().toISOString(),
        },
      ],
      soonestExpiresAt: new Date().toISOString(),
    };
    expect(card.archetype).toBe("H");
    expect(card.totalCount).toBe(4);
    expect(card.items[0]!.senderLabel).toBe("Synthetic Newsletter");
  });

  it("supports an empty items[] alongside totalCount=0 (defensive)", () => {
    const card: QueueCardH = {
      id: "archive_proposals:batch",
      archetype: "H",
      title: "Confirm auto-archive",
      body: "",
      confidence: "medium",
      createdAt: new Date().toISOString(),
      sources: [],
      reversible: true,
      totalCount: 0,
      items: [],
      soonestExpiresAt: new Date().toISOString(),
    };
    expect(card.totalCount).toBe(0);
  });
});

describe("cardHDaysUntilExpiry", () => {
  it("returns the remaining days for a proposal stamped today", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const proposedAt = new Date(now).toISOString();
    // Default 7d window.
    expect(cardHDaysUntilExpiry(proposedAt, now)).toBe(7);
  });

  it("returns the remaining days for a proposal stamped 5 days ago", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const proposedAt = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();
    expect(cardHDaysUntilExpiry(proposedAt, now)).toBe(2);
  });

  it("clamps to 0 when the proposal is already past its 7d window", () => {
    const now = Date.UTC(2026, 4, 24, 12, 0, 0);
    const proposedAt = new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString();
    expect(cardHDaysUntilExpiry(proposedAt, now)).toBe(0);
  });

  it("returns null for malformed ISO input", () => {
    expect(cardHDaysUntilExpiry("not-a-date")).toBeNull();
  });
});

describe("cardHShouldShowExpiry — within 1 day of 7d sweep", () => {
  it("shows the pill at exactly 1 day remaining", () => {
    expect(cardHShouldShowExpiry(1)).toBe(true);
  });
  it("shows the pill at 0 days remaining", () => {
    expect(cardHShouldShowExpiry(0)).toBe(true);
  });
  it("hides the pill at 2+ days remaining", () => {
    expect(cardHShouldShowExpiry(2)).toBe(false);
    expect(cardHShouldShowExpiry(7)).toBe(false);
  });
  it("hides the pill on a malformed input", () => {
    expect(cardHShouldShowExpiry(null)).toBe(false);
  });
});

// ── 7d expiry sweep ──────────────────────────────────────────────────

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  type Row = {
    id: string;
    userId: string;
    proposedArchiveAt: Date;
  };
  return {
    state: {
      rows: [] as Row[],
      updates: [] as Array<Record<string, unknown>>,
      audits: [] as Array<Record<string, unknown>>,
    },
  };
});

vi.mock("@/lib/db/client", () => {
  const filterStaleByCutoff = (cutoff: Date) =>
    mocks.state.rows.filter((r) => r.proposedArchiveAt < cutoff);

  let pendingCutoff: Date = new Date(0);

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
      // We intercept select() to return stale rows. The production code
      // builds the WHERE with isNotNull + lt(..., cutoff); we approximate
      // by deriving the cutoff from the global "now" the test sets.
      select: () => ({
        from: () => ({
          where: () => chain(filterStaleByCutoff(pendingCutoff)),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            mocks.state.updates.push(vals);
          },
        }),
      }),
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          mocks.state.audits.push(vals);
          return {
            onConflictDoNothing: () => ({
              returning: async () => [vals],
            }),
            then: undefined,
          };
        },
      }),
      __setCutoff(c: Date) {
        pendingCutoff = c;
      },
    },
  };
});

// Pull the helper through after the mocks are set up.
import { expireStaleProposedArchives } from "@/lib/agent/email/auto-archive";
import { db as _db } from "@/lib/db/client";

const dbAny = _db as unknown as { __setCutoff: (c: Date) => void };

const NOW_MS = Date.UTC(2026, 4, 24, 12, 0, 0);
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.updates = [];
  mocks.state.audits = [];
});

describe("expireStaleProposedArchives — 7d sweep", () => {
  it("clears nothing when no rows are proposed", async () => {
    dbAny.__setCutoff(new Date(NOW_MS - STALE_AFTER_MS));
    const out = await expireStaleProposedArchives({ nowMs: NOW_MS });
    expect(out.scanned).toBe(0);
    expect(out.cleared).toBe(0);
    expect(mocks.state.updates.length).toBe(0);
  });

  it("clears only rows past the 7d window; recent proposals are untouched", async () => {
    const cutoff = new Date(NOW_MS - STALE_AFTER_MS);
    dbAny.__setCutoff(cutoff);
    mocks.state.rows = [
      {
        id: "row-stale-1",
        userId: "user-a",
        proposedArchiveAt: new Date(NOW_MS - 8 * 24 * 60 * 60 * 1000),
      },
      {
        id: "row-stale-2",
        userId: "user-a",
        proposedArchiveAt: new Date(NOW_MS - 10 * 24 * 60 * 60 * 1000),
      },
      // Recent — NOT included in the mock filter (would not appear in
      // the production WHERE either).
    ];
    const out = await expireStaleProposedArchives({ nowMs: NOW_MS });
    expect(out.scanned).toBe(2);
    expect(out.cleared).toBe(2);
    // Both updates clear proposedArchiveAt + proposedArchiveReason.
    for (const u of mocks.state.updates) {
      expect(u.proposedArchiveAt).toBeNull();
      expect(u.proposedArchiveReason).toBeNull();
    }
    // Single audit per user (not per row).
    const auditCount = mocks.state.audits.filter(
      (a) => a.action === "auto_archive_proposal_expired",
    ).length;
    expect(auditCount).toBe(1);
  });

  it("emits ONE audit row per user, with the full id list in detail", async () => {
    const cutoff = new Date(NOW_MS - STALE_AFTER_MS);
    dbAny.__setCutoff(cutoff);
    mocks.state.rows = [
      {
        id: "row-a-1",
        userId: "user-a",
        proposedArchiveAt: new Date(NOW_MS - 8 * 24 * 60 * 60 * 1000),
      },
      {
        id: "row-a-2",
        userId: "user-a",
        proposedArchiveAt: new Date(NOW_MS - 9 * 24 * 60 * 60 * 1000),
      },
      {
        id: "row-b-1",
        userId: "user-b",
        proposedArchiveAt: new Date(NOW_MS - 8 * 24 * 60 * 60 * 1000),
      },
    ];
    await expireStaleProposedArchives({ nowMs: NOW_MS });
    const audits = mocks.state.audits.filter(
      (a) => a.action === "auto_archive_proposal_expired",
    );
    expect(audits.length).toBe(2);
    const userAAudit = audits.find((a) => a.userId === "user-a");
    expect(userAAudit).toBeDefined();
    const detail = userAAudit!.detail as Record<string, unknown>;
    expect(detail.count).toBe(2);
    expect(detail.inboxItemIds).toEqual(["row-a-1", "row-a-2"]);
  });

  it("honors a custom staleAfterMs for test-time determinism", async () => {
    const customStale = 1 * 24 * 60 * 60 * 1000; // 1 day
    dbAny.__setCutoff(new Date(NOW_MS - customStale));
    mocks.state.rows = [
      {
        id: "row-1d-old",
        userId: "user-a",
        proposedArchiveAt: new Date(NOW_MS - 2 * 24 * 60 * 60 * 1000),
      },
    ];
    const out = await expireStaleProposedArchives({
      nowMs: NOW_MS,
      staleAfterMs: customStale,
    });
    expect(out.cleared).toBe(1);
  });
});
