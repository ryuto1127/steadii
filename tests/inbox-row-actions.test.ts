import { beforeEach, describe, expect, it, vi } from "vitest";

// Inbox list row-level two-button clear:
//   - dismissInboxItemAction          → 確認済み. NEUTRAL: flips
//     inbox_items.status to 'dismissed' and does NOTHING ELSE (no feedback,
//     no sender-confidence, no ignored-senders).
//   - markInboxItemNotNeededAction    → 不要. Same status flip PLUS a
//     RECORD-ONLY soft-negative: recordSenderFeedback('dismissed') only. It
//     MUST NOT call the sender-confidence learner (recordSenderEvent) or
//     touch agent_ignored_senders — logging the signal must never activate a
//     suppression threshold.
//
// All synthetic — no real ids/senders/subjects (AGENTS.md §7a). DB mocked.

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/config", () => ({
  auth: () => Promise.resolve({ user: { id: "user-1" } }),
}));

const logEmailAudit = vi.fn((..._a: unknown[]) => undefined);
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: (...args: unknown[]) => logEmailAudit(...args),
}));

// The restore helper is imported by the same actions module but unrelated to
// these actions — stub so the module loads.
vi.mock("@/lib/agent/email/auto-archive", () => ({
  restoreFromAutoArchive: vi.fn(),
}));

// Record-only soft-negative writer we DO expect on 不要.
const recordSenderFeedback = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/agent/email/feedback", () => ({
  recordSenderFeedback: (...a: unknown[]) => recordSenderFeedback(...a),
}));

// Learning / suppression surfaces that must NEVER be touched by either action.
const recordSenderEvent = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/agent/learning/sender-confidence", () => ({
  recordSenderEvent: (...a: unknown[]) => recordSenderEvent(...a),
}));
const addIgnoredSender = vi.fn();
vi.mock("@/lib/agent/email/ignored-senders", () => ({
  addIgnoredSender: (...a: unknown[]) => addIgnoredSender(...a),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: { id: {}, userId: {}, status: {}, deletedAt: {}, senderEmail: {}, senderDomain: {} },
  agentDrafts: { id: {}, inboxItemId: {}, action: {}, createdAt: {} },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  isNull: (col: unknown) => ({ __isNull: col }),
  desc: (col: unknown) => ({ __desc: col }),
}));

type FakeRow = {
  id: string;
  userId: string;
  status: "open" | "snoozed" | "dismissed" | "archived" | "sent";
  deletedAt: Date | null;
  senderEmail: string;
  senderDomain: string;
  draftAction: string | null;
};

const fixture = { rows: [] as FakeRow[] };

const updateOps: Array<{ patch: Record<string, unknown>; returnedIds: string[] }> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          // Only OPEN, non-deleted rows for the user flip — mirror that so
          // returning() reflects the real predicate.
          returning: async () => {
            const matched = fixture.rows.filter(
              (r) =>
                r.userId === "user-1" &&
                r.status === "open" &&
                r.deletedAt === null
            );
            for (const r of matched) r.status = "dismissed";
            updateOps.push({ patch, returnedIds: matched.map((r) => r.id) });
            return matched.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
    // markInboxItemNotNeededAction re-reads the row's sender after the flip.
    select: () => {
      const c: Record<string, unknown> = {
        from: () => c,
        leftJoin: () => c,
        where: () => c,
        orderBy: () => c,
        limit: async () =>
          fixture.rows.map((r) => ({
            senderEmail: r.senderEmail,
            senderDomain: r.senderDomain,
            draftAction: r.draftAction,
          })),
      };
      return c;
    },
  },
}));

function formData(id: string): FormData {
  const fd = new FormData();
  if (id) fd.set("id", id);
  return fd;
}

beforeEach(() => {
  fixture.rows = [];
  updateOps.length = 0;
  logEmailAudit.mockClear();
  recordSenderFeedback.mockClear();
  recordSenderEvent.mockClear();
  addIgnoredSender.mockClear();
});

describe("dismissInboxItemAction — 確認済み (neutral row clear)", () => {
  it("flips the row's status to 'dismissed'", async () => {
    fixture.rows = [
      {
        id: "ib-1",
        userId: "user-1",
        status: "open",
        deletedAt: null,
        senderEmail: "s@example.edu",
        senderDomain: "example.edu",
        draftAction: null,
      },
    ];
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await dismissInboxItemAction(formData("ib-1"));
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0].patch.status).toBe("dismissed");
    expect(fixture.rows[0].status).toBe("dismissed");
  });

  it("writes a neutral audit row and NO feedback / sender-confidence / ignored-senders", async () => {
    fixture.rows = [
      {
        id: "ib-1",
        userId: "user-1",
        status: "open",
        deletedAt: null,
        senderEmail: "s@example.edu",
        senderDomain: "example.edu",
        draftAction: null,
      },
    ];
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await dismissInboxItemAction(formData("ib-1"));
    expect(recordSenderFeedback).not.toHaveBeenCalled();
    expect(recordSenderEvent).not.toHaveBeenCalled();
    expect(addIgnoredSender).not.toHaveBeenCalled();
    expect(logEmailAudit).toHaveBeenCalledTimes(1);
    const arg = logEmailAudit.mock.calls[0][0] as {
      action: string;
      detail: Record<string, unknown>;
    };
    expect(arg.action).toBe("email_item_dismissed");
    expect(arg.detail).toEqual({ source: "inbox_list_row" });
  });

  it("is idempotent: no audit row when nothing flipped (already cleared)", async () => {
    fixture.rows = [
      {
        id: "ib-1",
        userId: "user-1",
        status: "dismissed",
        deletedAt: null,
        senderEmail: "s@example.edu",
        senderDomain: "example.edu",
        draftAction: null,
      },
    ];
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await dismissInboxItemAction(formData("ib-1"));
    expect(updateOps[0].returnedIds).toHaveLength(0);
    expect(logEmailAudit).not.toHaveBeenCalled();
  });

  it("rejects an empty id without touching the DB", async () => {
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await expect(dismissInboxItemAction(formData(""))).rejects.toThrow(/invalid id/);
    expect(updateOps).toHaveLength(0);
    expect(logEmailAudit).not.toHaveBeenCalled();
  });
});

describe("markInboxItemNotNeededAction — 不要 (record-only soft-negative)", () => {
  it("flips status to 'dismissed' AND records a record-only sender feedback (dismissed)", async () => {
    fixture.rows = [
      {
        id: "ib-2",
        userId: "user-1",
        status: "open",
        deletedAt: null,
        senderEmail: "noreply@dept.example.edu",
        senderDomain: "dept.example.edu",
        draftAction: "notify_only",
      },
    ];
    const { markInboxItemNotNeededAction } = await import(
      "@/app/app/inbox/actions"
    );
    await markInboxItemNotNeededAction(formData("ib-2"));
    expect(updateOps[0].patch.status).toBe("dismissed");
    expect(recordSenderFeedback).toHaveBeenCalledTimes(1);
    const arg = recordSenderFeedback.mock.calls[0][0] as {
      userResponse: string;
      senderEmail: string;
      proposedAction: string;
    };
    expect(arg.userResponse).toBe("dismissed");
    expect(arg.senderEmail).toBe("noreply@dept.example.edu");
    expect(arg.proposedAction).toBe("notify_only");
  });

  it("NEVER activates the sender-confidence learner or ignored-senders (record-only)", async () => {
    fixture.rows = [
      {
        id: "ib-2",
        userId: "user-1",
        status: "open",
        deletedAt: null,
        senderEmail: "noreply@dept.example.edu",
        senderDomain: "dept.example.edu",
        draftAction: "notify_only",
      },
    ];
    const { markInboxItemNotNeededAction } = await import(
      "@/app/app/inbox/actions"
    );
    await markInboxItemNotNeededAction(formData("ib-2"));
    expect(recordSenderEvent).not.toHaveBeenCalled();
    expect(addIgnoredSender).not.toHaveBeenCalled();
  });

  it("writes the not-needed audit row", async () => {
    fixture.rows = [
      {
        id: "ib-2",
        userId: "user-1",
        status: "open",
        deletedAt: null,
        senderEmail: "noreply@dept.example.edu",
        senderDomain: "dept.example.edu",
        draftAction: "notify_only",
      },
    ];
    const { markInboxItemNotNeededAction } = await import(
      "@/app/app/inbox/actions"
    );
    await markInboxItemNotNeededAction(formData("ib-2"));
    const calls = logEmailAudit.mock.calls.filter(
      (c) => (c[0] as { action: string }).action === "email_item_marked_not_needed"
    );
    expect(calls).toHaveLength(1);
    expect((calls[0][0] as { detail: unknown }).detail).toEqual({
      source: "inbox_list_row",
    });
  });

  it("is idempotent: nothing flipped → no feedback, no audit", async () => {
    fixture.rows = [
      {
        id: "ib-2",
        userId: "user-1",
        status: "dismissed",
        deletedAt: null,
        senderEmail: "noreply@dept.example.edu",
        senderDomain: "dept.example.edu",
        draftAction: "notify_only",
      },
    ];
    const { markInboxItemNotNeededAction } = await import(
      "@/app/app/inbox/actions"
    );
    await markInboxItemNotNeededAction(formData("ib-2"));
    expect(recordSenderFeedback).not.toHaveBeenCalled();
    expect(logEmailAudit).not.toHaveBeenCalled();
  });

  it("rejects an empty id without touching the DB", async () => {
    const { markInboxItemNotNeededAction } = await import(
      "@/app/app/inbox/actions"
    );
    await expect(
      markInboxItemNotNeededAction(formData(""))
    ).rejects.toThrow(/invalid id/);
    expect(updateOps).toHaveLength(0);
    expect(recordSenderFeedback).not.toHaveBeenCalled();
  });
});
