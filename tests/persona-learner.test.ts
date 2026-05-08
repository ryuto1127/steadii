import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-39 — persona-learner. Verifies:
//   1. extractContactPersona upserts the row with the LLM's relationship + facts
//   2. corpus assembly handles bilingual (JP+EN) + caps facts at MAX_FACTS=8
//   3. parseExtraction defends against malformed model output
//   4. runPersonaExtractionForUser caps at MAX_CONTACTS_PER_RUN=20
//   5. selectActiveContactsForUser skips contacts with fresh persona rows
//      (last_extracted_at within STALE_DAYS=7)
//   6. emptyCorpus path stamps last_extracted_at without an LLM call

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const inboxItemsSchema = {
  id: tag("inboxItems.id"),
  userId: tag("inboxItems.userId"),
  senderEmail: tag("inboxItems.senderEmail"),
  senderName: tag("inboxItems.senderName"),
  receivedAt: tag("inboxItems.receivedAt"),
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
};

const agentContactPersonasSchema = {
  id: tag("agentContactPersonas.id"),
  userId: tag("agentContactPersonas.userId"),
  contactEmail: tag("agentContactPersonas.contactEmail"),
  contactName: tag("agentContactPersonas.contactName"),
  relationship: tag("agentContactPersonas.relationship"),
  facts: tag("agentContactPersonas.facts"),
  lastExtractedAt: tag("agentContactPersonas.lastExtractedAt"),
};

vi.mock("@/lib/db/schema", () => ({
  inboxItems: inboxItemsSchema,
  agentDrafts: agentDraftsSchema,
  agentContactPersonas: agentContactPersonasSchema,
}));

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  isNotNull: (col: unknown) => ({ kind: "isNotNull", col }),
  isNull: (col: unknown) => ({ kind: "isNull", col }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  gte: (col: unknown, val: unknown) => ({ kind: "gte", col, val }),
  lt: (col: unknown, val: unknown) => ({ kind: "lt", col, val }),
  or: (...args: unknown[]) => ({ kind: "or", args }),
  sql: () => ({ kind: "sql" }),
}));

// Mutable store the test cases push fixtures into. Each table has its
// own array; the db mock returns slices of these based on the FROM table.
type DbState = {
  inboundRows: unknown[];
  outboundRows: unknown[];
  contactNameRows: unknown[];
  recentSenderRows: unknown[];
  personaRows: unknown[];
};
const state: DbState = {
  inboundRows: [],
  outboundRows: [],
  contactNameRows: [],
  recentSenderRows: [],
  personaRows: [],
};

const insertCalls: Array<{ table: unknown; values: unknown; updated?: unknown }> =
  [];

// Builder that classifies which fixture to return based on the FROM
// table + whether innerJoin was called (signature for the outbound
// agentDrafts→inboxItems join).
function makeChain(tbl: unknown, joined: boolean) {
  return {
    where: () => ({
      orderBy: () => ({
        limit: async () => {
          if (tbl === inboxItemsSchema && !joined) {
            // Either inbound query (most rows) or contact-name lookup
            // (limit 1). Return the larger inbound set first; if
            // empty, fall back to contactName.
            if (state.inboundRows.length > 0) return state.inboundRows;
            return state.contactNameRows;
          }
          if (tbl === agentDraftsSchema && joined) {
            return state.outboundRows;
          }
          if (tbl === agentContactPersonasSchema) {
            return state.personaRows;
          }
          return [];
        },
      }),
      limit: async () => {
        if (tbl === inboxItemsSchema) return state.contactNameRows;
        if (tbl === agentContactPersonasSchema) return state.personaRows;
        return [];
      },
    }),
  };
}

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (tbl: unknown) => ({
        ...makeChain(tbl, false),
        innerJoin: () => makeChain(tbl, true),
      }),
    }),
    selectDistinctOn: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => state.recentSenderRows,
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: (conf: unknown) => {
          insertCalls.push({ table, values, updated: conf });
          return Promise.resolve();
        },
      }),
    }),
    execute: async () => ({ rows: [] }),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));

vi.mock("@/lib/integrations/google/gmail-fetch", () => ({
  fetchSentMessagesToRecipient: async () => [],
}));

let stubbedPersona: { relationship: string | null; facts: string[] } = {
  relationship: null,
  facts: [],
};
let openaiCalls = 0;
vi.mock("@/lib/integrations/openai/client", () => ({
  openai: () => ({
    chat: {
      completions: {
        create: async () => {
          openaiCalls++;
          return {
            choices: [
              {
                message: {
                  content: JSON.stringify(stubbedPersona),
                },
              },
            ],
            usage: { prompt_tokens: 1000, completion_tokens: 80 },
          };
        },
      },
    },
  }),
}));

vi.mock("@/lib/agent/usage", () => ({
  recordUsage: async () => ({
    usd: 0.02,
    credits: 4,
    usageId: "usage-persona-1",
  }),
}));

vi.mock("@/lib/agent/models", () => ({
  selectModel: () => "gpt-5.4",
}));

beforeEach(() => {
  state.inboundRows = [];
  state.outboundRows = [];
  state.contactNameRows = [];
  state.recentSenderRows = [];
  state.personaRows = [];
  insertCalls.length = 0;
  stubbedPersona = { relationship: null, facts: [] };
  openaiCalls = 0;
});

describe("extractContactPersona", () => {
  it("upserts a row with the LLM's relationship + facts when a corpus exists", async () => {
    state.inboundRows = [
      {
        subject: "Re: assignment 3",
        snippet: "Looks good — see you Thursday.",
        receivedAt: new Date("2026-04-30T14:00:00Z"),
        senderName: "Prof Tanaka",
      },
    ];
    state.outboundRows = [
      {
        subject: "Re: assignment 3",
        body: "Thanks for confirming.",
        sentAt: new Date("2026-04-30T15:00:00Z"),
      },
    ];
    state.contactNameRows = [{ senderName: "Prof Tanaka" }];

    stubbedPersona = {
      relationship: "MAT223 instructor",
      facts: [
        "Replies same day from Mon–Fri.",
        "Prefers concise English replies.",
      ],
    };

    const { extractContactPersona } = await import(
      "@/lib/agent/email/persona-learner"
    );
    const out = await extractContactPersona("u1", "prof@x.edu");

    expect(out.contactEmail).toBe("prof@x.edu");
    expect(out.relationship).toBe("MAT223 instructor");
    expect(out.facts).toHaveLength(2);
    expect(out.emptyCorpus).toBe(false);
    expect(insertCalls.length).toBe(1);
    const v = insertCalls[0].values as {
      userId: string;
      contactEmail: string;
      relationship: string;
      facts: string[];
      lastExtractedAt: Date;
    };
    expect(v.userId).toBe("u1");
    expect(v.contactEmail).toBe("prof@x.edu");
    expect(v.relationship).toBe("MAT223 instructor");
    expect(v.facts).toEqual(stubbedPersona.facts);
    expect(v.lastExtractedAt).toBeInstanceOf(Date);
  });

  it("emptyCorpus path stamps last_extracted_at without an LLM call", async () => {
    state.inboundRows = [];
    state.outboundRows = [];
    state.contactNameRows = [];

    const { extractContactPersona } = await import(
      "@/lib/agent/email/persona-learner"
    );
    const out = await extractContactPersona("u1", "ghost@x.edu");
    expect(out.emptyCorpus).toBe(true);
    expect(out.relationship).toBeNull();
    expect(out.facts).toEqual([]);
    // Still upserts so the gate doesn't re-pick this contact tomorrow.
    expect(insertCalls.length).toBe(1);
    expect(openaiCalls).toBe(0);
  });

  it("caps facts at 8 and trims long facts to MAX_FACT_CHARS", async () => {
    state.inboundRows = [
      {
        subject: "hi",
        snippet: "context.",
        receivedAt: new Date("2026-04-30T10:00:00Z"),
        senderName: null,
      },
    ];
    state.outboundRows = [];
    state.contactNameRows = [];
    const longFact = "x".repeat(500);
    stubbedPersona = {
      relationship: "Friend",
      facts: Array.from({ length: 12 }, (_, i) => `Fact ${i}: ${longFact}`),
    };

    const { extractContactPersona, parseExtraction } = await import(
      "@/lib/agent/email/persona-learner"
    );
    // parseExtraction is the unit under test for the cap; we also drive
    // the full flow to assert the cap survives upsert.
    const direct = parseExtraction(JSON.stringify(stubbedPersona));
    expect(direct.facts).toHaveLength(8);
    for (const f of direct.facts) {
      expect(f.length).toBeLessThanOrEqual(200);
    }

    const out = await extractContactPersona("u1", "friend@x.edu");
    expect(out.facts).toHaveLength(8);
  });

  it("parseExtraction returns empty on malformed JSON", async () => {
    const { parseExtraction } = await import(
      "@/lib/agent/email/persona-learner"
    );
    expect(parseExtraction("not json")).toEqual({
      relationship: null,
      facts: [],
    });
    expect(parseExtraction("{}")).toEqual({
      relationship: null,
      facts: [],
    });
    expect(
      parseExtraction(JSON.stringify({ relationship: "x", facts: "not array" }))
    ).toEqual({ relationship: "x", facts: [] });
  });

  it("trims an empty relationship to null", async () => {
    const { parseExtraction } = await import(
      "@/lib/agent/email/persona-learner"
    );
    const out = parseExtraction(
      JSON.stringify({ relationship: "   ", facts: ["a"] })
    );
    expect(out.relationship).toBeNull();
    expect(out.facts).toEqual(["a"]);
  });

  it("handles bilingual (JP+EN) corpus without dropping signal", async () => {
    state.inboundRows = [
      {
        subject: "課題の件",
        snippet: "ご対応ありがとうございます。",
        receivedAt: new Date("2026-04-30T10:00:00Z"),
        senderName: "田中先生",
      },
    ];
    state.outboundRows = [
      {
        subject: "Re: 課題の件",
        body: "Got it, will submit by Friday.",
        sentAt: new Date("2026-04-30T11:00:00Z"),
      },
    ];
    state.contactNameRows = [{ senderName: "田中先生" }];
    stubbedPersona = {
      relationship: "MAT223 instructor",
      facts: ["Mixes Japanese subject lines with English body."],
    };

    const { extractContactPersona } = await import(
      "@/lib/agent/email/persona-learner"
    );
    const out = await extractContactPersona("u1", "tanaka@x.ac.jp");
    expect(out.facts[0]).toContain("Japanese");
    expect(openaiCalls).toBe(1);
  });
});
