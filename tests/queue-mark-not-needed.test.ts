import { beforeEach, describe, expect, it, vi } from "vitest";

// 不要 (queueMarkNotNeededAction) — the soft-negative sibling of 確認済み on
// the two-button card model. It RESOLVES the card AND records a RECORD-ONLY
// soft-negative signal. The contract we assert:
//
//   - proposal kind → status flips to 'resolved' (resolvedAction='not_needed')
//                     AND recordProactiveFeedback('dismissed') fires.
//   - draft kind    → disposition flips to 'resolved' AND
//                     recordSenderFeedback('dismissed') fires.
//   - CRITICAL: the suppression / sender-confidence learner
//     (recordSenderEvent) is NEVER called — the signal is logged but no
//     demotion / threshold is activated.
//
// All synthetic ids (no real senders/subjects/dates per AGENTS.md §7a). DB is
// mocked per the repo convention — no real API, no DOM render.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({
  env: () => ({ DATABASE_URL: "postgres://test", ENCRYPTION_KEY: "k".repeat(64) }),
}));

const state = vi.hoisted(() => ({
  currentUserId: "user-1" as string | null,
  // Rows the next select().limit(1) should resolve to.
  selectRows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/auth/config", () => ({
  auth: async () =>
    state.currentUserId ? { user: { id: state.currentUserId } } : null,
}));

// Drizzle chain mock: select().from().innerJoin()?.where().limit() resolves to
// state.selectRows; update().set().where() captures the SET payload.
vi.mock("@/lib/db/client", () => {
  const selectChain = () => {
    const c: Record<string, unknown> = {
      from: () => c,
      innerJoin: () => c,
      leftJoin: () => c,
      where: () => c,
      orderBy: () => c,
      limit: async () => state.selectRows,
    };
    return c;
  };
  return {
    db: {
      select: () => selectChain(),
      update: (_table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async () => {
            state.updates.push(values);
          },
        }),
      }),
    },
  };
});

vi.mock("@/lib/db/schema", () => ({
  agentDrafts: { id: {}, userId: {}, inboxItemId: {}, action: {}, createdAt: {} },
  agentProposals: { id: {}, userId: {}, issueType: {} },
  agentConfirmations: {},
  agentContactPersonas: {},
  agentConfirmations_: {},
  autoCreatedCalendarEvents: {},
  chats: {},
  eventPreBriefs: {},
  groupProjects: {},
  inboxItems: { id: {}, senderEmail: {}, senderDomain: {} },
  messages: {},
  officeHoursRequests: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...c: unknown[]) => ({ __and: c }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ __in: [col, vals] }),
  isNotNull: (col: unknown) => ({ __nn: col }),
  desc: (col: unknown) => ({ __desc: col }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// The two record-only feedback writers we DO expect (one per kind).
const recordProactiveFeedback = vi.fn((..._a: unknown[]) => Promise.resolve());
const recordSenderFeedback = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/agent/proactive/feedback-bias", () => ({
  recordProactiveFeedback: (...a: unknown[]) => recordProactiveFeedback(...a),
}));
vi.mock("@/lib/agent/email/feedback", () => ({
  recordSenderFeedback: (...a: unknown[]) => recordSenderFeedback(...a),
}));

// The suppression / sender-confidence learner — MUST NOT be called by the
// record-only 不要 path.
const recordSenderEvent = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/agent/learning/sender-confidence", () => ({
  recordSenderEvent: (...a: unknown[]) => recordSenderEvent(...a),
}));

const logEmailAudit = vi.fn((..._a: unknown[]) => Promise.resolve());
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: (...a: unknown[]) => logEmailAudit(...a),
}));

// Heavy fan-out modules the action file imports at top — stub so the module
// graph loads without dragging in Google/MS SDKs. None are exercised by
// queueMarkNotNeededAction.
vi.mock("@/lib/agent/email/draft-actions", () => ({
  approveAgentDraftAction: vi.fn(),
  cancelPendingSendAction: vi.fn(),
  dismissAgentDraftAction: vi.fn(),
  snoozeAgentDraftAction: vi.fn(),
}));
vi.mock("@/lib/agent/email/l2", () => ({ processL2: vi.fn() }));
vi.mock("@/lib/agent/proactive/action-executor", () => ({
  executeProactiveAction: vi.fn(),
  stampLastMonthlyReviewAt: vi.fn(),
}));
vi.mock("@/lib/agent/email/ignored-senders", () => ({
  addIgnoredSender: vi.fn(),
  clearSurfacedFromSender: vi.fn(),
  countDismissSignalsForSender: vi.fn(),
  isSenderIgnored: vi.fn(),
  removeIgnoredSender: vi.fn(),
}));
vi.mock("@/lib/agent/email/ignore-offer", () => ({
  shouldOfferIgnoreSender: vi.fn(),
}));
vi.mock("@/lib/agent/groups/detect-actions", () => ({
  resolveGroupDetectClarification: vi.fn(),
}));
vi.mock("@/lib/agent/office-hours/actions", () => ({
  pickOfficeHoursSlot: vi.fn(),
  sendOfficeHoursDraft: vi.fn(),
}));
vi.mock("@/lib/agent/queue/confirmation-fact-merge", () => ({
  applyUserConfirmedFact: vi.fn(),
  normalizeStructuredFactKey: vi.fn(),
}));
vi.mock("@/lib/agent/tools/calendar", () => ({
  calendarCreateEvent: { execute: vi.fn() },
}));
vi.mock("@/lib/agent/proactive/auto-cal-slot", () => ({
  buildDeadlineDescription: vi.fn(),
  buildDeadlineSummary: vi.fn(),
  buildEventDescription: vi.fn(),
  buildEventSummary: vi.fn(),
  buildIsoStartEnd: vi.fn(),
}));

import { queueMarkNotNeededAction } from "@/app/app/queue-actions";

const UUID = "00000000-0000-0000-0000-000000000001";

beforeEach(() => {
  state.currentUserId = "user-1";
  state.selectRows = [];
  state.updates.length = 0;
  recordProactiveFeedback.mockClear();
  recordSenderFeedback.mockClear();
  recordSenderEvent.mockClear();
  logEmailAudit.mockClear();
});

describe("queueMarkNotNeededAction — proposal kind", () => {
  beforeEach(() => {
    state.selectRows = [{ issueType: "group_member_silent" }];
  });

  it("resolves the proposal with resolvedAction='not_needed'", async () => {
    await queueMarkNotNeededAction(`proposal:${UUID}`);
    const resolveWrite = state.updates.find((u) => u.status === "resolved");
    expect(resolveWrite).toBeTruthy();
    expect(resolveWrite?.resolvedAction).toBe("not_needed");
  });

  it("records a record-only proactive soft-negative (dismissed) signal", async () => {
    await queueMarkNotNeededAction(`proposal:${UUID}`);
    expect(recordProactiveFeedback).toHaveBeenCalledTimes(1);
    const arg = recordProactiveFeedback.mock.calls[0][0] as {
      userResponse: string;
      issueType: string;
      proposalId: string;
    };
    expect(arg.userResponse).toBe("dismissed");
    expect(arg.issueType).toBe("group_member_silent");
    expect(arg.proposalId).toBe(UUID);
  });

  it("never activates the sender-confidence learner or the draft feedback path", async () => {
    await queueMarkNotNeededAction(`proposal:${UUID}`);
    expect(recordSenderEvent).not.toHaveBeenCalled();
    expect(recordSenderFeedback).not.toHaveBeenCalled();
  });

  it("writes a single not-needed audit row", async () => {
    await queueMarkNotNeededAction(`proposal:${UUID}`);
    const calls = logEmailAudit.mock.calls.filter(
      (c) => (c[0] as { action: string }).action === "email_item_marked_not_needed"
    );
    expect(calls).toHaveLength(1);
  });
});

describe("queueMarkNotNeededAction — draft kind", () => {
  beforeEach(() => {
    state.selectRows = [
      {
        action: "notify_only",
        senderEmail: "sender@school.example.edu",
        senderDomain: "school.example.edu",
        inboxItemId: "ib-1",
      },
    ];
  });

  it("resolves the draft with disposition='resolved'", async () => {
    await queueMarkNotNeededAction(`draft:${UUID}`);
    const resolveWrite = state.updates.find((u) => u.disposition === "resolved");
    expect(resolveWrite).toBeTruthy();
  });

  it("records a record-only sender feedback (dismissed) signal", async () => {
    await queueMarkNotNeededAction(`draft:${UUID}`);
    expect(recordSenderFeedback).toHaveBeenCalledTimes(1);
    const arg = recordSenderFeedback.mock.calls[0][0] as {
      userResponse: string;
      senderEmail: string;
    };
    expect(arg.userResponse).toBe("dismissed");
    expect(arg.senderEmail).toBe("sender@school.example.edu");
  });

  it("never calls the sender-confidence learner (record-only — no demotion)", async () => {
    await queueMarkNotNeededAction(`draft:${UUID}`);
    expect(recordSenderEvent).not.toHaveBeenCalled();
    // And the proactive-proposal feedback path is for proposals only.
    expect(recordProactiveFeedback).not.toHaveBeenCalled();
  });
});

describe("queueMarkNotNeededAction — auth", () => {
  it("throws when unauthenticated and writes nothing", async () => {
    state.currentUserId = null;
    await expect(queueMarkNotNeededAction(`proposal:${UUID}`)).rejects.toThrow(
      "Unauthenticated"
    );
    expect(state.updates).toHaveLength(0);
    expect(recordProactiveFeedback).not.toHaveBeenCalled();
    expect(recordSenderFeedback).not.toHaveBeenCalled();
  });
});
