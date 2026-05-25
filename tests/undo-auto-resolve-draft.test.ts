import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-24 — Round 5 notify-with-undo. Tests for
// undoAutoResolveDraftAction. Covers:
//   - successful undo (notification + draft both flipped)
//   - refusal on expired window
//   - refusal on cross-user notification id
//   - refusal when the draft has been re-modified
//   - refusal on unknown / missing notification id
//   - audit row written on success
//
// All synthetic data — no real subjects, senders, dates (per AGENTS.md §7a).

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("server-only", () => ({}));

// Auth: the user matches notification.user_id in seeded rows; mismatch
// is exercised by changing the seeded user_id.
vi.mock("@/lib/auth/config", () => ({
  auth: async () => ({ user: { id: "user-undo-test" } }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

type NotifRow = {
  id: string;
  userId: string;
  kind: string;
  subjectTable: string;
  subjectId: string;
  undoableUntil: Date | null;
};

type DraftRow = {
  id: string;
  userId: string;
  status: string;
  disposition: string;
};

const mocks = vi.hoisted(() => ({
  state: {
    notifs: [] as Array<{
      id: string;
      userId: string;
      kind: string;
      subjectTable: string;
      subjectId: string;
      undoableUntil: Date | null;
    }>,
    drafts: [] as Array<{
      id: string;
      userId: string;
      status: string;
      disposition: string;
    }>,
    updates: [] as Array<{ table: string; vals: Record<string, unknown> }>,
    audits: [] as Array<Record<string, unknown>>,
    // Current SELECT discriminator. We can't introspect the drizzle
    // schema object here cheaply; instead the production code calls
    // .from(agentNotifications) then .from(agentDrafts) in fixed
    // order. We toggle a counter to return the right row set.
    nextSelectTable: "notif" as "notif" | "draft",
    // Symmetric counter for UPDATEs: notif update is second, draft is
    // first.
    nextUpdateTable: "draft" as "draft" | "notif",
  },
}));

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
  return {
    db: {
      select: () => ({
        from: () => {
          // Determine which select is happening by counter; flip
          // after the read.
          const table = mocks.state.nextSelectTable;
          mocks.state.nextSelectTable =
            table === "notif" ? "draft" : "notif";
          const rows =
            table === "notif"
              ? mocks.state.notifs.map((n) => ({
                  id: n.id,
                  kind: n.kind,
                  subjectTable: n.subjectTable,
                  subjectId: n.subjectId,
                  undoableUntil: n.undoableUntil,
                }))
              : mocks.state.drafts.map((d) => ({
                  id: d.id,
                  status: d.status,
                }));
          return {
            where: () => ({
              limit: () => Promise.resolve(rows),
            }),
          };
        },
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            const table = mocks.state.nextUpdateTable;
            mocks.state.nextUpdateTable =
              table === "draft" ? "notif" : "draft";
            mocks.state.updates.push({ table, vals });
          },
        }),
      }),
      insert: () => ({
        values: async (vals: Record<string, unknown>) => {
          mocks.state.audits.push(vals);
        },
      }),
    },
  };
});

import { undoAutoResolveDraftAction } from "@/app/app/activity/actions";

const TEST_USER = "user-undo-test";
const NOTIF_ID = "11111111-1111-4111-8111-111111111101";
const DRAFT_ID = "22222222-2222-4222-8222-222222222201";

function seedHappy(opts: { now?: Date; userOverride?: string } = {}) {
  const now = opts.now ?? new Date();
  const future = new Date(now.getTime() + 60 * 60 * 1000); // +1h
  mocks.state.notifs = [
    {
      id: NOTIF_ID,
      userId: opts.userOverride ?? TEST_USER,
      kind: "auto_resolved_draft",
      subjectTable: "agent_drafts",
      subjectId: DRAFT_ID,
      undoableUntil: future,
    },
  ];
  mocks.state.drafts = [
    {
      id: DRAFT_ID,
      userId: opts.userOverride ?? TEST_USER,
      status: "superseded_by_user_send",
      disposition: "resolved",
    },
  ];
}

beforeEach(() => {
  mocks.state.notifs = [];
  mocks.state.drafts = [];
  mocks.state.updates = [];
  mocks.state.audits = [];
  mocks.state.nextSelectTable = "notif";
  mocks.state.nextUpdateTable = "draft";
});

describe("undoAutoResolveDraftAction — happy path", () => {
  it("flips the draft back to pending/active and consumes the notification", async () => {
    seedHappy();
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: true });
    expect(mocks.state.updates).toHaveLength(2);
    // Draft update first.
    const draftUpdate = mocks.state.updates[0]!;
    expect(draftUpdate.table).toBe("draft");
    expect(draftUpdate.vals.status).toBe("pending");
    expect(draftUpdate.vals.disposition).toBe("active");
    // Notification update next.
    const notifUpdate = mocks.state.updates[1]!;
    expect(notifUpdate.table).toBe("notif");
    expect(notifUpdate.vals.undoableUntil).toBeNull();
    expect(notifUpdate.vals.dismissedAt).toBeInstanceOf(Date);
  });

  it("writes a draft_auto_resolve_undone audit row on success", async () => {
    seedHappy();
    await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(mocks.state.audits).toHaveLength(1);
    const a = mocks.state.audits[0]!;
    expect(a.action).toBe("draft_auto_resolve_undone");
    expect(a.result).toBe("success");
    expect(a.resourceId).toBe(DRAFT_ID);
    const detail = a.detail as Record<string, unknown>;
    expect(detail.notificationId).toBe(NOTIF_ID);
  });
});

describe("undoAutoResolveDraftAction — refusal paths", () => {
  it("refuses with not_found when the notification id doesn't exist", async () => {
    // No seeds — both selects return [].
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: false, reason: "not_found" });
    expect(mocks.state.updates).toHaveLength(0);
    expect(mocks.state.audits).toHaveLength(0);
  });

  it("refuses with not_found when the notification belongs to another user", async () => {
    // Production WHERE filters by user_id, so the mock returns [] for
    // a cross-user fetch. We simulate that by leaving notifs empty.
    seedHappy({ userOverride: "user-other" });
    mocks.state.notifs = [];
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses with expired when undoable_until is in the past", async () => {
    seedHappy();
    mocks.state.notifs[0]!.undoableUntil = new Date(Date.now() - 60 * 1000);
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: false, reason: "expired" });
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("refuses with expired when undoable_until is null", async () => {
    seedHappy();
    mocks.state.notifs[0]!.undoableUntil = null;
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses with draft_modified when the draft is no longer superseded", async () => {
    seedHappy();
    mocks.state.drafts[0]!.status = "sent";
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: false, reason: "draft_modified" });
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("refuses with draft_modified when the draft row is missing entirely", async () => {
    seedHappy();
    mocks.state.drafts = [];
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: false, reason: "draft_modified" });
  });

  it("refuses with wrong_kind when the notification is of another kind", async () => {
    seedHappy();
    mocks.state.notifs[0]!.kind = "auto_archived_thing";
    const out = await undoAutoResolveDraftAction({ notificationId: NOTIF_ID });
    expect(out).toEqual({ ok: false, reason: "wrong_kind" });
  });
});
