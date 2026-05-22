import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

const mocks = vi.hoisted(() => ({
  state: {
    rows: [] as Array<{
      draftId: string;
      userId: string;
      inboxItemId: string;
      threadExternalId: string | null;
      receivedAt: Date;
    }>,
    updates: [] as Array<{ id: string; status: string }>,
  },
}));

vi.mock("@/lib/db/client", () => {
  const chain = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
    const c: Record<string, unknown> = {
      from: () => c,
      innerJoin: () => c,
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
      select: () => chain(mocks.state.rows),
      update: () => ({
        set: (vals: { status: string }) => ({
          where: async () => {
            mocks.state.updates.push({ id: "*", status: vals.status });
          },
        }),
      }),
    },
  };
});

import { runDraftSupersededSweep } from "@/lib/agent/email/draft-superseded-sweep";

function draftRow(opts: {
  draftId: string;
  threadExternalId?: string | null;
  receivedAt?: Date;
}) {
  return {
    draftId: opts.draftId,
    userId: `user-${opts.draftId}`,
    inboxItemId: `inbox-${opts.draftId}`,
    threadExternalId:
      opts.threadExternalId === undefined ? "thread-1" : opts.threadExternalId,
    receivedAt: opts.receivedAt ?? new Date("2026-05-20T12:00:00Z"),
  };
}

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.updates = [];
});

describe("runDraftSupersededSweep — happy path", () => {
  it("flips status when probe finds a SENT-labeled message newer than receivedAt", async () => {
    mocks.state.rows = [draftRow({ draftId: "d1" })];
    const probe = vi.fn().mockResolvedValue(true);
    const r = await runDraftSupersededSweep({ probe });
    expect(r.scanned).toBe(1);
    expect(r.superseded).toBe(1);
    expect(r.skipped).toBe(0);
    expect(mocks.state.updates).toEqual([
      { id: "*", status: "superseded_by_user_send" },
    ]);
  });

  it("processes multiple rows independently", async () => {
    mocks.state.rows = [
      draftRow({ draftId: "d1" }),
      draftRow({ draftId: "d2" }),
      draftRow({ draftId: "d3" }),
    ];
    const probe = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const r = await runDraftSupersededSweep({ probe });
    expect(r.scanned).toBe(3);
    expect(r.superseded).toBe(2);
    expect(mocks.state.updates).toHaveLength(2);
  });
});

describe("runDraftSupersededSweep — skip paths", () => {
  it("leaves the draft alone when probe returns false (no Gmail-direct reply)", async () => {
    mocks.state.rows = [draftRow({ draftId: "d1" })];
    const probe = vi.fn().mockResolvedValue(false);
    const r = await runDraftSupersededSweep({ probe });
    expect(r.scanned).toBe(1);
    expect(r.superseded).toBe(0);
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("skips rows without threadExternalId", async () => {
    mocks.state.rows = [draftRow({ draftId: "d1", threadExternalId: null })];
    const probe = vi.fn().mockResolvedValue(true);
    const r = await runDraftSupersededSweep({ probe });
    expect(r.scanned).toBe(1);
    expect(r.skipped).toBe(1);
    expect(r.superseded).toBe(0);
    expect(probe).not.toHaveBeenCalled();
  });

  it("counts probe errors as skipped (not fatal to the sweep)", async () => {
    mocks.state.rows = [
      draftRow({ draftId: "d1" }),
      draftRow({ draftId: "d2" }),
    ];
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error("Gmail rate limit"))
      .mockResolvedValueOnce(true);
    const r = await runDraftSupersededSweep({ probe });
    expect(r.scanned).toBe(2);
    expect(r.skipped).toBe(1);
    expect(r.superseded).toBe(1);
  });

  it("returns zeroes when no pending draft_reply rows exist", async () => {
    mocks.state.rows = [];
    const probe = vi.fn();
    const r = await runDraftSupersededSweep({ probe });
    expect(r.scanned).toBe(0);
    expect(r.superseded).toBe(0);
    expect(r.skipped).toBe(0);
    expect(probe).not.toHaveBeenCalled();
  });
});

describe("runDraftSupersededSweep — probe arguments", () => {
  it("passes the inbox_item.receivedAt as afterMs so older SENT msgs don't trip the flip", async () => {
    const receivedAt = new Date("2026-05-20T12:00:00Z");
    mocks.state.rows = [draftRow({ draftId: "d1", receivedAt })];
    const probe = vi.fn().mockResolvedValue(false);
    await runDraftSupersededSweep({ probe });
    expect(probe).toHaveBeenCalledWith({
      userId: "user-d1",
      threadExternalId: "thread-1",
      afterMs: receivedAt.getTime(),
    });
  });
});
