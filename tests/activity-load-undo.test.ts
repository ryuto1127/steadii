import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-24 — Round 5 notify-with-undo. The activity loader pulls
// agent_notifications rows of kind='auto_resolved_draft' and emits
// undoableNotificationId on rows whose 24h window is still open.
//
// All synthetic data — no real subjects, senders, dates.

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

const mocks = vi.hoisted(() => ({
  state: {
    notifs: [] as Array<{
      id: string;
      kind: string;
      subjectId: string;
      summary: string;
      createdAt: Date;
      undoableUntil: Date | null;
    }>,
    // Other source rows are stubbed empty — we only care about
    // the agent_notifications branch here.
    selectCount: 0,
  },
}));

vi.mock("@/lib/db/client", () => {
  // The loader makes several SELECTs; we discriminate on a counter so
  // only the notifs select returns rows. Order in lib/activity/load.ts:
  //   1. proposals  (try/catch — empty is fine)
  //   2. drafts     (no try/catch)
  //   3. notifs     ← we want this one
  //   4. audit log  (try/catch)
  const chain = (rows: unknown[]) => {
    const promise = Promise.resolve(rows);
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
      select: () => {
        const idx = ++mocks.state.selectCount;
        // The notifs SELECT is the 3rd one (proposals, drafts, notifs).
        // Other selects → empty.
        if (idx === 3) return chain(mocks.state.notifs);
        return chain([]);
      },
    },
  };
});

import { loadActivityRows } from "@/lib/activity/load";

beforeEach(() => {
  mocks.state.notifs = [];
  mocks.state.selectCount = 0;
});

describe("loadActivityRows — Round 5 notification surfacing", () => {
  it("emits a row for each agent_notifications.auto_resolved_draft", async () => {
    mocks.state.notifs = [
      {
        id: "notif-1",
        kind: "auto_resolved_draft",
        subjectId: "draft-1",
        summary: "Auto-resolved draft for Synthetic subject",
        createdAt: new Date("2026-05-23T12:00:00Z"),
        undoableUntil: new Date(Date.now() + 60 * 60 * 1000),
      },
    ];
    const { rows } = await loadActivityRows({ userId: "user-a" });
    const notifRows = rows.filter((r) => r.kind === "auto_resolved_draft");
    expect(notifRows).toHaveLength(1);
    expect(notifRows[0]!.id).toBe("notif:notif-1");
    expect(notifRows[0]!.primary).toBe(
      "Auto-resolved draft for Synthetic subject",
    );
    expect(notifRows[0]!.detailHref).toBe("/app/inbox/draft-1");
  });

  it("sets undoableNotificationId when undoable_until is in the future", async () => {
    mocks.state.notifs = [
      {
        id: "notif-undoable",
        kind: "auto_resolved_draft",
        subjectId: "draft-x",
        summary: "Auto-resolved draft for X",
        createdAt: new Date("2026-05-23T12:00:00Z"),
        undoableUntil: new Date(Date.now() + 60 * 60 * 1000),
      },
    ];
    const { rows } = await loadActivityRows({ userId: "user-a" });
    const r = rows.find((r) => r.id === "notif:notif-undoable");
    expect(r?.undoableNotificationId).toBe("notif-undoable");
  });

  it("does NOT set undoableNotificationId when undoable_until is in the past", async () => {
    mocks.state.notifs = [
      {
        id: "notif-expired",
        kind: "auto_resolved_draft",
        subjectId: "draft-y",
        summary: "Auto-resolved draft for Y",
        createdAt: new Date("2026-05-22T12:00:00Z"),
        undoableUntil: new Date(Date.now() - 60 * 60 * 1000),
      },
    ];
    const { rows } = await loadActivityRows({ userId: "user-a" });
    const r = rows.find((r) => r.id === "notif:notif-expired");
    expect(r).toBeDefined();
    expect(r?.undoableNotificationId).toBeUndefined();
  });

  it("does NOT set undoableNotificationId when undoable_until is null", async () => {
    mocks.state.notifs = [
      {
        id: "notif-null",
        kind: "auto_resolved_draft",
        subjectId: "draft-z",
        summary: "Auto-resolved draft for Z",
        createdAt: new Date("2026-05-22T12:00:00Z"),
        undoableUntil: null,
      },
    ];
    const { rows } = await loadActivityRows({ userId: "user-a" });
    const r = rows.find((r) => r.id === "notif:notif-null");
    expect(r).toBeDefined();
    expect(r?.undoableNotificationId).toBeUndefined();
  });
});
