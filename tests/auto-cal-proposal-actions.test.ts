import { beforeEach, describe, expect, it, vi } from "vitest";

// Env stub — needed by lib/db/client.ts import chain.
vi.mock("@/lib/env", () => ({
  env: () => ({
    DATABASE_URL: "postgres://test",
    ENCRYPTION_KEY: "k".repeat(64),
  }),
}));

// Hoisted shared state so the (also-hoisted) vi.mock factories can
// close over it without TDZ issues.
const mocks = vi.hoisted(() => {
  type Row = {
    id: string;
    userId: string;
    inboxItemId: string;
    kind: "mutual_agreement" | "deadline";
    status: "proposed" | "provisional" | "confirmed" | "cancelled";
    eventRefs: Array<{
      provider: "google_calendar" | "microsoft_graph";
      eventId: string;
      htmlLink: string | null;
    }>;
    agreedSlot: {
      date: string;
      startTime: string;
      timezone: string;
      durationMin: number;
      title?: string;
      topic?: string;
    };
  };
  return {
    state: {
      // Single-row store keyed by id; tests seed via seedRow().
      rows: new Map<string, Row>(),
      // Capture of every UPDATE ... SET payload so tests can assert.
      updates: [] as Array<{ id: string; values: Record<string, unknown> }>,
      // Capture of every audit log insert.
      auditInserts: [] as Array<Record<string, unknown>>,
      // Pretend authenticated user.
      currentUserId: "user-1" as string | null,
      // calendarCreateEvent.execute mock — tests override per case.
      calendarCreateImpl: null as
        | null
        | ((
            ctx: { userId: string },
            args: {
              summary: string;
              start: string;
              end: string;
              description: string;
            },
          ) => Promise<{
            eventId: string;
            htmlLink: string | null;
            createdIn: Array<"google_calendar" | "microsoft_graph">;
          }>),
      // Last UPDATE target id — the production code updates by id so
      // we capture which id matched in the WHERE clause.
      lastUpdateId: null as string | null,
    },
  };
});

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => {
    if (!mocks.state.currentUserId) return null;
    return { user: { id: mocks.state.currentUserId } };
  }),
}));

vi.mock("@/lib/db/client", () => {
  // Minimal Drizzle-like chain mock. select() returns a thenable that
  // resolves to all rows; the production code filters by id and userId
  // in its WHERE clause — we mirror that by inspecting subsequent .where
  // captures into a small predicate, but for these tests it's enough to
  // return ALL rows (the production code does a .limit(1) so we slice).
  let pendingSelectFilter: ((r: { id: string }) => boolean) | null = null;

  const selectChain = () => {
    const rows = Array.from(mocks.state.rows.values());
    const promise = Promise.resolve(
      pendingSelectFilter ? rows.filter(pendingSelectFilter) : rows,
    );
    const c: Record<string, unknown> = {
      from: () => c,
      where: () => {
        // Tests don't observe the SQL — we just want the .limit(1)
        // semantics to return at most one row. The production code
        // selects by (id, userId) so we approximate with "first row".
        return c;
      },
      limit: (n: number) => {
        const sliced = (
          pendingSelectFilter ? rows.filter(pendingSelectFilter) : rows
        ).slice(0, n);
        const p2 = Promise.resolve(sliced);
        const c2: Record<string, unknown> = {
          ...c,
          then: p2.then.bind(p2),
          catch: p2.catch.bind(p2),
          finally: p2.finally.bind(p2),
        };
        return c2;
      },
      then: promise.then.bind(promise),
      catch: promise.catch.bind(promise),
      finally: promise.finally.bind(promise),
    };
    return c;
  };

  return {
    db: {
      select: () => {
        pendingSelectFilter = null;
        return selectChain();
      },
      update: () => {
        let captured: Record<string, unknown> = {};
        let capturedWhereId: string | null = null;
        return {
          set: (vals: Record<string, unknown>) => {
            captured = vals;
            return {
              where: async (whereExpr: unknown) => {
                // Drizzle eq() returns an object — we can't introspect
                // it cheanly. The production code always does
                // .where(eq(autoCreatedCalendarEvents.id, id)) so we
                // fall back to "find the most recent select id" via
                // the rows map: we record the update against the only
                // row in the map for tests with one row, or against
                // a sentinel "*" for multi-row tests.
                void whereExpr;
                if (mocks.state.rows.size === 1) {
                  capturedWhereId = Array.from(
                    mocks.state.rows.keys(),
                  )[0];
                } else {
                  capturedWhereId = "*";
                }
                mocks.state.lastUpdateId = capturedWhereId;
                mocks.state.updates.push({
                  id: capturedWhereId,
                  values: captured,
                });
                // Mirror the update into the in-memory store so
                // back-to-back actions see the post-update state.
                if (capturedWhereId && capturedWhereId !== "*") {
                  const row = mocks.state.rows.get(capturedWhereId);
                  if (row) {
                    mocks.state.rows.set(capturedWhereId, {
                      ...row,
                      ...(captured as Partial<typeof row>),
                    });
                  }
                }
              },
            };
          },
        };
      },
      insert: () => ({
        values: async (vals: Record<string, unknown>) => {
          mocks.state.auditInserts.push(vals);
        },
      }),
    },
  };
});

vi.mock("@/lib/agent/tools/calendar", () => ({
  calendarCreateEvent: {
    execute: vi.fn(
      async (
        ctx: { userId: string },
        args: {
          summary: string;
          start: string;
          end: string;
          description: string;
        },
      ) => {
        if (!mocks.state.calendarCreateImpl) {
          throw new Error("calendarCreateImpl not configured for this test");
        }
        return mocks.state.calendarCreateImpl(ctx, args);
      },
    ),
  },
}));

// Stub the heavy modules queue-actions transitively imports — none of
// these are exercised by the propose-confirm action paths but the
// import graph would explode without them.
vi.mock("@/lib/agent/email/draft-actions", () => ({
  approveAgentDraftAction: vi.fn(),
  dismissAgentDraftAction: vi.fn(),
  snoozeAgentDraftAction: vi.fn(),
}));
vi.mock("@/lib/agent/email/l2", () => ({ processL2: vi.fn() }));
vi.mock("@/lib/agent/proactive/feedback-bias", () => ({
  recordProactiveFeedback: vi.fn(),
}));
vi.mock("@/lib/agent/proactive/action-executor", () => ({
  executeProactiveAction: vi.fn(),
  stampLastMonthlyReviewAt: vi.fn(),
}));
vi.mock("@/lib/agent/groups/detect-actions", () => ({
  resolveGroupDetectClarification: vi.fn(),
}));
vi.mock("@/lib/agent/office-hours/actions", () => ({
  pickOfficeHoursSlot: vi.fn(),
  sendOfficeHoursDraft: vi.fn(),
}));
vi.mock("@/lib/agent/queue/confirmation-fact-merge", () => ({
  applyUserConfirmedFact: vi.fn(() => ({})),
  normalizeStructuredFactKey: vi.fn((k: string) => k),
}));

import {
  autoCalProposalAddAction,
  autoCalProposalDismissAction,
  autoCalProposalEditAction,
} from "@/app/app/queue-actions";

function seedRow(overrides: Partial<{
  id: string;
  userId: string;
  inboxItemId: string;
  kind: "mutual_agreement" | "deadline";
  status: "proposed" | "provisional" | "confirmed" | "cancelled";
  agreedSlot: {
    date: string;
    startTime: string;
    timezone: string;
    durationMin: number;
    title?: string;
    topic?: string;
  };
}>): string {
  const id = overrides.id ?? "00000000-0000-0000-0000-000000000001";
  const row = {
    id,
    userId: overrides.userId ?? "user-1",
    inboxItemId: overrides.inboxItemId ?? "inbox-1",
    kind: overrides.kind ?? "mutual_agreement",
    status: overrides.status ?? "proposed",
    eventRefs: [] as Array<{
      provider: "google_calendar" | "microsoft_graph";
      eventId: string;
      htmlLink: string | null;
    }>,
    agreedSlot: overrides.agreedSlot ?? {
      date: "2026-05-22",
      startTime: "14:00",
      timezone: "Asia/Tokyo",
      durationMin: 60,
    },
  };
  mocks.state.rows.set(id, row);
  return id;
}

const VALID_CARD_ID = "autocal:00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  mocks.state.rows.clear();
  mocks.state.updates = [];
  mocks.state.auditInserts = [];
  mocks.state.currentUserId = "user-1";
  mocks.state.calendarCreateImpl = null;
  mocks.state.lastUpdateId = null;
});

describe("autoCalProposalAddAction", () => {
  it("calls calendarCreateEvent with the agreed slot and flips status to confirmed", async () => {
    seedRow({});
    mocks.state.calendarCreateImpl = vi.fn(async () => ({
      eventId: "evt-1",
      htmlLink: "https://calendar.example.com/evt-1",
      createdIn: ["google_calendar"] as Array<
        "google_calendar" | "microsoft_graph"
      >,
    }));

    await autoCalProposalAddAction(VALID_CARD_ID);

    expect(mocks.state.calendarCreateImpl).toHaveBeenCalledOnce();
    const calls = (mocks.state.calendarCreateImpl as ReturnType<typeof vi.fn>)
      .mock.calls;
    const [, args] = calls[0] as [
      unknown,
      { summary: string; start: string; end: string },
    ];
    // Round-3: NO [Steadii] prefix in the Add path. The event lands
    // on the user's calendar after explicit consent so the
    // agent-authorship signal is captured by user intent.
    expect(args.summary.startsWith("[Steadii]")).toBe(false);
    expect(args.start).toMatch(/^2026-05-22T14:00:00\+09:00$/);
    expect(args.end).toMatch(/^2026-05-22T15:00:00\+09:00$/);

    // Status flipped + eventRefs persisted.
    expect(mocks.state.updates).toHaveLength(1);
    const updateVals = mocks.state.updates[0].values as Record<string, unknown>;
    expect(updateVals.status).toBe("confirmed");
    const eventRefs = updateVals.eventRefs as Array<{ eventId: string }>;
    expect(eventRefs).toHaveLength(1);
    expect(eventRefs[0].eventId).toBe("evt-1");

    // Audit log recorded.
    expect(mocks.state.auditInserts).toHaveLength(1);
    expect(mocks.state.auditInserts[0].action).toBe("auto_cal_proposal_added");
  });

  it("uses the edited title when the user has overridden it", async () => {
    seedRow({
      agreedSlot: {
        date: "2026-05-22",
        startTime: "14:00",
        timezone: "Asia/Tokyo",
        durationMin: 60,
        title: "Interview with university recruiting",
      },
    });
    mocks.state.calendarCreateImpl = vi.fn(async () => ({
      eventId: "evt-2",
      htmlLink: null,
      createdIn: ["google_calendar"] as Array<
        "google_calendar" | "microsoft_graph"
      >,
    }));

    await autoCalProposalAddAction(VALID_CARD_ID);

    const args = (mocks.state.calendarCreateImpl as ReturnType<typeof vi.fn>)
      .mock.calls[0][1] as { summary: string };
    expect(args.summary).toBe("Interview with university recruiting");
  });

  it("builds an all-day event for deadline-kind rows", async () => {
    seedRow({
      kind: "deadline",
      agreedSlot: {
        date: "2026-05-30",
        startTime: "00:00",
        timezone: "Asia/Tokyo",
        durationMin: 0,
        topic: "Assignment submission",
      },
    });
    mocks.state.calendarCreateImpl = vi.fn(async () => ({
      eventId: "evt-dl-1",
      htmlLink: null,
      createdIn: ["google_calendar"] as Array<
        "google_calendar" | "microsoft_graph"
      >,
    }));

    await autoCalProposalAddAction(VALID_CARD_ID);

    const args = (mocks.state.calendarCreateImpl as ReturnType<typeof vi.fn>)
      .mock.calls[0][1] as {
      summary: string;
      start: string;
      end: string;
    };
    // calendarCreateEvent treats YYYY-MM-DD strings as all-day events.
    expect(args.start).toBe("2026-05-30");
    expect(args.end).toBe("2026-05-30");
    expect(args.summary).toContain("Assignment submission");
    expect(args.summary).toContain("締切");
  });

  it("throws when the row is not in 'proposed' state", async () => {
    seedRow({ status: "confirmed" });
    mocks.state.calendarCreateImpl = vi.fn();

    await expect(autoCalProposalAddAction(VALID_CARD_ID)).rejects.toThrow(
      /not in 'proposed' state/,
    );
    expect(mocks.state.calendarCreateImpl).not.toHaveBeenCalled();
    expect(mocks.state.updates).toHaveLength(0);
  });

  it("throws when the row is missing", async () => {
    mocks.state.calendarCreateImpl = vi.fn();
    await expect(autoCalProposalAddAction(VALID_CARD_ID)).rejects.toThrow(
      /not found/,
    );
    expect(mocks.state.calendarCreateImpl).not.toHaveBeenCalled();
  });

  it("rejects card ids that aren't 'autocal' kind", async () => {
    await expect(
      autoCalProposalAddAction(
        "draft:00000000-0000-0000-0000-000000000001",
      ),
    ).rejects.toThrow(/auto-cal proposal/);
  });
});

describe("autoCalProposalEditAction", () => {
  it("merges the requested fields onto agreedSlot WITHOUT calling the calendar tool", async () => {
    seedRow({});
    mocks.state.calendarCreateImpl = vi.fn();

    await autoCalProposalEditAction(VALID_CARD_ID, {
      date: "2026-05-23",
      startTime: "15:30",
      durationMin: 45,
      title: "Updated meeting title",
    });

    // No calendar API call.
    expect(mocks.state.calendarCreateImpl).not.toHaveBeenCalled();

    // DB-only merge.
    expect(mocks.state.updates).toHaveLength(1);
    const updated = mocks.state.updates[0].values as Record<string, unknown>;
    const slot = updated.agreedSlot as Record<string, unknown>;
    expect(slot.date).toBe("2026-05-23");
    expect(slot.startTime).toBe("15:30");
    expect(slot.durationMin).toBe(45);
    expect(slot.title).toBe("Updated meeting title");
    // Untouched fields persist.
    expect(slot.timezone).toBe("Asia/Tokyo");

    // Audit log recorded.
    expect(mocks.state.auditInserts).toHaveLength(1);
    expect(mocks.state.auditInserts[0].action).toBe(
      "auto_cal_proposal_edited",
    );
  });

  it("rejects malformed date/time strings via zod", async () => {
    seedRow({});
    await expect(
      autoCalProposalEditAction(VALID_CARD_ID, {
        date: "2026/05/23", // wrong separator
      }),
    ).rejects.toThrow();
  });

  it("throws when the row is not in 'proposed' state", async () => {
    seedRow({ status: "cancelled" });
    await expect(
      autoCalProposalEditAction(VALID_CARD_ID, { startTime: "10:00" }),
    ).rejects.toThrow(/not in 'proposed' state/);
    expect(mocks.state.updates).toHaveLength(0);
  });
});

describe("autoCalProposalDismissAction", () => {
  it("flips status to 'cancelled' and stamps cancelledAt without calling the calendar tool", async () => {
    seedRow({});
    mocks.state.calendarCreateImpl = vi.fn();

    await autoCalProposalDismissAction(VALID_CARD_ID);

    expect(mocks.state.calendarCreateImpl).not.toHaveBeenCalled();
    expect(mocks.state.updates).toHaveLength(1);
    const vals = mocks.state.updates[0].values as Record<string, unknown>;
    expect(vals.status).toBe("cancelled");
    expect(vals.cancelledAt).toBeInstanceOf(Date);

    expect(mocks.state.auditInserts).toHaveLength(1);
    expect(mocks.state.auditInserts[0].action).toBe(
      "auto_cal_proposal_dismissed",
    );
  });

  it("is a no-op on already-cancelled rows (idempotent)", async () => {
    seedRow({ status: "cancelled" });
    await autoCalProposalDismissAction(VALID_CARD_ID);
    expect(mocks.state.updates).toHaveLength(0);
    expect(mocks.state.auditInserts).toHaveLength(0);
  });

  it("allows dismissing legacy 'provisional' rows for cleanup", async () => {
    seedRow({ status: "provisional" });
    await autoCalProposalDismissAction(VALID_CARD_ID);
    expect(mocks.state.updates).toHaveLength(1);
    const vals = mocks.state.updates[0].values as Record<string, unknown>;
    expect(vals.status).toBe("cancelled");
  });

  it("ignores confirmed rows (calendar event is already the user's)", async () => {
    seedRow({ status: "confirmed" });
    await autoCalProposalDismissAction(VALID_CARD_ID);
    expect(mocks.state.updates).toHaveLength(0);
  });
});
