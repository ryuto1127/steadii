import { describe, expect, it, vi } from "vitest";

// 2026-06-07 — Coverage for isAutoCalProposalStale, the single source of
// truth for "is this auto-cal proposal past its useful date" shared by the
// queue display filter and the expiry sweep. All fixtures are synthetic.

vi.mock("server-only", () => ({}));

// Env stub — auto-cal-slot.ts → convert-timezone pulls in the env/db
// import chain at module load.
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    AUTH_SECRET: "test",
    AUTH_GOOGLE_ID: "test",
    AUTH_GOOGLE_SECRET: "test",
    NOTION_CLIENT_ID: "test",
    NOTION_CLIENT_SECRET: "test",
    OPENAI_API_KEY: "test",
    STRIPE_SECRET_KEY: "test",
    STRIPE_PRICE_ID_PRO: "test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

import { isAutoCalProposalStale } from "@/lib/agent/proactive/auto-cal-slot";
import type { AutoCreatedAgreedSlot } from "@/lib/db/schema";

function deadlineSlot(
  date: string,
  timezone = "America/Vancouver",
): AutoCreatedAgreedSlot {
  // All-day deadline: time is meaningless (stored as 00:00, durationMin 0).
  return { date, startTime: "00:00", timezone, durationMin: 0 };
}

function timedSlot(args: {
  date: string;
  startTime: string;
  durationMin: number;
  timezone?: string;
}): AutoCreatedAgreedSlot {
  return {
    date: args.date,
    startTime: args.startTime,
    durationMin: args.durationMin,
    timezone: args.timezone ?? "America/Vancouver",
  };
}

describe("isAutoCalProposalStale — deadline (all-day, date-only)", () => {
  it("a deadline due TODAY in its tz is NOT stale (stays visible all day)", () => {
    // now = 2026-06-07 09:00 in America/Vancouver (16:00 UTC).
    const nowMs = Date.UTC(2026, 5, 7, 16, 0, 0);
    expect(
      isAutoCalProposalStale(
        { kind: "deadline", agreedSlot: deadlineSlot("2026-06-07") },
        nowMs,
      ),
    ).toBe(false);
  });

  it("a deadline due YESTERDAY in its tz IS stale (strict)", () => {
    const nowMs = Date.UTC(2026, 5, 7, 16, 0, 0);
    expect(
      isAutoCalProposalStale(
        { kind: "deadline", agreedSlot: deadlineSlot("2026-06-06") },
        nowMs,
      ),
    ).toBe(true);
  });

  it("a deadline due TOMORROW in its tz is NOT stale", () => {
    const nowMs = Date.UTC(2026, 5, 7, 16, 0, 0);
    expect(
      isAutoCalProposalStale(
        { kind: "deadline", agreedSlot: deadlineSlot("2026-06-08") },
        nowMs,
      ),
    ).toBe(false);
  });

  it("tz edge near midnight: just-past-midnight in tz, deadline of the prior day is stale", () => {
    // 2026-06-08 00:30 in America/Vancouver = 2026-06-08 07:30 UTC. The
    // calendar day in Vancouver has rolled to the 8th, so a deadline due
    // on the 7th is now stale.
    const nowMs = Date.UTC(2026, 5, 8, 7, 30, 0);
    expect(
      isAutoCalProposalStale(
        { kind: "deadline", agreedSlot: deadlineSlot("2026-06-07") },
        nowMs,
      ),
    ).toBe(true);
  });

  it("tz edge: same UTC instant, the SAME deadline date is NOT stale when the local day hasn't rolled yet", () => {
    // 2026-06-08 06:00 UTC = 2026-06-07 23:00 in America/Vancouver. The
    // local Vancouver day is still the 7th, so a deadline due on the 7th
    // is NOT stale even though it's already the 8th in UTC. This is the
    // WRONG_TZ_DIRECTION-class trap the tz-aware comparison avoids.
    const nowMs = Date.UTC(2026, 5, 8, 6, 0, 0);
    expect(
      isAutoCalProposalStale(
        { kind: "deadline", agreedSlot: deadlineSlot("2026-06-07") },
        nowMs,
      ),
    ).toBe(false);
  });

  it("respects the slot's own tz: a Tokyo deadline rolls a day earlier (UTC-wise) than a Vancouver one", () => {
    // 2026-06-07 16:00 UTC = 2026-06-08 01:00 JST → Tokyo day is already
    // the 8th, so a JST deadline due on the 7th is stale...
    const nowMs = Date.UTC(2026, 5, 7, 16, 0, 0);
    expect(
      isAutoCalProposalStale(
        {
          kind: "deadline",
          agreedSlot: deadlineSlot("2026-06-07", "Asia/Tokyo"),
        },
        nowMs,
      ),
    ).toBe(true);
    // ...while the same wall-clock-instant in Vancouver (09:00 on the 7th)
    // leaves a Vancouver deadline due on the 7th still live.
    expect(
      isAutoCalProposalStale(
        {
          kind: "deadline",
          agreedSlot: deadlineSlot("2026-06-07", "America/Vancouver"),
        },
        nowMs,
      ),
    ).toBe(false);
  });
});

describe("isAutoCalProposalStale — timed (event / mutual_agreement)", () => {
  it("a timed event whose END is before now IS stale", () => {
    // Event 2026-06-07 09:00–10:00 America/Vancouver. now = 11:00 local
    // (18:00 UTC) → past the end → stale.
    const nowMs = Date.UTC(2026, 5, 7, 18, 0, 0);
    expect(
      isAutoCalProposalStale(
        {
          kind: "event",
          agreedSlot: timedSlot({
            date: "2026-06-07",
            startTime: "09:00",
            durationMin: 60,
          }),
        },
        nowMs,
      ),
    ).toBe(true);
  });

  it("an in-progress timed event (start ≤ now < end) is NOT stale", () => {
    // Event 09:00–10:00 PT; now = 09:30 PT (16:30 UTC) → still running.
    const nowMs = Date.UTC(2026, 5, 7, 16, 30, 0);
    expect(
      isAutoCalProposalStale(
        {
          kind: "event",
          agreedSlot: timedSlot({
            date: "2026-06-07",
            startTime: "09:00",
            durationMin: 60,
          }),
        },
        nowMs,
      ),
    ).toBe(false);
  });

  it("a future timed event is NOT stale", () => {
    // Event 09:00–10:00 PT; now = 08:00 PT (15:00 UTC) → before start.
    const nowMs = Date.UTC(2026, 5, 7, 15, 0, 0);
    expect(
      isAutoCalProposalStale(
        {
          kind: "mutual_agreement",
          agreedSlot: timedSlot({
            date: "2026-06-07",
            startTime: "09:00",
            durationMin: 60,
          }),
        },
        nowMs,
      ),
    ).toBe(false);
  });

  it("mutual_agreement respects the slot's own tz for the END instant", () => {
    // 13:00–13:30 JST on 2026-06-07 = 04:00–04:30 UTC.
    const slot = timedSlot({
      date: "2026-06-07",
      startTime: "13:00",
      durationMin: 30,
      timezone: "Asia/Tokyo",
    });
    // now = 05:00 UTC → past the 04:30 UTC end → stale.
    expect(
      isAutoCalProposalStale(
        { kind: "mutual_agreement", agreedSlot: slot },
        Date.UTC(2026, 5, 7, 5, 0, 0),
      ),
    ).toBe(true);
    // now = 04:15 UTC → between start and end → in progress → NOT stale.
    expect(
      isAutoCalProposalStale(
        { kind: "mutual_agreement", agreedSlot: slot },
        Date.UTC(2026, 5, 7, 4, 15, 0),
      ),
    ).toBe(false);
  });
});
