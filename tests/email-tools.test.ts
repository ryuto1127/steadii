import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-07 — chat agent email read tools. Verifies:
// 1. email_search filters by userId + sinceDays + sender/query
// 2. email_search returns truncated=true when more rows exist than limit
// 3. email_get_body resolves the body via getMessageFull, truncates at cap
// 4. email_get_body throws on cross-user lookup

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db/schema", () => ({
  inboxItems: {
    id: {},
    userId: {},
    deletedAt: {},
    receivedAt: {},
    senderEmail: {},
    senderDomain: {},
    sourceType: {},
    externalId: {},
    threadExternalId: {},
    senderName: {},
    subject: {},
    snippet: {},
  },
}));

vi.mock("drizzle-orm", () => ({
  and: (...xs: unknown[]) => ({ __and: xs }),
  or: (...xs: unknown[]) => ({ __or: xs.filter(Boolean) }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  gte: (col: unknown, val: unknown) => ({ __gte: [col, val] }),
  isNull: (col: unknown) => ({ __isNull: col }),
  ilike: (col: unknown, pattern: string) => ({ __ilike: [col, pattern] }),
  desc: (col: unknown) => ({ __desc: col }),
}));

type FakeRow = {
  id: string;
  userId: string;
  threadExternalId: string | null;
  externalId: string;
  senderEmail: string;
  senderName: string | null;
  senderDomain: string;
  subject: string | null;
  snippet: string | null;
  sourceType: string;
  receivedAt: Date;
  deletedAt: Date | null;
};

const fixture = {
  rows: [] as FakeRow[],
};

const lastSelect: { conditions: unknown; orderBy: unknown; limit: number | null } = {
  conditions: null,
  orderBy: null,
  limit: null,
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          lastSelect.conditions = cond;
          return {
            orderBy: (ob: unknown) => {
              lastSelect.orderBy = ob;
              return {
                limit: async (n: number) => {
                  lastSelect.limit = n;
                  // Return rows sorted DESC by receivedAt, capped at n.
                  return [...fixture.rows]
                    .sort(
                      (a, b) =>
                        b.receivedAt.getTime() - a.receivedAt.getTime()
                    )
                    .slice(0, n);
                },
              };
            },
            limit: async (n: number) => {
              lastSelect.limit = n;
              return [...fixture.rows].slice(0, n);
            },
          };
        },
      }),
    }),
  },
}));

const getMessageFullMock = vi.fn();
vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  getMessageFull: (...args: unknown[]) => getMessageFullMock(...args),
}));

const extractEmailBodyMock = vi.fn();
vi.mock("@/lib/agent/email/body-extract", () => ({
  extractEmailBody: (...args: unknown[]) => extractEmailBodyMock(...args),
}));

beforeEach(() => {
  fixture.rows = [];
  lastSelect.conditions = null;
  lastSelect.orderBy = null;
  lastSelect.limit = null;
  getMessageFullMock.mockReset();
  extractEmailBodyMock.mockReset();
});

describe("emailSearch", () => {
  it("returns recent inbox hits scoped to the user, sorted DESC by receivedAt", async () => {
    fixture.rows = [
      {
        id: "ib-1",
        userId: "user-1",
        threadExternalId: "th-1",
        externalId: "gmail-1",
        senderEmail: "prof@uni.edu",
        senderName: "Prof X",
        senderDomain: "uni.edu",
        subject: "Re: midterm",
        snippet: "Reminder about Friday's midterm…",
        sourceType: "gmail",
        receivedAt: new Date("2026-05-06T10:00:00Z"),
        deletedAt: null,
      },
      {
        id: "ib-2",
        userId: "user-1",
        threadExternalId: "th-2",
        externalId: "gmail-2",
        senderEmail: "stripe@stripe.com",
        senderName: "Stripe",
        senderDomain: "stripe.com",
        subject: "Action required",
        snippet: "Please submit a photo ID…",
        sourceType: "gmail",
        receivedAt: new Date("2026-05-07T12:00:00Z"),
        deletedAt: null,
      },
    ];

    const { emailSearch } = await import("@/lib/agent/tools/email");
    const result = await emailSearch.execute(
      { userId: "user-1" },
      { query: "id" }
    );

    expect(result.hits.length).toBe(2);
    expect(result.hits[0].inboxItemId).toBe("ib-2"); // most recent first
    expect(result.hits[0].subject).toBe("Action required");
    expect(result.truncated).toBe(false);
  });

  it("sets truncated=true when result count exceeds requested limit", async () => {
    fixture.rows = Array.from({ length: 25 }, (_, i) => ({
      id: `ib-${i}`,
      userId: "user-1",
      threadExternalId: null,
      externalId: `gm-${i}`,
      senderEmail: "x@y.com",
      senderName: null,
      senderDomain: "y.com",
      subject: `Subject ${i}`,
      snippet: `body ${i}`,
      sourceType: "gmail",
      receivedAt: new Date(2026, 4, 1, i),
      deletedAt: null,
    }));

    const { emailSearch } = await import("@/lib/agent/tools/email");
    const result = await emailSearch.execute(
      { userId: "user-1" },
      { limit: 10 }
    );

    expect(result.hits.length).toBe(10);
    expect(result.truncated).toBe(true);
    // The query asks for 10; the impl over-fetches by 1 to detect truncation.
    expect(lastSelect.limit).toBe(11);
  });

  it("splits multi-token query on whitespace and AND-combines the ILIKE clauses (one OR-of-subject-or-snippet per token)", async () => {
    // 2026-05-10 — regression. Previously the query was a single
    // literal substring, so "LayerX 返信" required that exact 8-char
    // string in subject/snippet. Token-level AND matches what the
    // agent expects from "search".
    fixture.rows = [];
    const { emailSearch } = await import("@/lib/agent/tools/email");
    await emailSearch.execute(
      { userId: "user-1" },
      { query: "LayerX 返信" }
    );

    // The captured conditions is the `and(...)` wrapper; inspect its
    // children for two OR-of-ILIKE clauses, one per token.
    const cond = lastSelect.conditions as { __and: unknown[] };
    expect(cond).toHaveProperty("__and");
    const orClauses = cond.__and.filter(
      (c): c is { __or: unknown[] } =>
        typeof c === "object" && c !== null && "__or" in c
    );
    expect(orClauses).toHaveLength(2);

    const patterns = orClauses.flatMap((c) =>
      (c.__or as Array<{ __ilike: [unknown, string] }>).map(
        (i) => i.__ilike[1]
      )
    );
    // 2026-05-12 — senderName added to the OR (alongside subject + snippet).
    // Each OR clause contributes 3 ILIKEs; 2 tokens × 3 = 6.
    expect(patterns).toHaveLength(6);
    expect(patterns).toContain("%LayerX%");
    expect(patterns).toContain("%返信%");
    // Both tokens appear 3 times (subject + snippet + senderName).
    expect(patterns.filter((p) => p === "%LayerX%")).toHaveLength(3);
    expect(patterns.filter((p) => p === "%返信%")).toHaveLength(3);
    // Neither token gets concatenated back together.
    expect(patterns).not.toContain("%LayerX 返信%");
  });

  it("collapses extra whitespace and skips empty tokens", async () => {
    fixture.rows = [];
    const { emailSearch } = await import("@/lib/agent/tools/email");
    await emailSearch.execute(
      { userId: "user-1" },
      { query: "  LayerX   インターン  " }
    );

    const cond = lastSelect.conditions as { __and: unknown[] };
    const orClauses = cond.__and.filter(
      (c): c is { __or: unknown[] } =>
        typeof c === "object" && c !== null && "__or" in c
    );
    expect(orClauses).toHaveLength(2);
  });

  it("escapes LIKE wildcards within a single token", async () => {
    fixture.rows = [];
    const { emailSearch } = await import("@/lib/agent/tools/email");
    await emailSearch.execute(
      { userId: "user-1" },
      { query: "50%_off" }
    );

    const cond = lastSelect.conditions as { __and: unknown[] };
    const orClauses = cond.__and.filter(
      (c): c is { __or: unknown[] } =>
        typeof c === "object" && c !== null && "__or" in c
    );
    expect(orClauses).toHaveLength(1);
    const patterns = orClauses.flatMap((c) =>
      (c.__or as Array<{ __ilike: [unknown, string] }>).map(
        (i) => i.__ilike[1]
      )
    );
    // Both % and _ should be backslash-escaped inside the wrapped %...%.
    expect(patterns[0]).toBe("%50\\%\\_off%");
  });

  it("rejects empty args (no query / sender) by zod default — both query and sender absent is allowed at schema level", async () => {
    // The schema makes everything optional so the agent can list-recent
    // by default. Behavior parity with tasks_list (which also defaults
    // to wide-open list when no narrowing args are given).
    fixture.rows = [];
    const { emailSearch } = await import("@/lib/agent/tools/email");
    const result = await emailSearch.execute(
      { userId: "user-1" },
      {}
    );
    expect(result.hits).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});

describe("emailGetBody", () => {
  it("fetches the full body, truncates at the cap, and reports truncated=true", async () => {
    fixture.rows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        userId: "user-1",
        threadExternalId: null,
        externalId: "gmail-9",
        senderEmail: "x@y.com",
        senderName: null,
        senderDomain: "y.com",
        subject: "Subj",
        snippet: "snip",
        sourceType: "gmail",
        receivedAt: new Date("2026-05-07T01:00:00Z"),
        deletedAt: null,
      },
    ];
    getMessageFullMock.mockResolvedValueOnce({});
    extractEmailBodyMock.mockReturnValueOnce({
      text: "x".repeat(8500),
      format: "text/plain",
    });

    const { emailGetBody } = await import("@/lib/agent/tools/email");
    const result = await emailGetBody.execute(
      { userId: "user-1" },
      { inboxItemId: "11111111-1111-4111-8111-111111111111" }
    );

    expect(result.body.length).toBe(8000);
    expect(result.truncated).toBe(true);
    expect(result.format).toBe("text/plain");
    expect(getMessageFullMock).toHaveBeenCalledWith("user-1", "gmail-9");
  });

  it("returns truncated=false when body fits under the cap", async () => {
    fixture.rows = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        userId: "user-1",
        threadExternalId: null,
        externalId: "gmail-9",
        senderEmail: "x@y.com",
        senderName: null,
        senderDomain: "y.com",
        subject: "Short",
        snippet: "snip",
        sourceType: "gmail",
        receivedAt: new Date("2026-05-07T01:00:00Z"),
        deletedAt: null,
      },
    ];
    getMessageFullMock.mockResolvedValueOnce({});
    extractEmailBodyMock.mockReturnValueOnce({
      text: "Short reply body.",
      format: "text/plain",
    });

    const { emailGetBody } = await import("@/lib/agent/tools/email");
    const result = await emailGetBody.execute(
      { userId: "user-1" },
      { inboxItemId: "11111111-1111-4111-8111-111111111111" }
    );

    expect(result.body).toBe("Short reply body.");
    expect(result.truncated).toBe(false);
  });

  it("throws when the inbox_item is not found / not owned by the user", async () => {
    fixture.rows = [];
    const { emailGetBody } = await import("@/lib/agent/tools/email");
    await expect(
      emailGetBody.execute(
        { userId: "user-1" },
        { inboxItemId: "00000000-0000-0000-0000-000000000000" }
      )
    ).rejects.toThrow(/not found/i);
    expect(getMessageFullMock).not.toHaveBeenCalled();
  });

  it("throws on non-gmail sourceType (defensive — body fetch path is gmail-only)", async () => {
    fixture.rows = [
      {
        id: "22222222-2222-4222-8222-222222222222",
        userId: "user-1",
        threadExternalId: null,
        externalId: "imap-1",
        senderEmail: "x@y.com",
        senderName: null,
        senderDomain: "y.com",
        subject: "From IMAP",
        snippet: "?",
        sourceType: "imap",
        receivedAt: new Date(),
        deletedAt: null,
      },
    ];
    const { emailGetBody } = await import("@/lib/agent/tools/email");
    await expect(
      emailGetBody.execute({ userId: "user-1" }, { inboxItemId: "22222222-2222-4222-8222-222222222222" })
    ).rejects.toThrow(/gmail/i);
  });
});

describe("EMAIL_TOOLS registration shape", () => {
  it("exports both tools with mutability=read", async () => {
    const { EMAIL_TOOLS } = await import("@/lib/agent/tools/email");
    const names = EMAIL_TOOLS.map((t) => t.schema.name);
    expect(names).toContain("email_search");
    expect(names).toContain("email_get_body");
    for (const t of EMAIL_TOOLS) {
      expect(t.schema.mutability).toBe("read");
    }
  });
});
