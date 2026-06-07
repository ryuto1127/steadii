import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-06-07 — digest-email noise floor coverage for
// loadPendingDigestItems. Two gates, EMAIL-only (the in-app queue is
// untouched):
//   1. recency gate — drafts older than DIGEST_RECENCY_DAYS (30d) are
//      excluded via a `gt(createdAt, cutoff)` in the WHERE.
//   2. importance floor — LOW-risk notify_only FYIs are dropped;
//      draft_reply / ask_clarifying always pass; notify_only passes only
//      at medium/high risk.
//
// The mock db mimics Drizzle's chainable shape just enough for this
// loader and replays a fixed synthetic row set. The recency gate lives
// in the WHERE (the DB would apply it), so the mock can't filter on it
// directly — instead we spy on `gt` to prove the loader builds a cutoff
// ~30 days back against the createdAt column, and we drive the
// importance floor / ordering / cap through the post-fetch JS path that
// the loader runs on the returned rows.

vi.mock("server-only", () => ({}));

type Row = {
  agentDraftId: string;
  inboxItemId: string;
  riskTier: "low" | "medium" | "high";
  action: "draft_reply" | "ask_clarifying" | "notify_only";
  createdAt: Date;
  senderEmail: string;
  senderName: string | null;
  subject: string | null;
};

// Replayed by the mock select chain. Each test resets this.
let returnedRows: Row[] = [];

const mockDb = {
  select(_shape?: Record<string, unknown>) {
    void _shape;
    return {
      from(_table: unknown) {
        void _table;
        return {
          innerJoin(_t: unknown, _on: unknown) {
            void _t;
            void _on;
            return {
              where(_w: unknown) {
                void _w;
                return {
                  orderBy(_o: unknown) {
                    void _o;
                    return {
                      limit: async (_n: number) => {
                        void _n;
                        return returnedRows;
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
  },
};

vi.mock("@/lib/db/client", () => ({ db: mockDb }));

vi.mock("@/lib/db/schema", () => ({
  agentDrafts: {
    id: "agent_drafts.id",
    inboxItemId: "agent_drafts.inbox_item_id",
    riskTier: "agent_drafts.risk_tier",
    action: "agent_drafts.action",
    createdAt: "agent_drafts.created_at",
    userId: "agent_drafts.user_id",
    status: "agent_drafts.status",
  },
  agentProposals: {},
  inboxItems: {
    id: "inbox_items.id",
    senderEmail: "inbox_items.sender_email",
    senderName: "inbox_items.sender_name",
    subject: "inbox_items.subject",
  },
  users: {},
}));

vi.mock("@/lib/env", () => ({
  env: () => ({ APP_URL: "https://mysteadii.com" }),
}));

// Spy targets — capture the args the loader passes to drizzle helpers so
// we can prove the recency WHERE predicate without a real DB.
const gtCalls: Array<{ column: unknown; value: unknown }> = [];

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ _op: "and", args }),
  desc: (col: unknown) => ({ _op: "desc", col }),
  eq: (col: unknown, value: unknown) => ({ _op: "eq", col, value }),
  inArray: (col: unknown, values: unknown) => ({ _op: "inArray", col, values }),
  isNull: (col: unknown) => ({ _op: "isNull", col }),
  gt: (column: unknown, value: unknown) => {
    gtCalls.push({ column, value });
    return { _op: "gt", column, value };
  },
}));

const { loadPendingDigestItems } = await import("@/lib/digest/build");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-07T09:00:00Z").getTime();

function row(overrides: Partial<Row> & { agentDraftId: string }): Row {
  return {
    inboxItemId: `ibx-${overrides.agentDraftId}`,
    riskTier: "medium",
    action: "draft_reply",
    createdAt: new Date(NOW - 2 * DAY_MS),
    senderEmail: `sender-${overrides.agentDraftId}@example.com`,
    senderName: `Sender ${overrides.agentDraftId}`,
    subject: `Subject ${overrides.agentDraftId}`,
    ...overrides,
  };
}

beforeEach(() => {
  returnedRows = [];
  gtCalls.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

describe("loadPendingDigestItems — recency gate", () => {
  it("builds a gt(createdAt, cutoff) cutoff ~30 days back", async () => {
    returnedRows = [row({ agentDraftId: "a" })];
    await loadPendingDigestItems("user-1");

    const recencyCall = gtCalls.find(
      (c) => c.column === "agent_drafts.created_at"
    );
    expect(recencyCall).toBeTruthy();
    const cutoff = recencyCall!.value as Date;
    expect(cutoff).toBeInstanceOf(Date);
    // 30 days before the frozen "now".
    expect(cutoff.getTime()).toBe(NOW - 30 * DAY_MS);
  });

  it("includes a recent draft_reply (created 2 days ago)", async () => {
    returnedRows = [
      row({ agentDraftId: "recent", createdAt: new Date(NOW - 2 * DAY_MS) }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items.map((i) => i.agentDraftId)).toEqual(["recent"]);
  });

  it("excludes a stale draft_reply (created 40 days ago)", async () => {
    // The real DB would never return this row (the gt filters it). We
    // simulate that here: the mock returns only what survives the WHERE.
    returnedRows = [];
    const items = await loadPendingDigestItems("user-1");
    expect(items).toEqual([]);
  });
});

describe("loadPendingDigestItems — importance floor", () => {
  it("excludes a recent LOW-risk notify_only FYI", async () => {
    returnedRows = [
      row({ agentDraftId: "fyi-low", action: "notify_only", riskTier: "low" }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items).toEqual([]);
  });

  it("includes a recent HIGH-risk notify_only FYI", async () => {
    returnedRows = [
      row({
        agentDraftId: "fyi-high",
        action: "notify_only",
        riskTier: "high",
      }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items.map((i) => i.agentDraftId)).toEqual(["fyi-high"]);
  });

  it("includes a recent MEDIUM-risk notify_only FYI", async () => {
    returnedRows = [
      row({
        agentDraftId: "fyi-med",
        action: "notify_only",
        riskTier: "medium",
      }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items.map((i) => i.agentDraftId)).toEqual(["fyi-med"]);
  });

  it("includes a recent ask_clarifying regardless of risk (unchanged)", async () => {
    returnedRows = [
      row({
        agentDraftId: "ask-low",
        action: "ask_clarifying",
        riskTier: "low",
      }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items.map((i) => i.agentDraftId)).toEqual(["ask-low"]);
  });

  it("includes a LOW-risk draft_reply (action items always pass the floor)", async () => {
    returnedRows = [
      row({
        agentDraftId: "reply-low",
        action: "draft_reply",
        riskTier: "low",
      }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items.map((i) => i.agentDraftId)).toEqual(["reply-low"]);
  });

  it("drops only the LOW notify_only from a mixed set, keeps the rest", async () => {
    returnedRows = [
      row({ agentDraftId: "reply", action: "draft_reply", riskTier: "low" }),
      row({ agentDraftId: "ask", action: "ask_clarifying", riskTier: "low" }),
      row({ agentDraftId: "fyi-low", action: "notify_only", riskTier: "low" }),
      row({
        agentDraftId: "fyi-high",
        action: "notify_only",
        riskTier: "high",
      }),
    ];
    const items = await loadPendingDigestItems("user-1");
    const ids = items.map((i) => i.agentDraftId);
    expect(ids).toContain("reply");
    expect(ids).toContain("ask");
    expect(ids).toContain("fyi-high");
    expect(ids).not.toContain("fyi-low");
    expect(ids).toHaveLength(3);
  });
});

describe("loadPendingDigestItems — ordering + cap unchanged", () => {
  it("orders high risk before medium before low, newest-first within a tier", async () => {
    returnedRows = [
      row({
        agentDraftId: "low-new",
        riskTier: "low",
        action: "draft_reply",
        createdAt: new Date(NOW - 1 * DAY_MS),
      }),
      row({
        agentDraftId: "high-old",
        riskTier: "high",
        action: "draft_reply",
        createdAt: new Date(NOW - 5 * DAY_MS),
      }),
      row({
        agentDraftId: "high-new",
        riskTier: "high",
        action: "draft_reply",
        createdAt: new Date(NOW - 2 * DAY_MS),
      }),
      row({
        agentDraftId: "med",
        riskTier: "medium",
        action: "draft_reply",
        createdAt: new Date(NOW - 3 * DAY_MS),
      }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items.map((i) => i.agentDraftId)).toEqual([
      "high-new",
      "high-old",
      "med",
      "low-new",
    ]);
  });

  it("caps the result at the requested limit after filtering", async () => {
    returnedRows = Array.from({ length: 20 }, (_, n) =>
      row({
        agentDraftId: `r-${n}`,
        action: "draft_reply",
        riskTier: "medium",
        createdAt: new Date(NOW - (n + 1) * 60 * 60 * 1000),
      })
    );
    const items = await loadPendingDigestItems("user-1", 5);
    expect(items).toHaveLength(5);
  });

  it("returns an empty list when nothing survives the gates", async () => {
    returnedRows = [];
    const items = await loadPendingDigestItems("user-1");
    expect(items).toEqual([]);
  });

  it("falls back senderName→senderEmail and subject→(no subject)", async () => {
    returnedRows = [
      row({
        agentDraftId: "nullish",
        senderName: null,
        subject: null,
        senderEmail: "fallback@example.com",
      }),
    ];
    const items = await loadPendingDigestItems("user-1");
    expect(items[0].senderName).toBe("fallback@example.com");
    expect(items[0].subject).toBe("(no subject)");
  });
});
