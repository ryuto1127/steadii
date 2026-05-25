import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-24 — Round 4 propose-confirm auto-archive server-action
// tests. Covers archiveProposalConfirmAllAction (both the
// archive-all and per-item subset paths) + archiveProposalDismissAllAction.
//
// All synthetic data — no real subjects, senders, dates (per AGENTS.md §7a).

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("server-only", () => ({}));

// Auth: every action calls getUserId(); the mock returns a fixed id so
// we can assert the WHERE-scoping without spinning up Auth.js.
vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { id: "user-archive-test" } }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

const mocks = vi.hoisted(() => {
  type Row = {
    id: string;
    userId: string;
    status: "open" | "archived";
    autoArchived: boolean;
    senderEmail: string;
    senderDomain: string;
    subject: string | null;
    proposedArchiveReason: string | null;
    proposedArchiveAt: Date | null;
  };
  return {
    state: {
      rows: [] as Row[],
      // Single id-keyed update bin so tests can assert on the final
      // state per row.
      updates: new Map<string, Record<string, unknown>>(),
      audits: [] as Array<Record<string, unknown>>,
      // Per-call argument capture for the confirm path's selectivity
      // assertions. The mock SELECT inspects this to filter as the
      // production WHERE would.
      selectArgs: { ids: undefined as string[] | undefined },
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
  const computeRows = () => {
    const candidates = mocks.state.rows.filter(
      (r) =>
        r.userId === "user-archive-test" &&
        r.proposedArchiveAt !== null,
    );
    if (mocks.state.selectArgs.ids) {
      return candidates.filter((r) =>
        mocks.state.selectArgs.ids!.includes(r.id),
      );
    }
    return candidates;
  };
  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => chain(computeRows()),
        }),
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            // Capture the latest patch — the production code issues
            // one UPDATE per row, so we collect them by index. We
            // don't observe the WHERE clause; the tests assert on
            // the count + payload shape.
            const idx = mocks.state.updates.size;
            mocks.state.updates.set(String(idx), vals);
          },
        }),
      }),
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          mocks.state.audits.push(vals);
          return { then: undefined };
        },
      }),
      // Test-only setters: tell the mock how to filter the next SELECT
      // (to mimic the inArray() narrowing the production WHERE applies).
      __setSelectIds(ids: string[] | undefined) {
        mocks.state.selectArgs.ids = ids;
      },
    },
  };
});

import {
  archiveProposalConfirmAllAction,
  archiveProposalDismissAllAction,
} from "@/app/app/queue-actions";
import { db as _db } from "@/lib/db/client";

const dbAny = _db as unknown as { __setSelectIds: (ids: string[] | undefined) => void };

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.updates = new Map();
  mocks.state.audits = [];
  mocks.state.selectArgs.ids = undefined;
});

// Valid uuid v4 stems (third group must start 1-8; fourth group must
// start 8-b). We synthesize by hex-encoding i so each test row is a
// distinct identity. zod's uuid validator otherwise rejects the
// all-zero pattern.
function seedProposedRows(n: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const hex = (i + 1).toString(16).padStart(2, "0");
    const id = `11111111-1111-4111-8111-1111111111${hex}`;
    ids.push(id);
    mocks.state.rows.push({
      id,
      userId: "user-archive-test",
      status: "open",
      autoArchived: false,
      senderEmail: `noreply${i}@example.com`,
      senderDomain: "example.com",
      subject: `Synthetic subject ${i + 1}`,
      proposedArchiveReason: "Tier1 auto_low conf=0.97 learned_opt_out=false",
      proposedArchiveAt: new Date(),
    });
  }
  return ids;
}

describe("archiveProposalConfirmAllAction — archive all proposed", () => {
  it("returns 0 archived when no rows are proposed", async () => {
    const out = await archiveProposalConfirmAllAction();
    expect(out.archived).toBe(0);
    expect(mocks.state.updates.size).toBe(0);
  });

  it("archives every currently-proposed item when no subset is given", async () => {
    seedProposedRows(3);
    const out = await archiveProposalConfirmAllAction();
    expect(out.archived).toBe(3);
    // Each update flips status='archived', auto_archived=true, and
    // clears the proposed flags.
    const updates = Array.from(mocks.state.updates.values());
    expect(updates.length).toBe(3);
    for (const u of updates) {
      expect(u.status).toBe("archived");
      expect(u.autoArchived).toBe(true);
      expect(u.proposedArchiveAt).toBeNull();
      expect(u.proposedArchiveReason).toBeNull();
    }
    // One audit per archived row (action='auto_archive', preserving
    // the legacy Wave 5 shape).
    const archiveAudits = mocks.state.audits.filter(
      (a) => a.action === "auto_archive",
    );
    expect(archiveAudits.length).toBe(3);
    for (const a of archiveAudits) {
      const detail = a.detail as Record<string, unknown>;
      expect(detail.triggeredBy).toBe("user_confirm");
    }
  });

  it("archives only the picked subset when inboxItemIds is supplied", async () => {
    const ids = seedProposedRows(5);
    const picked = [ids[0]!, ids[2]!];
    dbAny.__setSelectIds(picked);
    const out = await archiveProposalConfirmAllAction({
      inboxItemIds: picked,
    });
    expect(out.archived).toBe(2);
    expect(mocks.state.updates.size).toBe(2);
  });
});

describe("archiveProposalConfirmAllAction — idempotency", () => {
  it("skips already-archived rows but clears their stale proposed flags", async () => {
    seedProposedRows(2);
    // Mutate one row to look already-archived (e.g. concurrent path
    // archived it between the queue card render and the click).
    mocks.state.rows[0]!.status = "archived";
    mocks.state.rows[0]!.autoArchived = true;
    const out = await archiveProposalConfirmAllAction();
    // Only the still-open row counts as archived; the already-archived
    // row's stale proposed flag is still cleared but it isn't double-
    // counted.
    expect(out.archived).toBe(1);
    // Both rows received an update — one a full archive flip, one a
    // proposed-flag clear only.
    expect(mocks.state.updates.size).toBe(2);
    const archiveAudits = mocks.state.audits.filter(
      (a) => a.action === "auto_archive",
    );
    expect(archiveAudits.length).toBe(1);
  });
});

describe("archiveProposalDismissAllAction — clear all proposals", () => {
  it("clears every proposed_archive_at flag without archiving", async () => {
    seedProposedRows(4);
    const out = await archiveProposalDismissAllAction();
    expect(out.cleared).toBe(4);
    // The production dismiss issues a single UPDATE (no per-row loop);
    // the mock captures it as one entry in the updates map.
    expect(mocks.state.updates.size).toBe(1);
    const update = Array.from(mocks.state.updates.values())[0]!;
    expect(update.proposedArchiveAt).toBeNull();
    expect(update.proposedArchiveReason).toBeNull();
    expect(update.status).toBeUndefined();
    expect(update.autoArchived).toBeUndefined();
    // Single batched audit row with the count + ids.
    const dismissAudits = mocks.state.audits.filter(
      (a) => a.action === "auto_archive_dismissed_batch",
    );
    expect(dismissAudits.length).toBe(1);
    const detail = dismissAudits[0]!.detail as Record<string, unknown>;
    expect(detail.count).toBe(4);
    expect(Array.isArray(detail.inboxItemIds)).toBe(true);
  });

  it("returns 0 when nothing is proposed (no audit emitted)", async () => {
    const out = await archiveProposalDismissAllAction();
    expect(out.cleared).toBe(0);
    const dismissAudits = mocks.state.audits.filter(
      (a) => a.action === "auto_archive_dismissed_batch",
    );
    expect(dismissAudits.length).toBe(0);
  });
});
