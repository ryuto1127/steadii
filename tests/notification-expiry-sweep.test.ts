import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-24 — Round 5 notify-with-undo. Tests for the
// notification-expiry sub-sweep. Pure DB UPDATE that clears
// undoable_until on rows past their reversibility window. The row
// stays visible in the activity feed without the undo button.

vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  state: {
    updateCount: 0,
    updateSet: undefined as Record<string, unknown> | undefined,
  },
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        mocks.state.updateSet = vals;
        return {
          where: () => ({
            returning: async () => {
              return Array.from({ length: mocks.state.updateCount }, (_, i) => ({
                id: `notif-${i}`,
              }));
            },
          }),
        };
      },
    }),
  },
}));

import { runNotificationExpirySweep } from "@/lib/agent/email/draft-superseded-sweep";

beforeEach(() => {
  mocks.state.updateCount = 0;
  mocks.state.updateSet = undefined;
});

describe("runNotificationExpirySweep", () => {
  it("returns expired=N where N is the count of rows the UPDATE returned", async () => {
    mocks.state.updateCount = 3;
    const r = await runNotificationExpirySweep({ now: new Date() });
    expect(r.expired).toBe(3);
  });

  it("clears undoable_until on the UPDATE (no other column touched)", async () => {
    mocks.state.updateCount = 1;
    await runNotificationExpirySweep({ now: new Date() });
    expect(mocks.state.updateSet).toEqual({ undoableUntil: null });
  });

  it("returns expired=0 when no rows match the predicate", async () => {
    mocks.state.updateCount = 0;
    const r = await runNotificationExpirySweep({ now: new Date() });
    expect(r.expired).toBe(0);
  });

  it("accepts an injected `now` so tests are deterministic", async () => {
    mocks.state.updateCount = 0;
    const fixedNow = new Date("2026-06-01T00:00:00Z");
    const r = await runNotificationExpirySweep({ now: fixedNow });
    expect(r.expired).toBe(0);
  });
});
