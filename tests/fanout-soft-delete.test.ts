import { beforeEach, describe, expect, it, vi } from "vitest";

// Polish-13c — fanout must filter soft-deleted classes out of agent
// provenance. Without this filter, deleting a class via the kebab in the
// classes UI leaves the deleted name ghosting into the agent's reasoning
// panel for any inbox item whose classId still references the row.
//
// Two sites in lib/agent/email/fanout.ts touch the classes table:
//   1. The class-metadata lookup (~line 183) when an inbox row already
//      has a class binding.
//   2. The leftJoin in safelyFetchSteadiiAssignments (~line 669) so
//      assignments still surface but their className is null when the
//      class is gone.
// Both must reference classes.deletedAt.

vi.mock("server-only", () => ({}));

const tag = (name: string) => ({ __tag: name });

const classesSchema = {
  id: tag("classes.id"),
  name: tag("classes.name"),
  code: tag("classes.code"),
  deletedAt: tag("classes.deletedAt"),
};

const inboxItemsSchema = {
  id: tag("inboxItems.id"),
  classId: tag("inboxItems.classId"),
  classBindingMethod: tag("inboxItems.classBindingMethod"),
  classBindingConfidence: tag("inboxItems.classBindingConfidence"),
  // engineer-38 — sender-history fanout joins inbox_items.senderEmail to
  // agent_drafts via inboxItemId, so the schema mock needs the column too.
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

const emailEmbeddingsSchema = {
  inboxItemId: tag("emailEmbeddings.inboxItemId"),
  embedding: tag("emailEmbeddings.embedding"),
};

const mistakeNotesSchema = {
  id: tag("mistakeNotes.id"),
  userId: tag("mistakeNotes.userId"),
  classId: tag("mistakeNotes.classId"),
  title: tag("mistakeNotes.title"),
  unit: tag("mistakeNotes.unit"),
  difficulty: tag("mistakeNotes.difficulty"),
  bodyMarkdown: tag("mistakeNotes.bodyMarkdown"),
  createdAt: tag("mistakeNotes.createdAt"),
  deletedAt: tag("mistakeNotes.deletedAt"),
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

vi.mock("@/lib/db/schema", () => ({
  classes: classesSchema,
  inboxItems: inboxItemsSchema,
  emailEmbeddings: emailEmbeddingsSchema,
  mistakeNotes: mistakeNotesSchema,
  assignments: assignmentsSchema,
  agentDrafts: agentDraftsSchema,
}));

// Track every column passed to isNull so we can assert that
// classes.deletedAt was filtered (in addition to the existing
// mistakeNotes / assignments filters).
const isNullCalls: unknown[] = [];

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  isNull: (col: unknown) => {
    isNullCalls.push(col);
    return { kind: "isNull", col };
  },
  // engineer-38 — sender-history loader uses isNotNull(sentAt).
  isNotNull: (col: unknown) => ({ kind: "isNotNull", col }),
  desc: (col: unknown) => ({ kind: "desc", col }),
  gte: (col: unknown, val: unknown) => ({ kind: "gte", col, val }),
  lt: (col: unknown, val: unknown) => ({ kind: "lt", col, val }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ..._values: unknown[]) =>
      Array.from(strings).join(""),
    { raw: () => ({}) }
  ),
}));

// Per-table results. The chain dispatches on the from() argument so
// parallel fanout sources see their own (empty) rows.
const resultsByTable = new Map<unknown, unknown[]>();

function chainFor(table: unknown) {
  const c = {
    leftJoin: () => c,
    // engineer-38 — sender-history loader uses innerJoin (agent_drafts ⋈
    // inbox_items). Chain returns same shape.
    innerJoin: () => c,
    where: () => c,
    orderBy: () => c,
    limit: async () => resultsByTable.get(table) ?? [],
    // Some queries (e.g. drizzle's plain WHERE without a limit) await
    // the chain directly; expose a thenable as a fallback.
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
  isNullCalls.length = 0;
  resultsByTable.clear();
});

describe("runFanout — soft-delete filter on classes", () => {
  it("calls isNull(classes.deletedAt) when resolving class metadata", async () => {
    // Inbox row has a class binding; class metadata lookup runs.
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: "cls-1",
        classBindingMethod: "subject_code",
        classBindingConfidence: 0.95,
        embedding: null,
      },
    ]);
    // Empty classes result simulates the soft-delete filter excluding
    // the row.
    resultsByTable.set(classesSchema, []);

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-1",
      phase: "classify",
      subject: "CSC108 — assignment",
      snippet: "ping",
      senderEmail: null,
    });

    expect(isNullCalls).toContain(classesSchema.deletedAt);
    expect(out.classBinding.className).toBeNull();
    expect(out.classBinding.classCode).toBeNull();
    // The binding metadata still flows through — only name/code are
    // gated on the actual class row existing.
    expect(out.classBinding.classId).toBe("cls-1");
    expect(out.classBinding.method).toBe("subject_code");
  });

  it("calls isNull(classes.deletedAt) on the assignments leftJoin", async () => {
    // Inbox row has no class binding so the class-metadata lookup is
    // skipped; this isolates the assignments-fetch call site.
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: null,
        classBindingMethod: "none",
        classBindingConfidence: 0,
        embedding: null,
      },
    ]);
    resultsByTable.set(assignmentsSchema, []);

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-2",
      phase: "draft",
      subject: null,
      snippet: null,
      senderEmail: null,
    });

    // classes.deletedAt must show up because safelyFetchSteadiiAssignments
    // joins assignments to classes with a deletedAt IS NULL guard.
    expect(isNullCalls).toContain(classesSchema.deletedAt);
    // And the existing assignments filter must still be intact.
    expect(isNullCalls).toContain(assignmentsSchema.deletedAt);
  });

  it("returns null class metadata when the classes lookup yields no row (soft-deleted class case)", async () => {
    // The classId is set on the inbox row but the class itself was
    // soft-deleted between binding and fanout — agent provenance must
    // not surface the ghost name.
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: "cls-deleted",
        classBindingMethod: "subject_code",
        classBindingConfidence: 0.9,
        embedding: null,
      },
    ]);
    resultsByTable.set(classesSchema, []);

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-3",
      phase: "classify",
      subject: null,
      snippet: null,
      senderEmail: null,
    });

    expect(out.classBinding.className).toBeNull();
    expect(out.classBinding.classCode).toBeNull();
  });
});
