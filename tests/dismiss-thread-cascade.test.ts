import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-07 dogfood: Ryuto pressed Skip on a GhostFilter recruiter card
// and the same card kept reappearing. Root cause = each follow-up email
// in a recruiter thread creates its own agent_drafts row; the queue
// dedup (PR #156) collapses them visually but the dismiss only touched
// the most-recent draft, so the next render surfaced the next-newest
// pending draft from the same thread. Fix: dismiss/snooze cascades to
// every pending draft sharing the threadExternalId.

vi.mock("server-only", () => ({}));
vi.mock("@sentry/nextjs", () => ({
  captureException: () => {},
}));

vi.mock("@/lib/auth/config", () => ({
  auth: () => Promise.resolve({ user: { id: "user-1" } }),
}));

vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: vi.fn(),
}));

vi.mock("@/lib/agent/email/feedback", () => ({
  recordSenderFeedback: vi.fn(),
}));

vi.mock("@/lib/agent/tools/gmail", () => ({
  deleteGmailDraft: vi.fn(),
}));

vi.mock("@/lib/integrations/qstash/client", () => ({
  qstash: () => ({ messages: { delete: vi.fn() } }),
}));

vi.mock("@/lib/agent/email/send-enqueue", () => ({
  enqueueSendForDraft: vi.fn(),
}));

vi.mock("@/lib/classes/save", () => ({
  createClass: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/db/schema", () => ({
  agentDrafts: { id: {}, userId: {}, inboxItemId: {}, status: {} },
  inboxItems: { id: {}, userId: {}, threadExternalId: {}, status: {} },
  agentRules: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => args,
  eq: () => ({}),
  inArray: (_col: unknown, ids: string[]) => ({ __inArray: ids }),
}));

type FakeDraft = {
  id: string;
  userId: string;
  inboxItemId: string;
  status: string;
  action: "draft_reply" | "ask_clarifying" | "notify_only" | "no_op";
};

type FakeInbox = {
  id: string;
  userId: string;
  threadExternalId: string | null;
  senderEmail: string;
  senderDomain: string;
  status: "open" | "snoozed" | "dismissed";
};

const fixture = {
  drafts: [] as FakeDraft[],
  inboxItems: [] as FakeInbox[],
  // The currently-loading draft id is pinned by the test before each
  // call so the loadDraftAndInbox mock can resolve correctly.
  currentDraftId: "" as string,
  // Tracks which threadExternalId the cascade-helper select should
  // resolve. Pinned per-call by the test alongside currentDraftId.
  currentThreadId: null as string | null,
};

const updateOps: Array<{
  table: "agentDrafts" | "inboxItems";
  patch: Record<string, unknown>;
  inArrayIds: string[] | null;
}> = [];

let nextUpdateTable: "agentDrafts" | "inboxItems" = "agentDrafts";

vi.mock("@/lib/db/client", () => ({
  db: {
    select: (proj?: { id?: unknown; draft?: unknown; inbox?: unknown }) => {
      const isJoin = proj && "draft" in proj;
      const isThreadIdOnly = proj && "id" in proj && !("draft" in proj);
      return {
        from: () => ({
          innerJoin: () => ({
            where: () => ({
              limit: async () => {
                if (!isJoin) return [];
                const draft = fixture.drafts.find(
                  (d) => d.id === fixture.currentDraftId
                );
                if (!draft) return [];
                const inbox = fixture.inboxItems.find(
                  (x) => x.id === draft.inboxItemId
                );
                if (!inbox) return [];
                return [{ draft, inbox }];
              },
            }),
          }),
          where: () => {
            // Two end-shapes: .limit() (loadDraftAndInbox path with no
            // join — not used here) or no-limit terminal awaitable used
            // by the cascade helper's thread-id select.
            const terminal = {
              then: (resolve: (rows: unknown) => void) => {
                if (isThreadIdOnly) {
                  const rows = fixture.inboxItems
                    .filter(
                      (x) =>
                        x.userId === "user-1" &&
                        x.threadExternalId === fixture.currentThreadId
                    )
                    .map((x) => ({ id: x.id }));
                  resolve(rows);
                  return;
                }
                resolve([]);
              },
              limit: async () => [],
            };
            return terminal;
          },
        }),
      };
    },
    update: (table: unknown) => {
      // Schema mock above gives agentDrafts an `inboxItemId` field; that
      // distinguishes it from inboxItems. Just track call order: the
      // cascade helper updates agentDrafts first, then inboxItems.
      const t = nextUpdateTable;
      nextUpdateTable = t === "agentDrafts" ? "inboxItems" : "agentDrafts";
      void table;
      return {
        set: (patch: Record<string, unknown>) => ({
          where: async (predicate: unknown) => {
            // Try to extract the inArray IDs from the predicate so the
            // test can assert the cascade widened beyond the originating
            // row.
            let ids: string[] | null = null;
            const flatten = (n: unknown): unknown[] =>
              Array.isArray(n) ? n.flatMap(flatten) : [n];
            for (const node of flatten(predicate)) {
              if (
                node &&
                typeof node === "object" &&
                "__inArray" in (node as Record<string, unknown>)
              ) {
                ids = (node as { __inArray: string[] }).__inArray;
                break;
              }
            }
            updateOps.push({ table: t, patch, inArrayIds: ids });
          },
        }),
      };
    },
  },
}));

beforeEach(() => {
  fixture.drafts = [];
  fixture.inboxItems = [];
  fixture.currentDraftId = "";
  fixture.currentThreadId = null;
  updateOps.length = 0;
  nextUpdateTable = "agentDrafts";
});

describe("dismissAgentDraftAction — cascade across thread", () => {
  it("dismisses every pending draft in the same thread, not just the originating one", async () => {
    fixture.inboxItems = [
      { id: "ib-1", userId: "user-1", threadExternalId: "GF-1", senderEmail: "x@gf.io", senderDomain: "gf.io", status: "open" },
      { id: "ib-2", userId: "user-1", threadExternalId: "GF-1", senderEmail: "x@gf.io", senderDomain: "gf.io", status: "open" },
      { id: "ib-3", userId: "user-1", threadExternalId: "GF-1", senderEmail: "x@gf.io", senderDomain: "gf.io", status: "open" },
      { id: "ib-other", userId: "user-1", threadExternalId: "OTHER", senderEmail: "y@x.com", senderDomain: "x.com", status: "open" },
    ];
    fixture.drafts = [
      { id: "d-1", userId: "user-1", inboxItemId: "ib-1", status: "pending", action: "draft_reply" },
      { id: "d-2", userId: "user-1", inboxItemId: "ib-2", status: "pending", action: "draft_reply" },
      { id: "d-3", userId: "user-1", inboxItemId: "ib-3", status: "pending", action: "draft_reply" },
      { id: "d-other", userId: "user-1", inboxItemId: "ib-other", status: "pending", action: "draft_reply" },
    ];
    fixture.currentDraftId = "d-1";
    fixture.currentThreadId = "GF-1";

    const { dismissAgentDraftAction } = await import("@/lib/agent/email/draft-actions");
    await dismissAgentDraftAction("d-1");

    // Two updates: agentDrafts → status=dismissed, inboxItems → status=dismissed.
    expect(updateOps.length).toBe(2);
    expect(updateOps[0].patch.status).toBe("dismissed");
    expect(updateOps[1].patch.status).toBe("dismissed");
    // The cascade pulled all 3 thread members (ib-1, ib-2, ib-3) into the
    // inArray; the 4th unrelated thread (ib-other) is excluded.
    expect(updateOps[0].inArrayIds).toEqual(["ib-1", "ib-2", "ib-3"]);
    expect(updateOps[1].inArrayIds).toEqual(["ib-1", "ib-2", "ib-3"]);
  });
});

describe("snoozeAgentDraftAction — cascade across thread", () => {
  it("snoozes inbox_items + dismisses pending drafts for every member of the thread", async () => {
    fixture.inboxItems = [
      { id: "ib-a", userId: "user-1", threadExternalId: "TH-A", senderEmail: "a@x.com", senderDomain: "x.com", status: "open" },
      { id: "ib-b", userId: "user-1", threadExternalId: "TH-A", senderEmail: "a@x.com", senderDomain: "x.com", status: "open" },
    ];
    fixture.drafts = [
      { id: "da", userId: "user-1", inboxItemId: "ib-a", status: "pending", action: "draft_reply" },
      { id: "db", userId: "user-1", inboxItemId: "ib-b", status: "pending", action: "draft_reply" },
    ];
    fixture.currentDraftId = "da";
    fixture.currentThreadId = "TH-A";

    const { snoozeAgentDraftAction } = await import("@/lib/agent/email/draft-actions");
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await snoozeAgentDraftAction("da", until);

    expect(updateOps.length).toBe(2);
    // First UPDATE = agentDrafts → dismissed; second = inboxItems → snoozed with resolvedAt set.
    expect(updateOps[0].patch.status).toBe("dismissed");
    expect(updateOps[1].patch.status).toBe("snoozed");
    expect(updateOps[1].patch.resolvedAt).toBeInstanceOf(Date);
    expect(updateOps[0].inArrayIds).toEqual(["ib-a", "ib-b"]);
  });
});

describe("dismissAgentDraftAction — null threadExternalId fallback", () => {
  it("when threadExternalId is null, falls back to single-row dismiss (no over-cascade)", async () => {
    fixture.inboxItems = [
      { id: "ib-orphan", userId: "user-1", threadExternalId: null, senderEmail: "z@x.com", senderDomain: "x.com", status: "open" },
      { id: "ib-other-null", userId: "user-1", threadExternalId: null, senderEmail: "y@x.com", senderDomain: "x.com", status: "open" },
    ];
    fixture.drafts = [
      { id: "do", userId: "user-1", inboxItemId: "ib-orphan", status: "pending", action: "draft_reply" },
      { id: "do2", userId: "user-1", inboxItemId: "ib-other-null", status: "pending", action: "draft_reply" },
    ];
    fixture.currentDraftId = "do";
    fixture.currentThreadId = null;

    const { dismissAgentDraftAction } = await import("@/lib/agent/email/draft-actions");
    await dismissAgentDraftAction("do");

    // Two updates expected (single-row branch). Neither update should
    // carry an inArray — they target a single id with eq().
    expect(updateOps.length).toBe(2);
    expect(updateOps[0].patch.status).toBe("dismissed");
    expect(updateOps[1].patch.status).toBe("dismissed");
    expect(updateOps[0].inArrayIds).toBeNull();
    expect(updateOps[1].inArrayIds).toBeNull();
  });
});
