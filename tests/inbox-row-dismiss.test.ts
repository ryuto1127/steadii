import { beforeEach, describe, expect, it, vi } from "vitest";

// WS2 Part B — the inbox list row-level 見送る (Skip) action. A NEUTRAL clear:
// it flips inbox_items.status to the existing 'dismissed' value so the row
// drops out of the open inbox queries, and does NOTHING ELSE. In particular it
// must never feed a learning signal: no sender-confidence write, no proactive/
// sender feedback, no agent_ignored_senders mutation. Those stay behind the
// explicit 今後は通知しない path.
//
// All synthetic — no real ids/senders/subjects (AGENTS.md §7a).

vi.mock("server-only", () => ({}));

vi.mock("@/lib/auth/config", () => ({
  auth: () => Promise.resolve({ user: { id: "user-1" } }),
}));

const logEmailAudit = vi.fn();
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: (...args: unknown[]) => logEmailAudit(...args),
}));

// The restore helper is imported by the same actions module but is unrelated
// to this action — stub it so the module loads.
vi.mock("@/lib/agent/email/auto-archive", () => ({
  restoreFromAutoArchive: vi.fn(),
}));

// Learning-surface guards: if any of these are ever called the test fails.
// The dismiss action must not touch them.
const recordSenderFeedback = vi.fn();
const recordProactiveFeedback = vi.fn();
const adjustSenderConfidence = vi.fn();
const addIgnoredSender = vi.fn();
vi.mock("@/lib/agent/email/feedback", () => ({
  recordSenderFeedback: (...a: unknown[]) => recordSenderFeedback(...a),
  recordProactiveFeedback: (...a: unknown[]) => recordProactiveFeedback(...a),
  adjustSenderConfidence: (...a: unknown[]) => adjustSenderConfidence(...a),
  addIgnoredSender: (...a: unknown[]) => addIgnoredSender(...a),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: { id: {}, userId: {}, status: {}, deletedAt: {} },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  isNull: (col: unknown) => ({ __isNull: col }),
}));

type FakeRow = {
  id: string;
  userId: string;
  status: "open" | "snoozed" | "dismissed" | "archived" | "sent";
  deletedAt: Date | null;
};

const fixture = {
  rows: [] as FakeRow[],
};

const updateOps: Array<{
  table: "inboxItems";
  patch: Record<string, unknown>;
  returnedIds: string[];
}> = [];

vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: () => ({
          // The action only matches OPEN, non-deleted rows for the user.
          // Mirror that predicate so `returning()` reflects what would flip.
          returning: async () => {
            const matched = fixture.rows.filter(
              (r) =>
                r.userId === "user-1" &&
                r.status === "open" &&
                r.deletedAt === null
            );
            for (const r of matched) r.status = "dismissed";
            const returnedIds = matched.map((r) => r.id);
            updateOps.push({ table: "inboxItems", patch, returnedIds });
            return matched.map((r) => ({ id: r.id }));
          },
        }),
      }),
    }),
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
  recordProactiveFeedback.mockClear();
  adjustSenderConfidence.mockClear();
  addIgnoredSender.mockClear();
});

describe("dismissInboxItemAction — neutral row clear", () => {
  it("flips the row's status to 'dismissed'", async () => {
    fixture.rows = [
      { id: "ib-1", userId: "user-1", status: "open", deletedAt: null },
    ];
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await dismissInboxItemAction(formData("ib-1"));

    expect(updateOps).toHaveLength(1);
    expect(updateOps[0].patch.status).toBe("dismissed");
    expect(fixture.rows[0].status).toBe("dismissed");
  });

  it("never records sender feedback, sender-confidence, or ignored-senders", async () => {
    fixture.rows = [
      { id: "ib-1", userId: "user-1", status: "open", deletedAt: null },
    ];
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await dismissInboxItemAction(formData("ib-1"));

    expect(recordSenderFeedback).not.toHaveBeenCalled();
    expect(recordProactiveFeedback).not.toHaveBeenCalled();
    expect(adjustSenderConfidence).not.toHaveBeenCalled();
    expect(addIgnoredSender).not.toHaveBeenCalled();
  });

  it("writes a single neutral audit row (email_item_dismissed, no learning detail)", async () => {
    fixture.rows = [
      { id: "ib-1", userId: "user-1", status: "open", deletedAt: null },
    ];
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await dismissInboxItemAction(formData("ib-1"));

    expect(logEmailAudit).toHaveBeenCalledTimes(1);
    const arg = logEmailAudit.mock.calls[0][0] as {
      userId: string;
      action: string;
      result: string;
      resourceId: string;
      detail: Record<string, unknown>;
    };
    expect(arg.action).toBe("email_item_dismissed");
    expect(arg.result).toBe("success");
    expect(arg.userId).toBe("user-1");
    expect(arg.resourceId).toBe("ib-1");
    // Detail must carry only a benign source tag — no sender/feedback fields.
    expect(arg.detail).toEqual({ source: "inbox_list_row" });
  });

  it("is idempotent: no audit row when nothing flipped (already cleared)", async () => {
    fixture.rows = [
      { id: "ib-1", userId: "user-1", status: "dismissed", deletedAt: null },
    ];
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await dismissInboxItemAction(formData("ib-1"));

    // The update matched nothing → returning() empty → no audit.
    expect(updateOps[0].returnedIds).toHaveLength(0);
    expect(logEmailAudit).not.toHaveBeenCalled();
  });

  it("rejects an empty id without touching the DB", async () => {
    const { dismissInboxItemAction } = await import("@/app/app/inbox/actions");
    await expect(dismissInboxItemAction(formData(""))).rejects.toThrow(
      /invalid id/
    );
    expect(updateOps).toHaveLength(0);
    expect(logEmailAudit).not.toHaveBeenCalled();
  });
});
