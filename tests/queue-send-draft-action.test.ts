import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// 2026-06-09 — queueSendDraftAction is a thin server-action wrapper around
// approveAgentDraftAction. The send contract changed: it now runs the
// pre-send fact-check (NO skipPreSendCheck) and returns the server's
// { sendAt, undoWindowSeconds } so the client drives its countdown from
// the authoritative server value. Branches under test:
//   1. card id parses as `draft:<uuid>` → forwards to approveAgentDraftAction
//      with NO options (check runs) and returns its result
//   2. queueSendDraftAnywayAction → the explicit "Send anyway" bypass
//      passes skipPreSendCheck=true (a user choice, never the silent default)
//   3. queueCancelSendDraftAction → delegates to cancelPendingSendAction
//   4. any non-draft prefix throws "Card is not a draft" before any DB work
//   5. a thrown PreSendCheckFailedError propagates to the caller (the
//      client surfaces the Review / Send-anyway panel)
//
// queueSetDispositionAction is the wrapper for the 3-way disposition
// buttons — same routing check + a Zod-validated disposition input.
//
// We mock out the heavy dependencies (auth, db, draft-actions) so the
// test stays a pure routing check.

const mocks = vi.hoisted(() => ({
  approveAgentDraftAction: vi.fn(),
  cancelPendingSendAction: vi.fn(),
  revalidatePath: vi.fn(),
  capturedDispositionSet: null as Record<string, unknown> | null,
  logEmailAudit: vi.fn(),
}));

vi.mock("@/lib/agent/email/draft-actions", () => ({
  approveAgentDraftAction: mocks.approveAgentDraftAction,
  cancelPendingSendAction: mocks.cancelPendingSendAction,
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
    mocks.cancelPendingSendAction.mockReset();
    mocks.cancelPendingSendAction.mockResolvedValue(undefined);
    mocks.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("forwards a draft:<uuid> card id to approveAgentDraftAction WITHOUT skipPreSendCheck (the check runs)", async () => {
    const { queueSendDraftAction } = await import("@/app/app/queue-actions");
    const cardId = "draft:00000000-0000-0000-0000-000000000001";
    const result = await queueSendDraftAction(cardId);

    expect(mocks.approveAgentDraftAction).toHaveBeenCalledTimes(1);
    // Called with just the id — no options object means the pre-send
    // fact-check runs (skipPreSendCheck defaults to false).
    expect(mocks.approveAgentDraftAction).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000001"
    );
    // The action returns the server's authoritative sendAt result so the
    // client can drive the countdown toast from it.
    expect(result).toHaveProperty("sendAt");
    expect(result).toHaveProperty("undoWindowSeconds", 10);
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

  it("propagates a PreSendCheckFailedError so the client can surface the warning panel", async () => {
    const err = new Error(
      JSON.stringify({
        name: "PreSendCheckFailedError",
        warnings: [{ phrase: "Friday at 2pm", why: "Not in the thread." }],
      })
    );
    err.name = "PreSendCheckFailedError";
    mocks.approveAgentDraftAction.mockRejectedValueOnce(err);
    const { queueSendDraftAction } = await import("@/app/app/queue-actions");
    await expect(
      queueSendDraftAction("draft:00000000-0000-0000-0000-000000000004")
    ).rejects.toThrow("PreSendCheckFailedError");
  });
});

describe("queueSendDraftAnywayAction", () => {
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

  it("passes skipPreSendCheck=true — an explicit user 'Send anyway' choice", async () => {
    const { queueSendDraftAnywayAction } = await import(
      "@/app/app/queue-actions"
    );
    const result = await queueSendDraftAnywayAction(
      "draft:00000000-0000-0000-0000-000000000005"
    );
    expect(mocks.approveAgentDraftAction).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000005",
      { skipPreSendCheck: true }
    );
    expect(result).toHaveProperty("undoWindowSeconds", 10);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("throws when the card id prefix is not 'draft'", async () => {
    const { queueSendDraftAnywayAction } = await import(
      "@/app/app/queue-actions"
    );
    await expect(
      queueSendDraftAnywayAction("proposal:00000000-0000-0000-0000-000000000006")
    ).rejects.toThrow("Card is not a draft");
    expect(mocks.approveAgentDraftAction).not.toHaveBeenCalled();
  });
});

describe("queueCancelSendDraftAction", () => {
  beforeEach(() => {
    mocks.cancelPendingSendAction.mockReset();
    mocks.cancelPendingSendAction.mockResolvedValue(undefined);
    mocks.revalidatePath.mockReset();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("delegates to cancelPendingSendAction with the underlying draft id", async () => {
    const { queueCancelSendDraftAction } = await import(
      "@/app/app/queue-actions"
    );
    await queueCancelSendDraftAction(
      "draft:00000000-0000-0000-0000-000000000007"
    );
    expect(mocks.cancelPendingSendAction).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000007"
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app");
  });

  it("throws when the card id prefix is not 'draft'", async () => {
    const { queueCancelSendDraftAction } = await import(
      "@/app/app/queue-actions"
    );
    await expect(
      queueCancelSendDraftAction("proposal:00000000-0000-0000-0000-000000000008")
    ).rejects.toThrow("Card is not a draft");
    expect(mocks.cancelPendingSendAction).not.toHaveBeenCalled();
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
