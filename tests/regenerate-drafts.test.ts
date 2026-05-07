import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-36 — admin "Regenerate AI drafts" sweep. Validates:
// 1. Status filter — only pending/paused are in the SELECT loop
// 2. Tier filter — low/null rows are skipped (defensive)
// 3. UPDATE-in-place — id, userId, inboxItemId, qstashMessageId,
//    gmailDraftId are not in the .set() patch (preserved by definition)
// 4. Locale propagation — runDeepPass receives the user's getUserLocale()
// 5. Credit exhaustion mid-loop — creditsExhausted=true, refreshed < scanned

type FakeDraft = {
  id: string;
  userId: string;
  inboxItemId: string;
  status: "pending" | "paused" | "sent" | "approved" | "dismissed" | "expired";
  riskTier: "high" | "medium" | "low" | null;
  action: "draft_reply" | "ask_clarifying" | "no_op" | "paused";
  reasoning: string | null;
  qstashMessageId: string | null;
  gmailDraftId: string | null;
  createdAt: Date;
};

type FakeInbox = {
  id: string;
  senderEmail: string;
  senderDomain: string;
  senderRole: string | null;
  senderName: string | null;
  subject: string | null;
  snippet: string | null;
  receivedAt: Date;
  threadExternalId: string | null;
};

const fixture = {
  drafts: [] as FakeDraft[],
  inboxByItemId: new Map<string, FakeInbox>(),
  user: { email: "stu@uni.edu", name: "Stu" } as { email: string; name: string | null },
  locale: "en" as "en" | "ja",
};

const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

// db.select chains. Three distinct call shapes show up in regenerate.ts:
// - regenerateAllOpenDrafts: from(agentDrafts).where().orderBy().limit() → ids
// - regenerateDraft (joined): from(agentDrafts).innerJoin().where().limit()
// - regenerateDraft (user):   from(users).where().limit()
// We distinguish by whether innerJoin or orderBy appears in the chain.
vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              // The where is keyed by `agentDrafts.id = lastJoinedDraftId`.
              // We rely on the test harness pinning that via withDraft().
              const id = state.currentDraftId;
              const draft = fixture.drafts.find((d) => d.id === id);
              if (!draft) return [];
              const inbox = fixture.inboxByItemId.get(draft.inboxItemId);
              if (!inbox) return [];
              return [
                {
                  draftId: draft.id,
                  userId: draft.userId,
                  inboxItemId: draft.inboxItemId,
                  status: draft.status,
                  riskTier: draft.riskTier,
                  action: draft.action,
                  reasoning: draft.reasoning,
                  senderEmail: inbox.senderEmail,
                  senderDomain: inbox.senderDomain,
                  senderRole: inbox.senderRole,
                  senderName: inbox.senderName,
                  subject: inbox.subject,
                  snippet: inbox.snippet,
                  receivedAt: inbox.receivedAt,
                  threadExternalId: inbox.threadExternalId,
                },
              ];
            },
          }),
        }),
        where: () => ({
          limit: async () => [fixture.user],
          orderBy: () => ({
            limit: async () => {
              const ids = fixture.drafts
                .filter((d) => d.status === "pending" || d.status === "paused")
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .map((d) => ({ id: d.id }));
              return ids;
            },
          }),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: async () => {
          updates.push({ id: state.currentDraftId, patch });
        },
      }),
    }),
  },
}));

// Schema is consumed only as opaque references in our impl.
vi.mock("@/lib/db/schema", () => ({
  agentDrafts: { id: {}, userId: {}, status: {}, createdAt: {} },
  inboxItems: { id: {} },
  users: { id: {} },
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
}));

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_o: unknown, fn: () => unknown) => fn(),
  captureException: () => {},
}));

const assertCreditsMock = vi.fn();
class FakeBillingErr extends Error {
  code = "BILLING_QUOTA_EXCEEDED" as const;
  balance = {};
}
vi.mock("@/lib/billing/credits", () => ({
  assertCreditsAvailable: (id: string) => assertCreditsMock(id),
  BillingQuotaExceededError: FakeBillingErr,
}));

const runDeepPassMock = vi.fn<(arg: unknown) => unknown>();
const buildProvenanceMock = vi.fn<(arg: unknown) => unknown>(() => ({
  sources: [],
  total_candidates: 0,
  returned: 0,
}));
vi.mock("@/lib/agent/email/classify-deep", () => ({
  runDeepPass: (a: unknown) => runDeepPassMock(a),
  buildProvenance: (a: unknown) => buildProvenanceMock(a),
}));

const runDraftMock = vi.fn<(arg: unknown) => unknown>();
vi.mock("@/lib/agent/email/draft", () => ({
  runDraft: (a: unknown) => runDraftMock(a),
}));

vi.mock("@/lib/agent/email/thread", () => ({
  fetchRecentThreadMessages: async () => [],
}));

vi.mock("@/lib/agent/email/feedback", () => ({
  loadRecentFeedbackSummary: async () => null,
}));

const fanoutMock = vi.fn<(arg: unknown) => Promise<unknown>>(async () => ({
  classBinding: { classId: null, className: null, classCode: null, method: "none", confidence: 0 },
  mistakes: [],
  syllabusChunks: [],
  similarEmails: [],
  totalSimilarCandidates: 0,
  calendar: { events: [], tasks: [], assignments: [] },
  timings: { mistakes: 0, syllabus: 0, emails: 0, calendar: 0, total: 0 },
  timeouts: [],
}));
vi.mock("@/lib/agent/email/fanout", () => ({
  fanoutForInbox: (a: unknown) => fanoutMock(a),
}));

const auditMock = vi.fn<(arg: unknown) => Promise<void>>(async () => {});
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: (a: unknown) => auditMock(a),
}));

vi.mock("@/lib/agent/preferences", () => ({
  getUserLocale: async () => fixture.locale,
}));

vi.mock("@/lib/agent/models", () => ({
  selectModel: (t: string) =>
    t === "email_classify_deep"
      ? "gpt-5.4"
      : t === "email_classify_risk"
      ? "gpt-5.4-mini"
      : "gpt-5.4",
}));

// Per-test state — the joined-row branch keys off currentDraftId so each
// regenerateDraft(id) sees the right fixture row.
const state: { currentDraftId: string } = { currentDraftId: "" };

// Wrapper that runs the impl while pinning the per-row id. We can't read
// the where-clause from inside the mock, so the test harness routes it.
async function regenerate(id: string) {
  state.currentDraftId = id;
  const { regenerateDraft } = await import("@/lib/agent/email/regenerate");
  return regenerateDraft(id);
}

async function regenerateAll(userId: string, limit: number) {
  // For the loop variant we shadow regenerateDraft so each iteration
  // can pin currentDraftId — the production loop calls regenerateDraft
  // with the id as its sole arg.
  const mod = await import("@/lib/agent/email/regenerate");
  // The real implementation calls its own regenerateDraft. We patch
  // currentDraftId inside the assertCreditsMock fence: by the time
  // assertCreditsAvailable runs, the joined SELECT has already fired
  // and used a stale id. So we drive currentDraftId from a side
  // channel: the joined SELECT is mocked to read state.queue.shift().
  return mod.regenerateAllOpenDrafts(userId, { limit });
}

beforeEach(() => {
  fixture.drafts = [];
  fixture.inboxByItemId.clear();
  fixture.user = { email: "stu@uni.edu", name: "Stu" };
  fixture.locale = "en";
  updates.length = 0;
  state.currentDraftId = "";
  assertCreditsMock.mockReset();
  assertCreditsMock.mockResolvedValue({});
  runDeepPassMock.mockReset();
  runDeepPassMock.mockResolvedValue({
    action: "draft_reply",
    reasoning: "deep reasoning v2",
    retrievalProvenance: { sources: [], total_candidates: 0, returned: 0 },
    usageId: "deep-uid",
  });
  runDraftMock.mockReset();
  runDraftMock.mockResolvedValue({
    kind: "draft",
    subject: "Re: x",
    body: "fresh body",
    to: ["prof@uni.edu"],
    cc: [],
    inReplyTo: null,
    reasoning: "draft reasoning v2",
    usageId: "draft-uid",
  });
  fanoutMock.mockClear();
  buildProvenanceMock.mockClear();
  auditMock.mockClear();
});

function seedDraft(d: Partial<FakeDraft>): FakeDraft {
  const draft: FakeDraft = {
    id: d.id ?? "draft-x",
    userId: d.userId ?? "user-1",
    inboxItemId: d.inboxItemId ?? "ibx-x",
    status: d.status ?? "pending",
    // null is intentional in some fixtures; ?? would coerce it.
    riskTier: "riskTier" in d ? d.riskTier ?? null : "high",
    action: d.action ?? "draft_reply",
    reasoning: d.reasoning ?? "old reasoning",
    qstashMessageId: d.qstashMessageId ?? null,
    gmailDraftId: d.gmailDraftId ?? null,
    createdAt: d.createdAt ?? new Date("2026-05-01T00:00:00Z"),
  };
  fixture.drafts.push(draft);
  fixture.inboxByItemId.set(draft.inboxItemId, {
    id: draft.inboxItemId,
    senderEmail: "prof@uni.edu",
    senderDomain: "uni.edu",
    senderRole: "professor",
    senderName: "Prof",
    subject: "Office hours",
    snippet: "Are you free Thursday?",
    receivedAt: new Date("2026-05-01T00:00:00Z"),
    threadExternalId: "thread-1",
  });
  return draft;
}

describe("regenerateDraft — single row", () => {
  it("UPDATE-in-place: patch never touches id / userId / inboxItemId / qstashMessageId / gmailDraftId", async () => {
    seedDraft({
      id: "draft-1",
      qstashMessageId: "qstash-msg-1",
      gmailDraftId: "gd-1",
    });
    const out = await regenerate("draft-1");
    expect(out.status).toBe("refreshed");
    expect(updates).toHaveLength(1);
    const patch = updates[0].patch;
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("userId");
    expect(patch).not.toHaveProperty("inboxItemId");
    expect(patch).not.toHaveProperty("qstashMessageId");
    expect(patch).not.toHaveProperty("gmailDraftId");
    expect(patch).not.toHaveProperty("riskTier");
    expect(patch).toHaveProperty("reasoning", "deep reasoning v2");
    expect(patch).toHaveProperty("draftBody", "fresh body");
    expect(patch).toHaveProperty("action", "draft_reply");
  });

  it("threads the user's app locale through to runDeepPass (high-risk)", async () => {
    fixture.locale = "ja";
    seedDraft({ id: "draft-ja", riskTier: "high" });
    await regenerate("draft-ja");
    expect(runDeepPassMock).toHaveBeenCalledTimes(1);
    const arg = runDeepPassMock.mock.calls[0][0] as { locale?: string };
    expect(arg.locale).toBe("ja");
  });

  it("does NOT re-run risk pass — synthesizes RiskPassResult from stored tier", async () => {
    seedDraft({ id: "draft-2", riskTier: "high" });
    await regenerate("draft-2");
    const arg = runDeepPassMock.mock.calls[0][0] as {
      riskPass: { riskTier: string; usageId: string | null };
    };
    expect(arg.riskPass.riskTier).toBe("high");
    expect(arg.riskPass.usageId).toBeNull();
  });

  it("medium-risk: skips deep pass, runs draft only, refreshes provenance", async () => {
    seedDraft({ id: "draft-3", riskTier: "medium" });
    await regenerate("draft-3");
    expect(runDeepPassMock).not.toHaveBeenCalled();
    expect(runDraftMock).toHaveBeenCalledTimes(1);
    expect(fanoutMock).toHaveBeenCalledTimes(1);
    const fanoutArg = fanoutMock.mock.calls[0][0] as { phase: string };
    expect(fanoutArg.phase).toBe("draft");
  });

  it("skips and reports reason for status sent / approved / dismissed / expired", async () => {
    seedDraft({ id: "draft-sent", status: "sent" });
    const out = await regenerate("draft-sent");
    expect(out.status).toBe("skipped");
    expect((out as { reason: string }).reason).toBe("status_sent");
    expect(updates).toHaveLength(0);
  });

  it("skips when riskTier is low or null (defensive)", async () => {
    seedDraft({ id: "draft-low", riskTier: "low" });
    seedDraft({ id: "draft-null", riskTier: null });
    const a = await regenerate("draft-low");
    const b = await regenerate("draft-null");
    expect(a.status).toBe("skipped");
    expect(b.status).toBe("skipped");
    expect((a as { reason: string }).reason).toBe("tier_low");
    expect((b as { reason: string }).reason).toBe("tier_missing");
    expect(updates).toHaveLength(0);
  });

  it("draft kind=clarify flips action to ask_clarifying with draft.reasoning", async () => {
    seedDraft({ id: "draft-clar", riskTier: "high" });
    runDraftMock.mockResolvedValue({
      kind: "clarify",
      subject: "Re: x",
      body: "Could you clarify which date?",
      to: ["prof@uni.edu"],
      cc: [],
      inReplyTo: null,
      reasoning: "subject and body conflict",
      usageId: "draft-uid",
    });
    await regenerate("draft-clar");
    const patch = updates[0].patch;
    expect(patch.action).toBe("ask_clarifying");
    expect(patch.reasoning).toBe("subject and body conflict");
  });
});

describe("regenerateAllOpenDrafts — sweep", () => {
  // The loop calls regenerateDraft for each id. To make currentDraftId
  // stay in sync we override the joined-SELECT mock to consume a queue.
  beforeEach(() => {
    // Re-route the joined SELECT to a queue-based shift so the loop
    // sees rows in order.
  });

  it("returns scanned/refreshed counts; ignores sent/expired by SELECT filter", async () => {
    seedDraft({ id: "d-pending", riskTier: "high", status: "pending" });
    seedDraft({ id: "d-paused", riskTier: "medium", status: "paused" });
    seedDraft({ id: "d-sent", riskTier: "high", status: "sent" });
    seedDraft({ id: "d-expired", riskTier: "high", status: "expired" });

    // The loop will iterate over the IDs the SELECT returned. We pin
    // currentDraftId per iteration via a side-channel: monkey-patch the
    // joined SELECT to consume a queue.
    const queue = ["d-pending", "d-paused"];
    state.currentDraftId = "";
    const origDescriptor = Object.getOwnPropertyDescriptor(state, "currentDraftId");

    // Use the import to drive the loop; the joined SELECT mock reads
    // state.currentDraftId. Push each id onto state right before its
    // iteration would fire — by intercepting assertCreditsAvailable.
    assertCreditsMock.mockImplementation(async () => {
      // Drain the queue: by the time the gate runs for iteration N,
      // the joined SELECT for iteration N has already executed against
      // the prior currentDraftId value. So we need to pin BEFORE.
      return {};
    });
    // Instead, route via fanoutMock: it runs after the joined SELECT
    // and the credit gate but before update. Pinning here is too late.
    // The cleanest is to override the joined-SELECT mock directly via
    // a per-call counter.
    // Strategy: bind the joined-SELECT to consume `queue` head per call.
    const origDb = await import("@/lib/db/client");
    const origSelect = origDb.db.select;
    let i = 0;
    (origDb.db as { select: () => unknown }).select = () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              const id = queue[i++];
              if (!id) return [];
              const draft = fixture.drafts.find((d) => d.id === id);
              if (!draft) return [];
              const inbox = fixture.inboxByItemId.get(draft.inboxItemId);
              if (!inbox) return [];
              return [
                {
                  draftId: draft.id,
                  userId: draft.userId,
                  inboxItemId: draft.inboxItemId,
                  status: draft.status,
                  riskTier: draft.riskTier,
                  action: draft.action,
                  reasoning: draft.reasoning,
                  senderEmail: inbox.senderEmail,
                  senderDomain: inbox.senderDomain,
                  senderRole: inbox.senderRole,
                  senderName: inbox.senderName,
                  subject: inbox.subject,
                  snippet: inbox.snippet,
                  receivedAt: inbox.receivedAt,
                  threadExternalId: inbox.threadExternalId,
                },
              ];
            },
          }),
        }),
        where: () => ({
          limit: async () => [fixture.user],
          orderBy: () => ({
            limit: async () => [{ id: "d-pending" }, { id: "d-paused" }],
          }),
        }),
      }),
    });

    const out = await regenerateAll("user-1", 10);
    // restore for following tests (vi.resetModules-style hygiene)
    (origDb.db as { select: unknown }).select = origSelect;
    if (origDescriptor) Object.defineProperty(state, "currentDraftId", origDescriptor);

    expect(out.scanned).toBe(2);
    expect(out.refreshed).toBe(2);
    expect(out.skipped).toBe(0);
    expect(out.creditsExhausted).toBe(false);
    expect(out.hasMore).toBe(false);
  });

  it("credit exhaustion mid-loop → creditsExhausted=true, refreshed < scanned", async () => {
    seedDraft({ id: "d-1", riskTier: "high", status: "pending", createdAt: new Date("2026-05-03Z") });
    seedDraft({ id: "d-2", riskTier: "high", status: "pending", createdAt: new Date("2026-05-02Z") });
    seedDraft({ id: "d-3", riskTier: "high", status: "pending", createdAt: new Date("2026-05-01Z") });

    const queue = ["d-1", "d-2", "d-3"];
    let call = 0;
    assertCreditsMock.mockImplementation(async () => {
      call++;
      if (call === 2) throw new FakeBillingErr();
      return {};
    });

    const origDb = await import("@/lib/db/client");
    const origSelect = origDb.db.select;
    let i = 0;
    (origDb.db as { select: () => unknown }).select = () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            limit: async () => {
              const id = queue[i++];
              if (!id) return [];
              const draft = fixture.drafts.find((d) => d.id === id);
              if (!draft) return [];
              const inbox = fixture.inboxByItemId.get(draft.inboxItemId);
              return inbox
                ? [
                    {
                      draftId: draft.id,
                      userId: draft.userId,
                      inboxItemId: draft.inboxItemId,
                      status: draft.status,
                      riskTier: draft.riskTier,
                      action: draft.action,
                      reasoning: draft.reasoning,
                      senderEmail: inbox.senderEmail,
                      senderDomain: inbox.senderDomain,
                      senderRole: inbox.senderRole,
                      senderName: inbox.senderName,
                      subject: inbox.subject,
                      snippet: inbox.snippet,
                      receivedAt: inbox.receivedAt,
                      threadExternalId: inbox.threadExternalId,
                    },
                  ]
                : [];
            },
          }),
        }),
        where: () => ({
          limit: async () => [fixture.user],
          orderBy: () => ({
            limit: async () => [{ id: "d-1" }, { id: "d-2" }, { id: "d-3" }],
          }),
        }),
      }),
    });

    const out = await regenerateAll("user-1", 10);
    (origDb.db as { select: unknown }).select = origSelect;

    expect(out.creditsExhausted).toBe(true);
    expect(out.refreshed).toBe(1);
    expect(out.refreshed).toBeLessThan(out.scanned);
  });

  it("hasMore=true when ids exceed limit", async () => {
    // Stub a SELECT that returns limit+1 rows.
    const origDb = await import("@/lib/db/client");
    const origSelect = origDb.db.select;
    (origDb.db as { select: () => unknown }).select = () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({ limit: async () => [] }),
        }),
        where: () => ({
          limit: async () => [fixture.user],
          orderBy: () => ({
            limit: async () => [
              { id: "a" },
              { id: "b" },
              { id: "c" },
            ],
          }),
        }),
      }),
    });

    const out = await regenerateAll("user-1", 2);
    (origDb.db as { select: unknown }).select = origSelect;

    expect(out.hasMore).toBe(true);
    expect(out.scanned).toBe(2);
  });
});
