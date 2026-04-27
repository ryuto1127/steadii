import { describe, expect, it, vi } from "vitest";

// pending-queries imports the Drizzle client at module load to back the
// async count/list helpers. The pure predicates we exercise here don't
// touch the DB, but the test still needs the module to import cleanly —
// stub the env + client just enough that the import doesn't error.
vi.mock("@/lib/env", () => ({
  env: () => ({ DATABASE_URL: "postgres://test" }),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));

const { compareInboxRows, isPendingDraft } = await import(
  "@/lib/agent/email/pending-queries"
);

// "Pending" is shared between the inbox-list amber-dot marker, the
// sidebar badge count, and the notification bell. Locking the predicate
// in tests keeps every surface aligned on the same definition — the
// glass-box promise breaks if the bell says "3 pending" but the inbox
// list highlights 5 rows.

describe("isPendingDraft", () => {
  it("returns true for status='pending' with a draft_reply action", () => {
    expect(isPendingDraft("pending", "draft_reply")).toBe(true);
  });

  it("returns true for status='pending' with an ask_clarifying action", () => {
    expect(isPendingDraft("pending", "ask_clarifying")).toBe(true);
  });

  // polish-7 — notify_only is the new 2-category-triage Category B path:
  // "important but no reply needed". The user must still see it (so it
  // sorts pending), but the detail page renders no draft form.
  it("returns true for status='pending' with a notify_only action", () => {
    expect(isPendingDraft("pending", "notify_only")).toBe(true);
  });

  it("returns false for status='pending' with a non-confirm action", () => {
    // archive / snooze / no_op resolve themselves; paused needs billing.
    expect(isPendingDraft("pending", "archive")).toBe(false);
    expect(isPendingDraft("pending", "snooze")).toBe(false);
    expect(isPendingDraft("pending", "no_op")).toBe(false);
    expect(isPendingDraft("pending", "paused")).toBe(false);
  });

  it("returns false for any non-pending status", () => {
    for (const status of ["sent", "dismissed", "expired", "approved", "edited", "paused", "sent_pending"]) {
      expect(isPendingDraft(status, "draft_reply")).toBe(false);
    }
  });

  it("returns false when status or action is missing (still-classifying row)", () => {
    expect(isPendingDraft(null, null)).toBe(false);
    expect(isPendingDraft(undefined, undefined)).toBe(false);
    expect(isPendingDraft("pending", null)).toBe(false);
  });
});

describe("compareInboxRows — pending-first ordering", () => {
  // Stable absolute timestamps so the test doesn't drift with Date.now().
  const T = (mins: number): Date => new Date(Date.UTC(2026, 3, 25, 12, 0, 0) + mins * 60_000);

  const pendingRecent = {
    receivedAt: T(10),
    agentDraftStatus: "pending",
    agentDraftAction: "draft_reply",
  };
  const pendingOlder = {
    receivedAt: T(0),
    agentDraftStatus: "pending",
    agentDraftAction: "ask_clarifying",
  };
  const sentVeryRecent = {
    receivedAt: T(20),
    agentDraftStatus: "sent",
    agentDraftAction: "draft_reply",
  };
  const dismissedOldish = {
    receivedAt: T(5),
    agentDraftStatus: "dismissed",
    agentDraftAction: "archive",
  };
  const stillClassifying = {
    receivedAt: T(15),
    agentDraftStatus: null,
    agentDraftAction: null,
  };

  it("places pending rows above all non-pending rows", () => {
    const sorted = [
      sentVeryRecent,
      pendingOlder,
      dismissedOldish,
      pendingRecent,
      stillClassifying,
    ].sort(compareInboxRows);

    expect(sorted.slice(0, 2)).toEqual([pendingRecent, pendingOlder]);
    expect(sorted.slice(2)).toContain(sentVeryRecent);
    expect(sorted.slice(2)).toContain(dismissedOldish);
    expect(sorted.slice(2)).toContain(stillClassifying);
  });

  it("orders pending rows newest-first within the pending group", () => {
    const sorted = [pendingOlder, pendingRecent].sort(compareInboxRows);
    expect(sorted).toEqual([pendingRecent, pendingOlder]);
  });

  it("orders non-pending rows newest-first within the non-pending group", () => {
    const sorted = [dismissedOldish, sentVeryRecent, stillClassifying].sort(
      compareInboxRows
    );
    expect(sorted).toEqual([sentVeryRecent, stillClassifying, dismissedOldish]);
  });

  it("does not promote a still-classifying row above pending rows even when newer", () => {
    // Regression: an inbox_item that hasn't been processed by L2 yet has
    // a NULL agent_draft join. Those should not jump ahead of explicit
    // pending rows just because they arrived more recently.
    const sorted = [stillClassifying, pendingRecent].sort(compareInboxRows);
    expect(sorted[0]).toBe(pendingRecent);
    expect(sorted[1]).toBe(stillClassifying);
  });
});

// polish-7 — Gmail-style read state widens the comparator's group key
// from 2-state (pending vs not) to 3-state (pending → unread non-pending
// → read non-pending). Within each group, newest first.
describe("compareInboxRows — 3-state read tracking", () => {
  const T = (mins: number): Date => new Date(Date.UTC(2026, 3, 25, 12, 0, 0) + mins * 60_000);

  const pendingNew = {
    receivedAt: T(0),
    agentDraftStatus: "pending",
    agentDraftAction: "draft_reply",
    reviewedAt: null,
  };
  const unreadOld = {
    receivedAt: T(-60),
    agentDraftStatus: "sent",
    agentDraftAction: "draft_reply",
    reviewedAt: null,
  };
  const readNew = {
    receivedAt: T(10),
    agentDraftStatus: "sent",
    agentDraftAction: "draft_reply",
    reviewedAt: T(11),
  };
  const readOlder = {
    receivedAt: T(-30),
    agentDraftStatus: "sent",
    agentDraftAction: "draft_reply",
    reviewedAt: T(-20),
  };
  const pendingOld = {
    receivedAt: T(-90),
    agentDraftStatus: "pending",
    agentDraftAction: "notify_only",
    reviewedAt: T(-89),
  };

  it("orders rows pending → unread non-pending → read non-pending", () => {
    const sorted = [readOlder, readNew, unreadOld, pendingOld, pendingNew].sort(
      compareInboxRows
    );
    // Group 0 (pending) — newest first inside
    expect(sorted[0]).toBe(pendingNew);
    expect(sorted[1]).toBe(pendingOld);
    // Group 1 (unread non-pending)
    expect(sorted[2]).toBe(unreadOld);
    // Group 2 (read non-pending) — newest first inside
    expect(sorted[3]).toBe(readNew);
    expect(sorted[4]).toBe(readOlder);
  });

  it("treats a notify_only pending row exactly like a draft_reply pending row", () => {
    // Both sit in group 0 — neither demoted regardless of reviewedAt.
    const a = {
      receivedAt: T(5),
      agentDraftStatus: "pending",
      agentDraftAction: "notify_only",
      reviewedAt: T(6), // even reviewed, still pending
    };
    const b = {
      receivedAt: T(0),
      agentDraftStatus: "sent",
      agentDraftAction: "draft_reply",
      reviewedAt: null, // unread but not pending
    };
    const sorted = [b, a].sort(compareInboxRows);
    expect(sorted[0]).toBe(a);
    expect(sorted[1]).toBe(b);
  });
});
