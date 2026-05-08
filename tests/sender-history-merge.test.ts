import { beforeEach, describe, expect, it, vi } from "vitest";

// 2026-05-08 — sender-history merge: Steadii-mediated sends + direct
// Gmail replies, deduped by gmail message id. Engineer-38's original
// loader only saw `agent_drafts.status='sent'`, missing the case where
// the user replied via Gmail directly (most common during dogfood when
// Steadii's UI isn't always the path of least resistance).
//
// The merged loader fetches both sources in parallel, dedupes by
// `agent_drafts.gmail_sent_message_id` ↔ Gmail message id, sorts the
// fused list newest-first, and returns the top K.

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const inboxItemsSchema = {
  id: tag("inboxItems.id"),
  senderEmail: tag("inboxItems.senderEmail"),
  subject: tag("inboxItems.subject"),
  snippet: tag("inboxItems.snippet"),
};

const agentDraftsSchema = {
  id: tag("agentDrafts.id"),
  userId: tag("agentDrafts.userId"),
  inboxItemId: tag("agentDrafts.inboxItemId"),
  status: tag("agentDrafts.status"),
  draftSubject: tag("agentDrafts.draftSubject"),
  draftBody: tag("agentDrafts.draftBody"),
  sentAt: tag("agentDrafts.sentAt"),
  gmailSentMessageId: tag("agentDrafts.gmailSentMessageId"),
};

vi.mock("@/lib/db/schema", () => ({
  inboxItems: inboxItemsSchema,
  agentDrafts: agentDraftsSchema,
  classes: {},
  emailEmbeddings: {},
  assignments: {},
  mistakeNotes: {},
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  isNull: (col: unknown) => ({ kind: "isNull", col }),
  isNotNull: (col: unknown) => ({ kind: "isNotNull", col }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  gte: () => ({}),
  lt: () => ({}),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      Array.from(strings).join(""),
    {
      raw: (s: string) => s,
    }
  ),
}));

type SteadiiRow = {
  draftId: string;
  draftSubject: string | null;
  draftBody: string | null;
  sentAt: Date;
  originalSubject: string | null;
  originalSnippet: string | null;
  gmailSentMessageId: string | null;
};

type GmailDirect = {
  messageId: string;
  threadId: string | null;
  subject: string | null;
  body: string;
  sentAt: Date;
};

const fixture = {
  steadiiRows: [] as SteadiiRow[],
  gmailRows: [] as GmailDirect[],
  gmailFetchShouldThrow: false,
};

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async (n: number) => fixture.steadiiRows.slice(0, n),
            }),
          }),
        }),
      }),
    }),
  },
}));

vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  fetchSentMessagesToRecipient: vi
    .fn<() => Promise<GmailDirect[]>>(async () => {
      if (fixture.gmailFetchShouldThrow) {
        throw new Error("gmail unavailable");
      }
      return fixture.gmailRows;
    }),
}));

vi.mock("@/lib/integrations/google/calendar", () => ({
  fetchUpcomingEvents: vi.fn(),
}));
vi.mock("@/lib/integrations/google/tasks", () => ({
  fetchUpcomingTasks: vi.fn(),
}));
vi.mock("@/lib/integrations/microsoft/calendar", () => ({
  fetchMsUpcomingEvents: vi.fn(),
}));
vi.mock("@/lib/integrations/microsoft/tasks", () => ({
  fetchMsUpcomingTasks: vi.fn(),
}));
vi.mock("@/lib/integrations/ical/queries", () => ({
  fetchUpcomingIcalEvents: vi.fn(),
}));
vi.mock("./audit", () => ({ logEmailAudit: vi.fn() }));
vi.mock("./retrieval", () => ({ searchSimilarEmails: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({
  startSpan: (_o: unknown, fn: () => unknown) => fn(),
  captureException: vi.fn(),
}));

beforeEach(() => {
  fixture.steadiiRows = [];
  fixture.gmailRows = [];
  fixture.gmailFetchShouldThrow = false;
});

describe("loadSenderHistory — merged Steadii + Gmail-direct", () => {
  it("merges both sources and sorts DESC by sentAt across sources", async () => {
    fixture.steadiiRows = [
      {
        draftId: "d-old",
        draftSubject: "Re: Q1",
        draftBody: "Steadii reply A",
        sentAt: new Date("2026-04-10T10:00:00Z"),
        originalSubject: "Q1",
        originalSnippet: "incoming Q1",
        gmailSentMessageId: "gm-A",
      },
    ];
    fixture.gmailRows = [
      {
        messageId: "gm-NEW",
        threadId: null,
        subject: "Re: Q2",
        body: "Direct gmail reply B",
        sentAt: new Date("2026-04-25T10:00:00Z"),
      },
    ];

    const { loadSenderHistory } = await import("@/lib/agent/email/fanout");
    const out = await loadSenderHistory("u1", "prof@uni.edu", 5);

    expect(out.length).toBe(2);
    // Newest-first: gmail-direct from 4/25 ahead of Steadii from 4/10.
    expect(out[0].source).toBe("gmail_direct");
    expect(out[0].draftBody).toBe("Direct gmail reply B");
    expect(out[1].source).toBe("steadii");
    expect(out[1].draftBody).toBe("Steadii reply A");
  });

  it("dedupes Gmail-direct hits whose id matches a Steadii sent's gmailSentMessageId", async () => {
    fixture.steadiiRows = [
      {
        draftId: "d-1",
        draftSubject: "Re: dup",
        draftBody: "Steadii canonical",
        sentAt: new Date("2026-04-22T10:00:00Z"),
        originalSubject: "dup",
        originalSnippet: null,
        gmailSentMessageId: "gm-DUP",
      },
    ];
    fixture.gmailRows = [
      {
        messageId: "gm-DUP", // SAME id as Steadii's gmail_sent_message_id
        threadId: null,
        subject: "Re: dup",
        body: "Should be dropped (duplicate)",
        sentAt: new Date("2026-04-22T10:00:01Z"),
      },
      {
        messageId: "gm-OTHER",
        threadId: null,
        subject: "Re: other",
        body: "Direct, kept",
        sentAt: new Date("2026-04-20T10:00:00Z"),
      },
    ];

    const { loadSenderHistory } = await import("@/lib/agent/email/fanout");
    const out = await loadSenderHistory("u1", "prof@uni.edu", 5);

    expect(out.length).toBe(2);
    const draftIds = out.map((h) => h.draftId);
    // The Steadii row is preserved (it carries originalSubject/Snippet);
    // the Gmail-direct duplicate is removed.
    expect(draftIds).toContain("d-1");
    expect(draftIds).toContain("gmail:gm-OTHER");
    expect(draftIds).not.toContain("gmail:gm-DUP");
  });

  it("caps the merged slate at k", async () => {
    fixture.steadiiRows = [
      {
        draftId: "d-1",
        draftSubject: null,
        draftBody: "s1",
        sentAt: new Date("2026-04-10T10:00:00Z"),
        originalSubject: null,
        originalSnippet: null,
        gmailSentMessageId: null,
      },
      {
        draftId: "d-2",
        draftSubject: null,
        draftBody: "s2",
        sentAt: new Date("2026-04-09T10:00:00Z"),
        originalSubject: null,
        originalSnippet: null,
        gmailSentMessageId: null,
      },
    ];
    fixture.gmailRows = [
      {
        messageId: "gm-1",
        threadId: null,
        subject: null,
        body: "g1",
        sentAt: new Date("2026-04-25T10:00:00Z"),
      },
      {
        messageId: "gm-2",
        threadId: null,
        subject: null,
        body: "g2",
        sentAt: new Date("2026-04-24T10:00:00Z"),
      },
      {
        messageId: "gm-3",
        threadId: null,
        subject: null,
        body: "g3",
        sentAt: new Date("2026-04-23T10:00:00Z"),
      },
    ];

    const { loadSenderHistory } = await import("@/lib/agent/email/fanout");
    const out = await loadSenderHistory("u1", "prof@uni.edu", 3);

    expect(out.length).toBe(3);
    // Top 3 newest are the 3 Gmail-direct hits.
    expect(out.map((h) => h.draftBody)).toEqual(["g1", "g2", "g3"]);
  });

  it("falls back to Steadii-only when Gmail fetch throws", async () => {
    fixture.steadiiRows = [
      {
        draftId: "d-1",
        draftSubject: "Re: ok",
        draftBody: "Steadii",
        sentAt: new Date("2026-04-22T10:00:00Z"),
        originalSubject: null,
        originalSnippet: null,
        gmailSentMessageId: null,
      },
    ];
    fixture.gmailFetchShouldThrow = true;

    const { loadSenderHistory } = await import("@/lib/agent/email/fanout");
    const out = await loadSenderHistory("u1", "prof@uni.edu", 5);

    // Gmail failure is swallowed; Steadii path still resolves cleanly.
    expect(out.length).toBe(1);
    expect(out[0].source).toBe("steadii");
    expect(out[0].draftBody).toBe("Steadii");
  });

  it("returns an empty array when both sources yield nothing", async () => {
    const { loadSenderHistory } = await import("@/lib/agent/email/fanout");
    const out = await loadSenderHistory("u1", "prof@uni.edu", 3);
    expect(out).toEqual([]);
  });
});
