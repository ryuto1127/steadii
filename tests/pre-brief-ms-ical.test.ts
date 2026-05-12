import { describe, expect, it, vi } from "vitest";

// Mirrors the mock surface from tests/pre-brief-cron.test.ts — the
// helpers under test are pure, the file just has to compile against
// the heavy server-only imports.
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

function event(
  sourceType: EventRow["sourceType"],
  meta: Record<string, unknown>
): EventRow {
  return {
    id: "ev-1",
    userId: "u-1",
    sourceType,
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

describe("extractAttendees — MS Graph", () => {
  it("extracts MS Graph attendees from emailAddress.address + .name", () => {
    const ev = event("microsoft_graph", {
      attendees: [
        {
          emailAddress: { address: "prof.tanaka@school.edu", name: "Prof Tanaka" },
          type: "required",
        },
        {
          emailAddress: { address: "ta@school.edu", name: null },
          type: "optional",
        },
      ],
    });
    expect(extractAttendees(ev)).toEqual([
      { email: "prof.tanaka@school.edu", name: "Prof Tanaka" },
      { email: "ta@school.edu", name: null },
    ]);
  });

  it("returns [] when attendees array is missing or malformed", () => {
    expect(extractAttendees(event("microsoft_graph", {}))).toEqual([]);
    expect(
      extractAttendees(
        event("microsoft_graph", { attendees: [{ emailAddress: null }] })
      )
    ).toEqual([]);
    expect(
      extractAttendees(
        event("microsoft_graph", { attendees: [{ emailAddress: {} }] })
      )
    ).toEqual([]);
  });
});

describe("extractAttendees — iCal subscription", () => {
  it("extracts iCal attendees from email + name fields", () => {
    const ev = event("ical_subscription", {
      attendees: [
        { email: "advisor@school.edu", name: "Faculty Advisor" },
        { email: "student@school.edu" },
      ],
    });
    expect(extractAttendees(ev)).toEqual([
      { email: "advisor@school.edu", name: "Faculty Advisor" },
      { email: "student@school.edu", name: null },
    ]);
  });

  it("returns [] for an iCal event with no attendees populated (common case)", () => {
    expect(extractAttendees(event("ical_subscription", {}))).toEqual([]);
  });
});

describe("extractAttendees — unsupported source", () => {
  it("returns [] for sourceType that's not gcal/MS/iCal", () => {
    const ev = event("google_tasks" as EventRow["sourceType"], {
      attendees: [{ email: "x@y.com" }],
    });
    expect(extractAttendees(ev)).toEqual([]);
  });
});

describe("looksNonAcademic — narrowed blocklist (engineer-43)", () => {
  it("still flags clearly non-academic titles", () => {
    expect(looksNonAcademic("Lunch with mom")).toBe(true);
    expect(looksNonAcademic("Coffee chat")).toBe(true);
    expect(looksNonAcademic("Dental appointment")).toBe(true);
    expect(looksNonAcademic("Vet visit for the dog")).toBe(true);
    expect(looksNonAcademic("OOO — vacation")).toBe(true);
  });

  it("no longer flags 'doctor' which mis-fired on 'doctoral defense'", () => {
    // The old blocklist included "doctor" which matched "doctoral
    // defense rehearsal" — a clearly academic event. New list drops
    // "doctor" entirely so this case stays in the brief queue.
    expect(looksNonAcademic("Doctoral defense rehearsal")).toBe(false);
    expect(looksNonAcademic("Meeting with doctor about research")).toBe(false);
  });
});
