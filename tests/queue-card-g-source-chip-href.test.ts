import { describe, expect, it, vi } from "vitest";

// Coverage for the Type G auto-cal source chip ("元のメール"). The chip
// must point at a destination the inbox-detail route can resolve. The
// route resolves the chip's id as an inbox_items.id (via its fallback),
// so the href must be `/app/inbox/<inboxItemId>` — the inbox_item id, NOT
// a draft id (which never exists for a calendar proposal). This is the
// id-type mismatch the fix repairs.
//
// All synthetic test data — no real subjects, dates, senders, or ids
// (per AGENTS.md §7a).

vi.mock("server-only", () => ({}));

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

import { autoCalToTypeG } from "@/lib/agent/queue/build";
import type { AutoCreatedCalendarEventRow } from "@/lib/db/schema";

function makeRow(
  overrides: Partial<AutoCreatedCalendarEventRow> = {}
): AutoCreatedCalendarEventRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    userId: "00000000-0000-0000-0000-0000000000aa",
    inboxItemId: "00000000-0000-0000-0000-0000000000bb",
    eventRefs: [],
    status: "proposed",
    agreedSlot: {
      date: "2027-01-02",
      startTime: "00:00",
      timezone: "UTC",
      durationMin: 0,
    },
    kind: "deadline",
    confidence: 0.9,
    createdAt: new Date("2026-06-01T12:00:00Z"),
    graceExpiresAt: new Date("2026-06-02T12:00:00Z"),
    cancelledAt: null,
    ...overrides,
  };
}

describe("autoCalToTypeG → source chip href", () => {
  it("emits a single 元のメール chip targeting the inbox_item id", () => {
    const card = autoCalToTypeG(makeRow());
    expect(card.sources).toHaveLength(1);
    const chip = card.sources[0];
    expect(chip.kind).toBe("email");
    expect(chip.label).toBe("元のメール");
    expect(chip.href).toBe(
      "/app/inbox/00000000-0000-0000-0000-0000000000bb"
    );
  });

  it("targets the inbox_item id, not the auto-cal row id (no draft id)", () => {
    const card = autoCalToTypeG(makeRow());
    const chip = card.sources[0];
    // Must NOT link to the auto_created_calendar_events.id — that would
    // be unresolvable by the route. It must be the inbox_items.id.
    expect(chip.href).not.toContain(card.autoCreateId);
    expect(chip.href).toContain(card.inboxItemId);
  });

  it("carries the inbox_item id on the card for the route fallback", () => {
    const card = autoCalToTypeG(
      makeRow({ inboxItemId: "00000000-0000-0000-0000-0000000000cc" })
    );
    expect(card.inboxItemId).toBe("00000000-0000-0000-0000-0000000000cc");
    expect(card.sources[0].href).toBe(
      "/app/inbox/00000000-0000-0000-0000-0000000000cc"
    );
  });
});
