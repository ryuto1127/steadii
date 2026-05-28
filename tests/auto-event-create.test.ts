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
            returning: () => Promise.resolve([{ id: "auto-event-row-id-1" }]),
          };
        },
      }),
    },
  };
});

// Consent-first lock: the event orchestrator must NOT import / call the
// calendar tool. The mock stays as a regression guard — any call throws.
vi.mock("@/lib/agent/tools/calendar", () => ({
  calendarCreateEvent: {
    execute: vi.fn().mockRejectedValue(
      new Error(
        "calendarCreateEvent.execute MUST NOT run from the propose orchestrator",
      ),
    ),
  },
}));

import { evaluateAndAddEventIfDetected } from "@/lib/agent/proactive/auto-event-create";

const RECEIVED_MS = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01

const WEBINAR_BODY = [
  "Thanks for signing up — you've registered for our session.",
  "",
  "Date: Thursday, October 8, 2026",
  "Time: 4:00 PM - 5:00 PM Eastern Time",
].join("\n");

function resetMocks(): void {
  mocks.state.userRow = { preferences: {} };
  mocks.state.existingAutoCreates = [];
  mocks.state.insertCalledWith = [];
  mocks.state.selectCallIndex = 0;
}

beforeEach(resetMocks);

describe("evaluateAndAddEventIfDetected — happy path (propose-confirm)", () => {
  it("persists an event-kind 'proposed' TIMED row without calling the calendar tool", async () => {
    const r = await evaluateAndAddEventIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: WEBINAR_BODY,
      subject: "Intro to Systems webinar",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
      receivedAtMs: RECEIVED_MS,
    });

    expect(r.action).toBe("proposed");

    expect(mocks.state.insertCalledWith).toHaveLength(1);
    const inserted = mocks.state.insertCalledWith[0];
    expect(inserted.kind).toBe("event");
    expect(inserted.status).toBe("proposed");
    expect(inserted.eventRefs).toEqual([]);
    expect(inserted.userId).toBe("user-1");
    expect(inserted.inboxItemId).toBe("inbox-1");
    expect(inserted.confidence).toBeGreaterThanOrEqual(0.8);
    const slot = inserted.agreedSlot as {
      date: string;
      startTime: string;
      timezone: string;
      durationMin: number;
      topic?: string;
    };
    expect(slot.date).toBe("2026-10-08");
    expect(slot.startTime).toBe("16:00");
    expect(slot.timezone).toBe("America/New_York");
    // TIMED — a real duration, NOT 0 (the deadline all-day marker).
    expect(slot.durationMin).toBe(60);
    expect(slot.topic).toBe("Intro to Systems webinar");
  });
});

describe("evaluateAndAddEventIfDetected — opt-in / idempotency", () => {
  it("skips when user has opted out", async () => {
    mocks.state.userRow = { preferences: { autoCalendarCreate: false } };
    const r = await evaluateAndAddEventIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: WEBINAR_BODY,
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
      receivedAtMs: RECEIVED_MS,
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/opted out/);
    }
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });

  it("skips when an event-kind row already exists for this inbox_item", async () => {
    mocks.state.existingAutoCreates = [{ id: "prior-event-1" }];
    const r = await evaluateAndAddEventIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: WEBINAR_BODY,
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
      receivedAtMs: RECEIVED_MS,
    });
    expect(r.action).toBe("skipped");
    if (r.action === "skipped") {
      expect(r.reason).toMatch(/already exists/);
    }
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });
});

describe("evaluateAndAddEventIfDetected — detector gating", () => {
  it("skips when no structured signal is present", async () => {
    const r = await evaluateAndAddEventIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: "Let's grab coffee October 8, 2026 around 4:00 PM if you're free?",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      receivedAtMs: RECEIVED_MS,
    });
    expect(r.action).toBe("skipped");
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });

  it("skips when a structured confirmation has a date but no time", async () => {
    const r = await evaluateAndAddEventIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: "You've registered for our session on October 8, 2026.",
      defaultTimezone: "America/New_York",
      referenceYear: 2026,
      receivedAtMs: RECEIVED_MS,
    });
    expect(r.action).toBe("skipped");
    expect(mocks.state.insertCalledWith).toHaveLength(0);
  });
});

describe("evaluateAndAddEventIfDetected — expiry window", () => {
  it("sets grace_expires_at to nowMs + 7 days by default", async () => {
    const baseMs = Date.UTC(2026, 9, 1, 12, 0, 0);
    const r = await evaluateAndAddEventIfDetected({
      userId: "user-1",
      inboxItemId: "inbox-1",
      body: WEBINAR_BODY,
      subject: "Intro to Systems webinar",
      defaultTimezone: "America/Vancouver",
      referenceYear: 2026,
      receivedAtMs: RECEIVED_MS,
      options: { nowMs: baseMs },
    });
    expect(r.action).toBe("proposed");
    if (r.action === "proposed") {
      expect(r.expiresAt.getTime()).toBe(baseMs + 7 * 24 * 60 * 60 * 1000);
    }
  });
});
