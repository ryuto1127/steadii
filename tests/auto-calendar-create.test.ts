import { beforeEach, describe, expect, it, vi } from "vitest";

// Env stub — needed by lib/db/client.ts import chain.
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

// Hoisted shared state so the (also-hoisted) vi.mock factory below can
// close over it. Without `vi.hoisted` the factory runs before any
// module-scope const initializes.
const mocks = vi.hoisted(() => {
  type UserRow = {
    preferences: { autoCalendarCreate?: boolean } | null;
  };
  return {
    state: {
      userRow: null as UserRow | null,
      existingAutoCreates: [] as Array<{ id: string }>,
      insertCalledWith: [] as Array<Record<string, unknown>>,
      selectCallIndex: 0,
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

  return {
    db: {
      select: () => {
        const idx = mocks.state.selectCallIndex++;
        // First select() in the evaluator is users → preferences.
        if (idx === 0) {
          return chain(mocks.state.userRow ? [mocks.state.userRow] : []);
        }
        // Second select() is the idempotency lookup.
        return chain(mocks.state.existingAutoCreates);
      },
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          mocks.state.insertCalledWith.push(vals);
          return {
            returning: () =>
              Promise.resolve([{ id: "auto-create-row-id-1" }]),
          };
        },
      }),
    },
  };
});

// Round-3 propose-confirm: the orchestrator no longer imports the
// calendar tool. The mock stays as a belt-and-suspenders guard so a
// regression that brings the import back is caught loudly.
vi.mock("@/lib/agent/tools/calendar", () => ({
  calendarCreateEvent: {
    execute: vi.fn().mockRejectedValue(
      new Error(
        "calendarCreateEvent.execute MUST NOT run from the propose orchestrator",
      ),
    ),
  },
}));

// Import AFTER mocks so module-scope side-effects pick them up.
import { evaluateAndCreateIfAgreed } from "@/lib/agent/proactive/auto-calendar-create";
import { buildIsoStartEnd } from "@/lib/agent/proactive/auto-cal-slot";
import type { EmailSnapshot } from "@/lib/agent/proactive/mutual-agreement-detector";

function resetMocks(): void {
  mocks.state.userRow = { preferences: {} }; // opted in by default
  mocks.state.existingAutoCreates = [];
  mocks.state.insertCalledWith = [];
  mocks.state.selectCallIndex = 0;
}

beforeEach(() => {
  resetMocks();
});

const happyThread: EmailSnapshot[] = [
  {
    direction: "inbound",
    sentAt: "2026-05-19T08:00:00Z",
    subject: "Interview schedule",
    body: "5/22 14:00 / 5/23 10:00 のどちらかでいかがでしょうか。",
  },
  {
    direction: "outbound",
    sentAt: "2026-05-19T15:00:00Z",
    subject: "Re: Interview schedule",
    body: "5/22(水) 14:00 JST でお願いいたします。",
  },
  {
    direction: "inbound",
    sentAt: "2026-05-20T01:00:00Z",
    subject: "Re: Re: Interview schedule",
    body: "承知いたしました。当日はよろしくお願いいたします。",
  },
];

describe("evaluateAndCreateIfAgreed — opt-in gate", () => {
  it("skips when user has opted out (preferences.autoCalendarCreate = false)", async () => {
    mocks.state.userRow = { preferences: { autoCalendarCreate: false } };

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });

    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/opted out/);
    }
  });

  it("opts in by default when preferences.autoCalendarCreate is undefined", async () => {
    mocks.state.userRow = { preferences: {} };

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });

    expect(r.action).toBe("proposed");
    expect(mocks.state.insertCalledWith).toHaveLength(1);
  });

  it("skips when the user row is missing", async () => {
    mocks.state.userRow = null;
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-missing",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/user not found/);
    }
  });
});

describe("evaluateAndCreateIfAgreed — idempotency", () => {
  it("skips when a non-cancelled auto-create already exists for this inbox_item", async () => {
    mocks.state.existingAutoCreates = [{ id: "prior-auto-create-1" }];

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });

    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/already exists/);
    }
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });
});

describe("evaluateAndCreateIfAgreed — detector gating", () => {
  it("skips when the thread shows no mutual agreement", async () => {
    const ambiguousThread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "ご連絡いただきありがとうございます。",
      },
    ];

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: ambiguousThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });

    expect(r.action).toBe("skipped");
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });

  it("skips when the inbound contains a counter-proposal (kill switch)", async () => {
    const counterThread: EmailSnapshot[] = [
      {
        direction: "outbound",
        sentAt: "2026-05-19T15:00:00Z",
        body: "5/22 14:00 JST でお願いいたします。",
      },
      {
        direction: "inbound",
        sentAt: "2026-05-20T01:00:00Z",
        body: "申し訳ございません、別の日程で改めてご調整いただけますでしょうか。",
      },
    ];

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: counterThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });

    expect(r.action).toBe("skipped");
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });

  it("respects a custom threshold higher than the detector's confidence", async () => {
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { threshold: 0.99 },
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/below threshold/);
    }
  });
});

describe("evaluateAndCreateIfAgreed — happy path (propose-confirm)", () => {
  it("persists a 'proposed' row with empty event_refs and does NOT call the calendar tool", async () => {
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
    });

    expect(r.action).toBe("proposed");

    // Persistence row inserted with correct fields. The calendar tool
    // mock is configured to throw if executed; the test would fail
    // loudly if the propose path ever calls it.
    expect(mocks.state.insertCalledWith).toHaveLength(1);
    const inserted = mocks.state.insertCalledWith[0];
    expect(inserted.userId).toBe("user-1");
    expect(inserted.inboxItemId).toBe("inbox-1");
    expect(inserted.status).toBe("proposed");
    expect(inserted.eventRefs).toEqual([]);
    expect(inserted.confidence).toBeGreaterThanOrEqual(0.8);
    expect((inserted.agreedSlot as { date: string }).date).toBe("2026-05-22");
  });

  it("dry-run mode returns 'skipped' without persisting", async () => {
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { dryRun: true },
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/dry-run/);
    }
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });

  it("sets grace_expires_at to nowMs + 7d by default (expiry, not grace)", async () => {
    const baseMs = Date.UTC(2026, 4, 20, 12, 0, 0); // 2026-05-20 12:00 UTC
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { nowMs: baseMs },
    });
    expect(r.action).toBe("proposed");
    if (r.action === "proposed") {
      expect(r.expiresAt.getTime()).toBe(baseMs + 7 * 24 * 60 * 60 * 1000);
    }
  });
});

describe("buildIsoStartEnd", () => {
  it("converts wall-clock JST 14:00 to RFC3339 with +09:00 offset", () => {
    const r = buildIsoStartEnd({
      date: "2026-05-22",
      startTime: "14:00",
      timezone: "Asia/Tokyo",
      durationMin: 60,
    });
    expect(r.startIso).toBe("2026-05-22T14:00:00+09:00");
    expect(r.endIso).toBe("2026-05-22T15:00:00+09:00");
  });

  it("converts wall-clock PDT 23:00 to RFC3339 with -07:00 offset", () => {
    const r = buildIsoStartEnd({
      date: "2026-05-22",
      startTime: "23:00",
      timezone: "America/Vancouver",
      durationMin: 30,
    });
    expect(r.startIso).toMatch(/^2026-05-22T23:00:00-07:00$/);
    // 30 min later → 23:30 still in PDT.
    expect(r.endIso).toMatch(/^2026-05-22T23:30:00-07:00$/);
  });

  it("handles end crossing into next day", () => {
    const r = buildIsoStartEnd({
      date: "2026-05-22",
      startTime: "23:30",
      timezone: "Asia/Tokyo",
      durationMin: 60,
    });
    expect(r.startIso).toBe("2026-05-22T23:30:00+09:00");
    // 60 min later → 00:30 next day.
    expect(r.endIso).toBe("2026-05-23T00:30:00+09:00");
  });
});
