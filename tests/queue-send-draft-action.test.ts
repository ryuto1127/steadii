import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// PR 2 — queueSendDraftAction is a thin server-action wrapper around
// approveAgentDraftAction. The interesting branches are:
//   1. card id parses as `draft:<uuid>` → forwards to the inner action
//      with skipPreSendCheck=true
//   2. any other prefix throws "Card is not a draft" before any DB work
//
// PR 3 — queueSetDispositionAction is the corresponding wrapper for
// the new 3-way disposition buttons. Same routing check + a Zod-
// validated disposition input.
//
// We mock out the heavy dependencies (auth, db, approveAgentDraftAction)
// so the test stays a pure routing check.

const mocks = vi.hoisted(() => ({
  approveAgentDraftAction: vi.fn(),
  revalidatePath: vi.fn(),
  capturedDispositionSet: null as Record<string, unknown> | null,
  logEmailAudit: vi.fn(),
}));

vi.mock("@/lib/agent/email/draft-actions", () => ({
  approveAgentDraftAction: mocks.approveAgentDraftAction,
  dismissAgentDraftAction: vi.fn(),
  snoozeAgentDraftAction: vi.fn(),
}));

vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: mocks.logEmailAudit,
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

// The remaining imports in queue-actions.ts that we don't exercise here
// are stubbed minimally so the module loads under vitest's node env.
vi.mock("@/lib/auth/config", () => ({
  auth: vi.fn(async () => ({ user: { id: "test-user-id" } })),
}));

vi.mock("@/lib/db/client", () => ({
  db: {
    update: () => ({
      set: (vals: Record<string, unknown>) => {
        mocks.capturedDispositionSet = vals;
        return {
          where: async () => undefined,
        };
      },
    }),
  },
}));

vi.mock("@/lib/db/schema", () => ({
  agentConfirmations: {},
  agentContactPersonas: {},
  agentDrafts: {},
  agentProposals: {},
  autoCreatedCalendarEvents: {},
  chats: {},
  eventPreBriefs: {},
  groupProjects: {},
  inboxItems: {},
  messages: {},
  officeHoursRequests: {},
}));

vi.mock("@/lib/agent/email/l2", () => ({
  processL2: vi.fn(),
}));

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
  applyUserConfirmedFact: vi.fn(),
  normalizeStructuredFactKey: vi.fn(),
}));

vi.mock("@/lib/agent/tools/calendar", () => ({
  calendarDeleteEvent: { execute: vi.fn() },
}));

describe("queueSendDraftAction", () => {
  beforeEach(() => {
    mocks.approveAgentDraftAction.mockReset();
    mocks.approveAgentDraftAction.mockResolvedValue({
      sendAt: new Date(),
      undoWindowSeconds: 10,
    });
    mocks.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("forwards a draft:<uuid> card id to approveAgentDraftAction with skipPreSendCheck=true", async () => {
    const { queueSendDraftAction } = await import("@/app/app/queue-actions");
    const cardId = "draft:00000000-0000-0000-0000-000000000001";
    await queueSendDraftAction(cardId);

    expect(mocks.approveAgentDraftAction).toHaveBeenCalledTimes(1);
    expect(mocks.approveAgentDraftAction).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001",
      { skipPreSendCheck: true }
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("throws when the card id prefix is not 'draft'", async () => {
    const { queueSendDraftAction } = await import("@/app/app/queue-actions");
    await expect(
      queueSendDraftAction("proposal:00000000-0000-0000-0000-000000000002")
    ).rejects.toThrow("Card is not a draft");
    expect(mocks.approveAgentDraftAction).not.toHaveBeenCalled();
  });

  it("throws when the card id shape is malformed (no kind prefix)", async () => {
    const { queueSendDraftAction } = await import("@/app/app/queue-actions");
    await expect(
      queueSendDraftAction("00000000-0000-0000-0000-000000000003")
    ).rejects.toThrow();
    expect(mocks.approveAgentDraftAction).not.toHaveBeenCalled();
  });

  it("propagates errors from the inner approve action (e.g. pre-send fact-checker on subsequent paths)", async () => {
    mocks.approveAgentDraftAction.mockRejectedValueOnce(new Error("Draft not found"));
    const { queueSendDraftAction } = await import("@/app/app/queue-actions");
    await expect(
      queueSendDraftAction("draft:00000000-0000-0000-0000-000000000004")
    ).rejects.toThrow("Draft not found");
  });
});

describe("queueSetDispositionAction", () => {
  beforeEach(() => {
    mocks.capturedDispositionSet = null;
    mocks.logEmailAudit.mockReset();
    mocks.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("writes disposition='resolved' (and clears skippedAt) for a draft card", async () => {
    const { queueSetDispositionAction } = await import(
      "@/app/app/queue-actions"
    );
    await queueSetDispositionAction(
      "draft:00000000-0000-0000-0000-000000000010",
      "resolved"
    );
    expect(mocks.capturedDispositionSet?.disposition).toBe("resolved");
    expect(mocks.capturedDispositionSet?.skippedAt).toBeNull();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("stamps skippedAt to the current Date when transitioning to 'skipped'", async () => {
    const { queueSetDispositionAction } = await import(
      "@/app/app/queue-actions"
    );
    const before = Date.now();
    await queueSetDispositionAction(
      "draft:00000000-0000-0000-0000-000000000011",
      "skipped"
    );
    const after = Date.now();
    expect(mocks.capturedDispositionSet?.disposition).toBe("skipped");
    const stamped = mocks.capturedDispositionSet?.skippedAt;
    expect(stamped).toBeInstanceOf(Date);
    const ts = (stamped as Date).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("clears skippedAt when transitioning to 'ignored'", async () => {
    const { queueSetDispositionAction } = await import(
      "@/app/app/queue-actions"
    );
    await queueSetDispositionAction(
      "draft:00000000-0000-0000-0000-000000000012",
      "ignored"
    );
    expect(mocks.capturedDispositionSet?.disposition).toBe("ignored");
    expect(mocks.capturedDispositionSet?.skippedAt).toBeNull();
  });

  it("rejects invalid disposition values via the Zod enum", async () => {
    const { queueSetDispositionAction } = await import(
      "@/app/app/queue-actions"
    );
    await expect(
      queueSetDispositionAction(
        "draft:00000000-0000-0000-0000-000000000013",
        // @ts-expect-error — intentionally bad input
        "totally_made_up"
      )
    ).rejects.toThrow();
    expect(mocks.capturedDispositionSet).toBeNull();
  });

  it("throws when card id is not a draft prefix", async () => {
    const { queueSetDispositionAction } = await import(
      "@/app/app/queue-actions"
    );
    await expect(
      queueSetDispositionAction(
        "proposal:00000000-0000-0000-0000-000000000014",
        "resolved"
      )
    ).rejects.toThrow("Disposition only applies to Draft cards");
    expect(mocks.capturedDispositionSet).toBeNull();
  });

  it("audits the disposition transition", async () => {
    const { queueSetDispositionAction } = await import(
      "@/app/app/queue-actions"
    );
    await queueSetDispositionAction(
      "draft:00000000-0000-0000-0000-000000000015",
      "skipped"
    );
    expect(mocks.logEmailAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "email_l2_completed",
        result: "success",
        detail: expect.objectContaining({ subAction: "disposition_skipped" }),
      })
    );
  });
});
