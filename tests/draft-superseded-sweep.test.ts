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
      subject: string | null;
      senderEmail: string | null;
    }>,
    updates: [] as Array<{
      id: string;
      status: string;
      disposition?: string;
    }>,
    inserts: [] as Array<Record<string, unknown>>,
    // Optional injection: if set, the next insert throws this error.
    // Used to assert that notification-insert failures are best-effort.
    nextInsertError: null as Error | null,
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
        set: (vals: { status: string; disposition?: string }) => ({
          where: async () => {
            mocks.state.updates.push({
              id: "*",
              status: vals.status,
              disposition: vals.disposition,
            });
          },
        }),
      }),
      insert: () => ({
        values: async (vals: Record<string, unknown>) => {
          if (mocks.state.nextInsertError) {
            const err = mocks.state.nextInsertError;
            mocks.state.nextInsertError = null;
            throw err;
          }
          mocks.state.inserts.push(vals);
        },
      }),
    },
  };
});

import { runDraftSupersededSweep } from "@/lib/agent/email/draft-superseded-sweep";

function draftRow(opts: {
  draftId: string;
  threadExternalId?: string | null;
  receivedAt?: Date;
  subject?: string | null;
  senderEmail?: string | null;
}) {
  return {
    draftId: opts.draftId,
    userId: `user-${opts.draftId}`,
    inboxItemId: `inbox-${opts.draftId}`,
    threadExternalId:
      opts.threadExternalId === undefined ? "thread-1" : opts.threadExternalId,
    receivedAt: opts.receivedAt ?? new Date("2026-05-20T12:00:00Z"),
    subject: opts.subject ?? "Synthetic subject",
    senderEmail: opts.senderEmail ?? "noreply@example.com",
  };
}

beforeEach(() => {
  mocks.state.rows = [];
  mocks.state.updates = [];
  mocks.state.inserts = [];
  mocks.state.nextInsertError = null;
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
      {
        id: "*",
        status: "superseded_by_user_send",
        disposition: "resolved",
      },
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

describe("runDraftSupersededSweep — PR 3 disposition mirror", () => {
  it("writes disposition='resolved' alongside the legacy status flip", async () => {
    mocks.state.rows = [draftRow({ draftId: "d-pr3" })];
    const probe = vi.fn().mockResolvedValue(true);
    await runDraftSupersededSweep({ probe });
    expect(mocks.state.updates).toHaveLength(1);
    expect(mocks.state.updates[0]).toMatchObject({
      status: "superseded_by_user_send",
      disposition: "resolved",
    });
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

// Round 5 — notify-with-undo. The detection + state flip behaviour
// stays unchanged; the additive bit is the agent_notifications insert
// that records the 24h reversibility window.
describe("runDraftSupersededSweep — Round 5 notification insert", () => {
  it("writes an agent_notifications row on every successful flip", async () => {
    mocks.state.rows = [
      draftRow({
        draftId: "d-r5-1",
        subject: "Synthetic subject A",
        senderEmail: "noreply-a@example.com",
      }),
    ];
    const probe = vi.fn().mockResolvedValue(true);
    await runDraftSupersededSweep({ probe });
    expect(mocks.state.inserts).toHaveLength(1);
    const notif = mocks.state.inserts[0]!;
    expect(notif.kind).toBe("auto_resolved_draft");
    expect(notif.subjectTable).toBe("agent_drafts");
    expect(notif.subjectId).toBe("d-r5-1");
    expect(notif.userId).toBe("user-d-r5-1");
    expect(typeof notif.summary).toBe("string");
    expect((notif.summary as string).length).toBeGreaterThan(0);
    expect(notif.undoableUntil).toBeInstanceOf(Date);
  });

  it("does NOT insert a notification when the probe returns false (no flip)", async () => {
    mocks.state.rows = [draftRow({ draftId: "d-r5-2" })];
    const probe = vi.fn().mockResolvedValue(false);
    await runDraftSupersededSweep({ probe });
    expect(mocks.state.inserts).toHaveLength(0);
  });

  it("sets undoable_until ~24h in the future", async () => {
    mocks.state.rows = [draftRow({ draftId: "d-r5-3" })];
    const probe = vi.fn().mockResolvedValue(true);
    const before = Date.now();
    await runDraftSupersededSweep({ probe });
    const after = Date.now();
    const notif = mocks.state.inserts[0]!;
    const ms = (notif.undoableUntil as Date).getTime();
    expect(ms).toBeGreaterThanOrEqual(before + 24 * 60 * 60 * 1000 - 1000);
    expect(ms).toBeLessThanOrEqual(after + 24 * 60 * 60 * 1000 + 1000);
  });

  it("a failing notification insert does NOT roll back the status flip", async () => {
    mocks.state.rows = [draftRow({ draftId: "d-r5-4" })];
    mocks.state.nextInsertError = new Error("DB transient");
    const probe = vi.fn().mockResolvedValue(true);
    const r = await runDraftSupersededSweep({ probe });
    // Flip still happened — superseded count = 1, draft updated.
    expect(r.superseded).toBe(1);
    expect(mocks.state.updates).toHaveLength(1);
    expect(mocks.state.inserts).toHaveLength(0);
  });

  it("processes multiple rows with both update + insert per row", async () => {
    mocks.state.rows = [
      draftRow({ draftId: "d-m1", subject: "A" }),
      draftRow({ draftId: "d-m2", subject: "B" }),
    ];
    const probe = vi.fn().mockResolvedValue(true);
    await runDraftSupersededSweep({ probe });
    expect(mocks.state.updates).toHaveLength(2);
    expect(mocks.state.inserts).toHaveLength(2);
    const ids = mocks.state.inserts.map((i) => i.subjectId).sort();
    expect(ids).toEqual(["d-m1", "d-m2"]);
  });
});

// buildAutoResolveSummary is colocated with the sweep because the
// shape (length + fallback ordering) is part of the notification
// contract. The activity row reads this string directly.
describe("buildAutoResolveSummary", () => {
  it("prefers subject when present", async () => {
    const { buildAutoResolveSummary } = await import(
      "@/lib/agent/email/draft-superseded-sweep"
    );
    expect(
      buildAutoResolveSummary({
        subject: "Synthetic subject",
        senderEmail: "noreply@example.com",
      }),
    ).toBe("Auto-resolved draft for Synthetic subject");
  });

  it("falls back to senderEmail when subject is blank", async () => {
    const { buildAutoResolveSummary } = await import(
      "@/lib/agent/email/draft-superseded-sweep"
    );
    expect(
      buildAutoResolveSummary({
        subject: "",
        senderEmail: "noreply@example.com",
      }),
    ).toBe("Auto-resolved draft for noreply@example.com");
  });

  it("falls back to a generic phrase when both are missing", async () => {
    const { buildAutoResolveSummary } = await import(
      "@/lib/agent/email/draft-superseded-sweep"
    );
    expect(
      buildAutoResolveSummary({ subject: null, senderEmail: null }),
    ).toBe("Auto-resolved draft for a thread");
  });

  it("truncates to <=120 chars with ellipsis", async () => {
    const { buildAutoResolveSummary } = await import(
      "@/lib/agent/email/draft-superseded-sweep"
    );
    const longSubject = "x".repeat(200);
    const out = buildAutoResolveSummary({
      subject: longSubject,
      senderEmail: null,
    });
    expect(out.length).toBe(120);
    expect(out.endsWith("...")).toBe(true);
  });
});
