import { describe, expect, it, vi } from "vitest";

// Mocks must precede imports of any module under test that pulls in
// server-only / db / drizzle. We're testing the pure helpers; the
// scanner's DB read paths get separate integration coverage.
vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  startSpan: (_opts: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/db/client", () => ({ db: {} }));
vi.mock("@/lib/db/schema", () => ({
  agentDrafts: {},
  agentProposals: {},
  assignments: {},
  classes: {},
  events: {},
  eventPreBriefs: {},
  inboxItems: {},
  mistakeNotes: {},
  users: {},
}));
vi.mock("drizzle-orm", () => {
  const id = (..._args: unknown[]) => ({});
  return {
    and: id,
    eq: id,
    gt: id,
    gte: id,
    inArray: id,
    isNull: id,
    lt: id,
    lte: id,
    ne: id,
    or: id,
    sql: Object.assign(
      (strings: TemplateStringsArray) => strings.join(""),
      { raw: () => ({}) }
    ),
  };
});

import {
  extractAttendees,
  looksNonAcademic,
} from "@/lib/agent/pre-brief/scanner";
import type { EventRow } from "@/lib/db/schema";

function event(meta: Record<string, unknown>): EventRow {
  // Minimal event shape for the unit tests — fields the helpers don't
  // touch are typed as unknown via the cast.
  return {
    id: "ev-1",
    userId: "u-1",
    sourceType: "google_calendar",
    sourceAccountId: "acct",
    externalId: "ext-1",
    externalParentId: null,
    kind: "event",
    title: "MAT223 office hours",
    description: null,
    startsAt: new Date(),
    endsAt: null,
    isAllDay: false,
    originTimezone: null,
    location: null,
    url: null,
    status: "confirmed",
    sourceMetadata: meta,
    normalizedKey: null,
    syncedAt: new Date(),
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as EventRow;
}

describe("extractAttendees", () => {
  it("returns [] for non-google events", () => {
    const ev = { ...event({}), sourceType: "ical_subscription" } as EventRow;
    expect(extractAttendees(ev)).toEqual([]);
  });

  it("returns [] when sourceMetadata has no attendees", () => {
    expect(extractAttendees(event({}))).toEqual([]);
    expect(extractAttendees(event({ attendees: null }))).toEqual([]);
    expect(extractAttendees(event({ attendees: [] }))).toEqual([]);
  });

  it("filters out the user's self entry and missing emails", () => {
    const ev = event({
      attendees: [
        { email: "me@school.edu", self: true, displayName: "Me" },
        { email: "tanaka@school.edu", displayName: "Prof Tanaka" },
        { displayName: "No email here" },
        { email: "ta@school.edu" },
      ],
    });
    const result = extractAttendees(ev);
    expect(result).toEqual([
      { email: "tanaka@school.edu", name: "Prof Tanaka" },
      { email: "ta@school.edu", name: null },
    ]);
  });
});

describe("looksNonAcademic", () => {
  it("flags lunch/coffee/dental titles", () => {
    expect(looksNonAcademic("Lunch with mom")).toBe(true);
    expect(looksNonAcademic("Coffee chat")).toBe(true);
    // engineer-43 — blocklist narrowed: "dentist" / "doctor" removed,
    // "dental" / "vet" added.
    expect(looksNonAcademic("Dental appointment")).toBe(true);
    expect(looksNonAcademic("OOO — vacation")).toBe(true);
  });

  it("does not flag academic-looking titles", () => {
    expect(looksNonAcademic("MAT223 office hours")).toBe(false);
    expect(looksNonAcademic("Group project sync")).toBe(false);
    expect(looksNonAcademic("Prof Tanaka 1:1")).toBe(false);
  });
});
