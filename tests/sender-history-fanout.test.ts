import { beforeEach, describe, expect, it, vi } from "vitest";

// engineer-38 — sender-history fanout source replaces the dead mistakes
// slot from PR #182. The loader joins agent_drafts → inbox_items so it
// can match on inbox_items.senderEmail (agent_drafts has no denormalized
// sender column). These tests verify the SQL filter shape AND the row
// transform: status='sent', sentAt IS NOT NULL, ordered newest-first,
// capped at FANOUT_K_SENDER_HISTORY=3.

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const inboxItemsSchema = {
  id: tag("inboxItems.id"),
  classId: tag("inboxItems.classId"),
  classBindingMethod: tag("inboxItems.classBindingMethod"),
  classBindingConfidence: tag("inboxItems.classBindingConfidence"),
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
};

const classesSchema = {
  id: tag("classes.id"),
  name: tag("classes.name"),
  code: tag("classes.code"),
  deletedAt: tag("classes.deletedAt"),
};

const emailEmbeddingsSchema = {
  inboxItemId: tag("emailEmbeddings.inboxItemId"),
  embedding: tag("emailEmbeddings.embedding"),
};

const assignmentsSchema = {
  id: tag("assignments.id"),
  userId: tag("assignments.userId"),
  classId: tag("assignments.classId"),
  title: tag("assignments.title"),
  dueAt: tag("assignments.dueAt"),
  status: tag("assignments.status"),
  priority: tag("assignments.priority"),
  deletedAt: tag("assignments.deletedAt"),
};

const mistakeNotesSchema = {
  id: tag("mistakeNotes.id"),
  deletedAt: tag("mistakeNotes.deletedAt"),
};

vi.mock("@/lib/db/schema", () => ({
  inboxItems: inboxItemsSchema,
  agentDrafts: agentDraftsSchema,
  classes: classesSchema,
  emailEmbeddings: emailEmbeddingsSchema,
  assignments: assignmentsSchema,
  mistakeNotes: mistakeNotesSchema,
}));

const eqCalls: Array<{ col: unknown; val: unknown }> = [];
const isNotNullCalls: unknown[] = [];

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => {
    eqCalls.push({ col, val });
    return { kind: "eq", col, val };
  },
  isNull: (col: unknown) => ({ kind: "isNull", col }),
  isNotNull: (col: unknown) => {
    isNotNullCalls.push(col);
    return { kind: "isNotNull", col };
  },
  desc: (col: unknown) => ({ kind: "desc", col }),
  gte: (col: unknown, val: unknown) => ({ kind: "gte", col, val }),
  lt: (col: unknown, val: unknown) => ({ kind: "lt", col, val }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      Array.from(strings).join(""),
    { raw: () => ({}) }
  ),
}));

const resultsByTable = new Map<unknown, unknown[]>();
const limitCalls: Array<{ table: unknown; n: unknown }> = [];

function chainFor(table: unknown) {
  const c = {
    leftJoin: () => c,
    innerJoin: () => c,
    where: () => c,
    orderBy: () => c,
    limit: async (n: unknown) => {
      limitCalls.push({ table, n });
      return resultsByTable.get(table) ?? [];
    },
    then: (resolve: (rows: unknown[]) => void) =>
      resolve(resultsByTable.get(table) ?? []),
  };
  return c;
}

vi.mock("@/lib/db/client", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => chainFor(table),
    }),
    execute: async () => ({ rows: [] }),
  },
}));

vi.mock("@/lib/integrations/google/calendar", () => ({
  fetchUpcomingEvents: async () => [],
}));
vi.mock("@/lib/integrations/google/tasks", () => ({
  fetchUpcomingTasks: async () => [],
}));
vi.mock("@/lib/integrations/microsoft/calendar", () => ({
  fetchMsUpcomingEvents: async () => [],
}));
vi.mock("@/lib/integrations/microsoft/tasks", () => ({
  fetchMsUpcomingTasks: async () => [],
}));
vi.mock("@/lib/integrations/ical/queries", () => ({
  fetchUpcomingIcalEvents: async () => [],
}));
vi.mock("@/lib/agent/email/audit", () => ({
  logEmailAudit: async () => {},
}));
vi.mock("@/lib/agent/email/retrieval", () => ({
  searchSimilarEmails: async () => ({ results: [], totalCandidates: 0 }),
}));
vi.mock("@sentry/nextjs", () => ({
  startSpan: <T,>(_opts: unknown, fn: () => Promise<T>) => fn(),
  captureException: vi.fn(),
}));

beforeEach(() => {
  resultsByTable.clear();
  eqCalls.length = 0;
  isNotNullCalls.length = 0;
  limitCalls.length = 0;
});

describe("loadSenderHistory", () => {
  it("returns the past replies the user sent to this sender, newest-first", async () => {
    resultsByTable.set(agentDraftsSchema, [
      {
        draftId: "d-newest",
        draftSubject: "Re: midterm prep",
        draftBody: "Thanks — I'll review chapter 7 tonight.",
        sentAt: new Date("2026-04-22T10:00:00Z"),
        originalSubject: "midterm prep",
        originalSnippet: "Reminder...",
      },
      {
        draftId: "d-older",
        draftSubject: "Re: office hours",
        draftBody: "Coming at 3pm.",
        sentAt: new Date("2026-04-15T10:00:00Z"),
        originalSubject: "office hours",
        originalSnippet: "Times...",
      },
    ]);

    const { loadSenderHistory } = await import("@/lib/agent/email/fanout");
    const out = await loadSenderHistory("u1", "prof@x.edu", 3);

    expect(out).toHaveLength(2);
    expect(out[0]?.draftId).toBe("d-newest");
    expect(out[1]?.draftId).toBe("d-older");

    // The query MUST scope by userId, status='sent', sentAt IS NOT NULL,
    // and inbox_items.senderEmail. Verifying the eq calls catches a future
    // refactor that drops one of these guards.
    const eqValues = eqCalls.map((c) => c.val);
    expect(eqValues).toContain("u1");
    expect(eqValues).toContain("sent");
    expect(eqValues).toContain("prof@x.edu");
    expect(isNotNullCalls).toContain(agentDraftsSchema.sentAt);
  });

  it("filters out rows with no Date sentAt (defensive against drift)", async () => {
    // The DB filter already excludes nulls, but JSONB drift / partial
    // backfills could land us with a string in sentAt. The transform
    // drops anything that isn't an instanceof Date.
    resultsByTable.set(agentDraftsSchema, [
      {
        draftId: "d-good",
        draftSubject: "Re: a",
        draftBody: "ok",
        sentAt: new Date("2026-04-22T10:00:00Z"),
        originalSubject: null,
        originalSnippet: null,
      },
      {
        draftId: "d-bad",
        draftSubject: "Re: b",
        draftBody: "ok",
        sentAt: "2026-04-23T10:00:00Z" as unknown as Date,
        originalSubject: null,
        originalSnippet: null,
      },
    ]);

    const { loadSenderHistory } = await import("@/lib/agent/email/fanout");
    const out = await loadSenderHistory("u1", "prof@x.edu", 3);
    expect(out.map((r) => r.draftId)).toEqual(["d-good"]);
  });

  it("passes the cap k through to .limit()", async () => {
    resultsByTable.set(agentDraftsSchema, []);
    const { loadSenderHistory, FANOUT_K_SENDER_HISTORY } = await import(
      "@/lib/agent/email/fanout"
    );
    await loadSenderHistory("u1", "prof@x.edu", FANOUT_K_SENDER_HISTORY);
    const senderLimit = limitCalls.find((c) => c.table === agentDraftsSchema);
    expect(senderLimit?.n).toBe(FANOUT_K_SENDER_HISTORY);
  });

  it("fanout populates senderHistory when senderEmail is supplied", async () => {
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: null,
        classBindingMethod: "none",
        classBindingConfidence: 0,
        embedding: null,
      },
    ]);
    resultsByTable.set(agentDraftsSchema, [
      {
        draftId: "d1",
        draftSubject: "Re: x",
        draftBody: "thanks",
        sentAt: new Date("2026-04-22T10:00:00Z"),
        originalSubject: null,
        originalSnippet: null,
      },
    ]);

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-1",
      phase: "deep",
      subject: "x",
      snippet: "y",
      senderEmail: "prof@x.edu",
    });
    expect(out.senderHistory).toHaveLength(1);
    expect(out.senderHistory[0]?.draftId).toBe("d1");
  });

  it("fanout returns empty senderHistory when senderEmail is null", async () => {
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: null,
        classBindingMethod: "none",
        classBindingConfidence: 0,
        embedding: null,
      },
    ]);
    // Even if the mock would return rows, senderEmail=null bypasses the
    // loader entirely so the loader never runs.
    resultsByTable.set(agentDraftsSchema, [
      {
        draftId: "d1",
        draftSubject: "Re: x",
        draftBody: "thanks",
        sentAt: new Date("2026-04-22T10:00:00Z"),
        originalSubject: null,
        originalSnippet: null,
      },
    ]);

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-1",
      phase: "classify",
      subject: "x",
      snippet: "y",
      senderEmail: null,
    });
    expect(out.senderHistory).toEqual([]);
  });
});
