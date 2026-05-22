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

// Block the production calendar tool from being reachable at import
// time — the evaluator's default fallback would try to touch
// google-auth. Tests inject `calendarCreate` instead.
vi.mock("@/lib/agent/tools/calendar", () => ({
  calendarCreateEvent: {
    execute: vi.fn().mockRejectedValue(
      new Error("calendarCreateEvent.execute should not run in unit tests"),
    ),
  },
}));

// Import AFTER mocks so module-scope side-effects pick them up.
import {
  evaluateAndCreateIfAgreed,
  buildIsoStartEnd,
} from "@/lib/agent/proactive/auto-calendar-create";
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
    subject: "面接日程のご案内",
    body: "5/22 14:00 / 5/23 10:00 のどちらかでいかがでしょうか。",
  },
  {
    direction: "outbound",
    sentAt: "2026-05-19T15:00:00Z",
    subject: "Re: 面接日程のご案内",
    body: "5/22(水) 14:00 JST でお願いいたします。",
  },
  {
    direction: "inbound",
    sentAt: "2026-05-20T01:00:00Z",
    subject: "Re: Re: 面接日程のご案内",
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
      options: { calendarCreate: vi.fn() },
    });

    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/opted out/);
    }
  });

  it("opts in by default when preferences.autoCalendarCreate is undefined", async () => {
    mocks.state.userRow = { preferences: {} };
    const calendarMock = vi.fn().mockResolvedValue({
      eventId: "evt-1",
      htmlLink: "https://calendar.example.com/evt-1",
      createdIn: ["google_calendar"],
    });

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });

    expect(r.action).toBe("created");
    expect(calendarMock).toHaveBeenCalledOnce();
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
      options: { calendarCreate: vi.fn() },
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
    const calendarMock = vi.fn();

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });

    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/already exists/);
    }
    expect(calendarMock).not.toHaveBeenCalled();
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
    const calendarMock = vi.fn();

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: ambiguousThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });

    expect(r.action).toBe("skipped");
    expect(calendarMock).not.toHaveBeenCalled();
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
    const calendarMock = vi.fn();

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: counterThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });

    expect(r.action).toBe("skipped");
    expect(calendarMock).not.toHaveBeenCalled();
  });

  it("respects a custom threshold higher than the detector's confidence", async () => {
    const calendarMock = vi.fn();
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { threshold: 0.99, calendarCreate: calendarMock },
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/below threshold/);
    }
  });
});

describe("evaluateAndCreateIfAgreed — happy path", () => {
  it("calls the calendar tool with [Steadii] prefix and persists when mutual agreement is detected", async () => {
    const calendarMock = vi.fn().mockResolvedValue({
      eventId: "evt-google-1",
      htmlLink: "https://calendar.example.com/evt-google-1",
      createdIn: ["google_calendar"],
    });

    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });

    expect(r.action).toBe("created");
    expect(calendarMock).toHaveBeenCalledOnce();

    const callArgs = calendarMock.mock.calls[0][0] as {
      userId: string;
      summary: string;
      start: string;
      end: string;
      description: string;
    };
    expect(callArgs.userId).toBe("user-1");
    expect(callArgs.summary.startsWith("[Steadii] ")).toBe(true);
    // The agreed slot is 5/22 14:00 Asia/Tokyo. RFC3339 with +09:00.
    expect(callArgs.start).toMatch(/^2026-05-22T14:00:00\+09:00$/);
    // Default duration 60 min → end = 15:00 JST.
    expect(callArgs.end).toMatch(/^2026-05-22T15:00:00\+09:00$/);
    expect(callArgs.description).toMatch(/Auto-created by Steadii/);

    // Persistence row inserted with correct fields.
    expect(mocks.state.insertCalledWith).toHaveLength(1);
    const inserted = mocks.state.insertCalledWith[0];
    expect(inserted.userId).toBe("user-1");
    expect(inserted.inboxItemId).toBe("inbox-1");
    expect(inserted.confidence).toBeGreaterThanOrEqual(0.8);
    expect((inserted.agreedSlot as { date: string }).date).toBe("2026-05-22");
  });

  it("dry-run mode returns 'skipped' without calling calendar or persisting", async () => {
    const calendarMock = vi.fn();
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { dryRun: true, calendarCreate: calendarMock },
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/dry-run/);
    }
    expect(calendarMock).not.toHaveBeenCalled();
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });

  it("uses the inbound subject (Re: stripped) for the event title", async () => {
    const calendarMock = vi.fn().mockResolvedValue({
      eventId: "evt-1",
      htmlLink: null,
      createdIn: ["google_calendar"],
    });
    await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });
    const callArgs = calendarMock.mock.calls[0][0] as { summary: string };
    expect(callArgs.summary).toBe("[Steadii] 面接日程のご案内");
  });

  it("sets grace_expires_at to nowMs + 24h by default", async () => {
    const calendarMock = vi.fn().mockResolvedValue({
      eventId: "evt-1",
      htmlLink: null,
      createdIn: ["google_calendar"],
    });
    const baseMs = Date.UTC(2026, 4, 20, 12, 0, 0); // 2026-05-20 12:00 UTC
    const r = await evaluateAndCreateIfAgreed({
      userId: "user-1",
      inboxItemId: "inbox-1",
      thread: happyThread,
      userTimezone: "America/Vancouver",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock, nowMs: baseMs },
    });
    expect(r.action).toBe("created");
    if (r.action === "created") {
      expect(r.graceExpiresAt.getTime()).toBe(baseMs + 24 * 60 * 60 * 1000);
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
