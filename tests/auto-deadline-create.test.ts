import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

const mocks = vi.hoisted(() => ({
  state: {
    userRow: null as { preferences: { autoCalendarCreate?: boolean } | null } | null,
    existingAutoCreates: [] as Array<{ id: string }>,
    insertCalledWith: [] as Array<Record<string, unknown>>,
    selectCallIndex: 0,
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
      select: () => {
        const idx = mocks.state.selectCallIndex++;
        if (idx === 0) {
          return chain(mocks.state.userRow ? [mocks.state.userRow] : []);
        }
        return chain(mocks.state.existingAutoCreates);
      },
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          mocks.state.insertCalledWith.push(vals);
          return {
            returning: () => Promise.resolve([{ id: "auto-deadline-row-id-1" }]),
          };
        },
      }),
    },
  };
});

vi.mock("@/lib/agent/tools/calendar", () => ({
  calendarCreateEvent: {
    execute: vi.fn().mockRejectedValue(
      new Error("calendarCreateEvent.execute should not run in unit tests"),
    ),
  },
}));

import { evaluateAndAddDeadlineIfDetected } from "@/lib/agent/proactive/auto-deadline-create";

function resetMocks(): void {
  mocks.state.userRow = { preferences: {} };
  mocks.state.existingAutoCreates = [];
  mocks.state.insertCalledWith = [];
  mocks.state.selectCallIndex = 0;
}

beforeEach(resetMocks);

describe("evaluateAndAddDeadlineIfDetected — happy path", () => {
  it("auto-adds an all-day event with [Steadii] prefix when a strong deadline is detected", async () => {
    const calendarMock = vi.fn().mockResolvedValue({
      eventId: "evt-deadline-1",
      htmlLink: "https://calendar.example.com/evt-1",
      createdIn: ["google_calendar"],
    });

    const r = await evaluateAndAddDeadlineIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: "課題の提出期限は 5/30 までとなります。",
      subject: "PSY100 提出のご連絡",
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
    expect(callArgs.summary).toContain("締切");
    expect(callArgs.start).toBe("2026-05-30");
    expect(callArgs.end).toBe("2026-05-30");
    expect(callArgs.description).toMatch(/Deadline:/);

    expect(mocks.state.insertCalledWith).toHaveLength(1);
    const inserted = mocks.state.insertCalledWith[0];
    expect(inserted.kind).toBe("deadline");
    expect(inserted.userId).toBe("user-1");
    expect(inserted.inboxItemId).toBe("inbox-1");
    expect(inserted.confidence).toBeGreaterThanOrEqual(0.8);
    const slot = inserted.agreedSlot as { date: string; durationMin: number };
    expect(slot.date).toBe("2026-05-30");
    expect(slot.durationMin).toBe(0);
  });
});

describe("evaluateAndAddDeadlineIfDetected — opt-in / idempotency", () => {
  it("skips when user has opted out", async () => {
    mocks.state.userRow = { preferences: { autoCalendarCreate: false } };
    const calendarMock = vi.fn();
    const r = await evaluateAndAddDeadlineIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: "提出期限は 5/30 までです。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/opted out/);
    }
    expect(calendarMock).not.toHaveBeenCalled();
  });

  it("skips when a deadline-kind row already exists for this inbox_item", async () => {
    mocks.state.existingAutoCreates = [{ id: "prior-deadline-1" }];
    const calendarMock = vi.fn();
    const r = await evaluateAndAddDeadlineIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: "提出期限は 5/30 までです。",
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

describe("evaluateAndAddDeadlineIfDetected — detector gating", () => {
  it("skips when no deadline is detected in the body", async () => {
    const calendarMock = vi.fn();
    const r = await evaluateAndAddDeadlineIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: "ご連絡ありがとうございます。引き続きよろしくお願いします。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });
    expect(r.action).toBe("skipped");
    expect(calendarMock).not.toHaveBeenCalled();
  });

  it("skips on a hedged 'できれば by X' phrasing (single-sided false-positive guard)", async () => {
    const calendarMock = vi.fn();
    const r = await evaluateAndAddDeadlineIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: "できれば 5/30 までにご対応いただけると幸いです。",
      defaultTimezone: "Asia/Tokyo",
      referenceYear: 2026,
      options: { calendarCreate: calendarMock },
    });
    expect(r.action).toBe("skipped");
    expect(calendarMock).not.toHaveBeenCalled();
  });
});
