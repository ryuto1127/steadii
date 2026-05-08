import { beforeEach, describe, expect, it, vi } from "vitest";

// Engineer-35 — fanout retrieval-quality regression suite.
//
// Background: Ryuto received a recruiting email
//   subject: "※要返信※【アクメトラベル】明日のグループディスカッション選考のご案内"
//   sender:  notifications@example-ats.example.com
// and the draft details panel surfaced "syllabus-1 64%" — the unbound
// vector search caught a topical-overlap chunk for an email that has
// nothing to do with any class.
//
// Two-layered fix in lib/agent/email/fanout.ts:
//   1. Split SIM_FLOOR by class-binding state (0.55 bound, 0.78 unbound).
//   2. Gate syllabus + vector-mistakes via EMAIL_LIKELY_ACADEMIC predicate
//      when classBindingMethod === "none". Non-academic + unbound emails
//      bypass syllabus + vector-mistakes retrieval entirely.
//
// This file pins:
//   - Predicate behavior across 7 representative emails (5 non-academic
//     + 2 academic positive controls).
//   - End-to-end fanoutForInbox behavior for the canonical recruiting
//     regression case + a class-bound academic case.

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

vi.mock("drizzle-orm", () => ({
  and: (...args: unknown[]) => ({ kind: "and", args }),
  eq: (col: unknown, val: unknown) => ({ kind: "eq", col, val }),
  isNull: (col: unknown) => ({ kind: "isNull", col }),
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

const resultsByTable = new Map<unknown, unknown[]>();

// Track every db.execute call so tests can assert the gate
// short-circuited before any vector SQL fired. Each entry is the SQL
// string (substring-keyed) to keep dispatch readable.
const executeCalls: string[] = [];

// Syllabus + mistakes vector loaders both go through db.execute. The
// fanout runs them in parallel via Promise.all, so order is
// non-deterministic — split queues by SQL kind so each loader gets the
// rows the test staged for it regardless of resolution order.
const syllabusExecuteQueue: Array<{ rows: unknown[] }> = [];
const mistakesExecuteQueue: Array<{ rows: unknown[] }> = [];

function chainFor(table: unknown) {
  const c = {
    leftJoin: () => c,
    innerJoin: () => c,
    where: () => c,
    orderBy: () => c,
    limit: async () => resultsByTable.get(table) ?? [],
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
    execute: async (sqlInput: unknown) => {
      const s = String(sqlInput);
      executeCalls.push(s);
      if (s.includes("syllabus_chunks")) {
        return syllabusExecuteQueue.shift() ?? { rows: [] };
      }
      if (s.includes("mistake_note_chunks")) {
        return mistakesExecuteQueue.shift() ?? { rows: [] };
      }
      return { rows: [] };
    },
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
  executeCalls.length = 0;
  syllabusExecuteQueue.length = 0;
  mistakesExecuteQueue.length = 0;
});

// ---------------------------------------------------------------------------
// Predicate unit tests — lock the keyword list behavior across non-academic
// and academic cases. False-positives intentionally pass through (better to
// over-retrieve than miss a real class email), so the bar is "obvious
// non-academic stays non-academic" rather than precision.
// ---------------------------------------------------------------------------

describe("isEmailLikelyAcademic", () => {
  it("rejects the canonical recruiting regression case (Acme Travel)", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "※要返信※【アクメトラベル】明日のグループディスカッション選考のご案内",
        "アクメトラベル株式会社の選考にご応募いただきありがとうございます。明日のグループディスカッションのご案内をお送りします。"
      )
    ).toBe(false);
  });

  it("rejects an English recruiting email", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "Interview invitation — Acme Corp engineering",
        "We're excited to invite you to a phone screen for the Software Engineer role next Tuesday."
      )
    ).toBe(false);
  });

  it("rejects a billing / invoice email", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "Your Stripe invoice for April 2026",
        "Invoice #INV-12345 — total $42.00. Your card ending 4242 will be charged on May 1."
      )
    ).toBe(false);
  });

  it("rejects an OTP / verification email", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "Your verification code is 482931",
        "Use this one-time code to sign in. Do not share it with anyone."
      )
    ).toBe(false);
  });

  it("rejects a vendor-support / DevOps notification", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "[AWS] Service Health Dashboard — us-east-1 elevated error rates",
        "We are investigating elevated error rates affecting EC2 instances in the us-east-1 region."
      )
    ).toBe(false);
  });

  it("rejects a shipping notification", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "Your package has shipped — order #A1928",
        "Tracking number 1Z999AA10123456784. Estimated delivery Wednesday."
      )
    ).toBe(false);
  });

  it("rejects a non-academic email containing the substring 'ta' inside other words", async () => {
    // Word-boundary matching guards: 'data', 'metadata', 'Toyota' etc. must
    // not trigger the 'TA' keyword. Confirms the regex isn't substring-naive.
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "Your data export is ready",
        "We've finished processing your metadata export. Toyota Connected logged a status update."
      )
    ).toBe(false);
  });

  it("accepts an English class-related email (assignment keyword)", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "CSC108 — Assignment 3 due Friday",
        "Reminder: assignment 3 must be submitted by 11:59pm Friday."
      )
    ).toBe(true);
  });

  it("accepts a Japanese class-related email (課題 keyword)", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "情報科学I 課題2について",
        "次回授業までにレポートを提出してください。"
      )
    ).toBe(true);
  });

  it("accepts an English email mentioning office hours", async () => {
    const { isEmailLikelyAcademic } = await import("@/lib/agent/email/fanout");
    expect(
      isEmailLikelyAcademic(
        "Office hours moved to Thursday",
        "I'll be holding office hours in BA1230 on Thursday this week instead of Wednesday."
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// End-to-end fanoutForInbox tests — the core regression invariant.
// ---------------------------------------------------------------------------

describe("fanoutForInbox — non-academic gate", () => {
  it("drops syllabus + vector mistakes for the recruiting regression case", async () => {
    // Inbox row: no class binding (method=none), but a real embedding
    // exists. Without the gate, loadVectorSyllabusChunks would be called
    // and could return a chunk above 0.55 similarity (see the original
    // bug report — syllabus-1 64%).
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: null,
        classBindingMethod: "none",
        classBindingConfidence: 0,
        embedding: Array(1536).fill(0.01),
      },
    ]);

    // Stage rows that *would* have been returned by the syllabus vector
    // loader if it ran. The gate must short-circuit before reaching it
    // — assertion below is on executeCalls.length === 0 for the syllabus
    // + mistakes branches.
    syllabusExecuteQueue.push({
      rows: [
        {
          chunk_id: "ghost-chunk",
          syllabus_id: "ghost-syllabus",
          class_id: null,
          syllabus_title: "Should Not Surface",
          chunk_text: "topical drift that 0.55 sim let through",
          distance: 0.7, // similarity ≈ 0.65, above old SIM_FLOOR
        },
      ],
    });

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-recruiting",
      phase: "deep",
      subject:
        "※要返信※【アクメトラベル】明日のグループディスカッション選考のご案内",
      snippet:
        "アクメトラベル株式会社の選考にご応募いただきありがとうございます。",
      senderEmail: null,
    });

    expect(out.syllabusChunks).toEqual([]);
    expect(out.senderHistory).toEqual([]);
    // The gate fires before any vector SQL — db.execute is never called
    // by syllabus / mistakes loaders. (searchSimilarEmails is mocked at
    // module level, so it doesn't touch this counter either.)
    expect(executeCalls.length).toBe(0);
  });

  it("drops syllabus + vector mistakes for an English billing email", async () => {
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: null,
        classBindingMethod: "none",
        classBindingConfidence: 0,
        embedding: Array(1536).fill(0.02),
      },
    ]);

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-billing",
      phase: "deep",
      subject: "Your Stripe invoice for April 2026",
      snippet:
        "Invoice #INV-12345 total $42.00. Card ending 4242 will be charged.",
      senderEmail: null,
    });

    expect(out.syllabusChunks).toEqual([]);
    expect(out.senderHistory).toEqual([]);
    expect(executeCalls.length).toBe(0);
  });

  it("runs vector retrieval for an unbound but academic-keyword email", async () => {
    // Email is not class-bound (method=none) but mentions "midterm" — the
    // EMAIL_LIKELY_ACADEMIC predicate fires, so the gate does NOT drop
    // retrieval. Verifies the gate doesn't over-block real class emails
    // that the L1 binder happened to miss.
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: null,
        classBindingMethod: "none",
        classBindingConfidence: 0,
        embedding: Array(1536).fill(0.03),
      },
    ]);

    // Stage one syllabus row above the 0.78 unbound floor so it passes.
    syllabusExecuteQueue.push({
      rows: [
        {
          chunk_id: "c1",
          syllabus_id: "s1",
          class_id: "cls-strong",
          syllabus_title: "MAT223 Syllabus",
          chunk_text: "Midterm covers chapters 1-5.",
          distance: 0.4, // similarity = 0.8, above 0.78 unbound floor
        },
      ],
    });
    // mistakes vector loader returns no rows.
    mistakesExecuteQueue.push({ rows: [] });

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-academic-unbound",
      phase: "deep",
      subject: "Midterm review session this Friday",
      snippet: "We'll be holding a midterm review in BA1230 from 5-7pm.",
      senderEmail: null,
    });

    // Either order — both syllabus and mistakes vector loaders ran.
    expect(executeCalls.length).toBeGreaterThan(0);
    expect(out.syllabusChunks.length).toBe(1);
    expect(out.syllabusChunks[0]?.similarity).toBeGreaterThanOrEqual(0.78);
  });

  it("drops a syllabus chunk below the 0.78 unbound floor", async () => {
    // Same shape as above but the candidate chunk has distance 0.7 →
    // similarity 0.65, which passed the old 0.55 threshold. With
    // engineer-35's split floor it should be dropped because the email
    // is unbound and the bar is now 0.78.
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: null,
        classBindingMethod: "none",
        classBindingConfidence: 0,
        embedding: Array(1536).fill(0.04),
      },
    ]);
    syllabusExecuteQueue.push({
      rows: [
        {
          chunk_id: "c-borderline",
          syllabus_id: "s-borderline",
          class_id: null,
          syllabus_title: "Some Syllabus",
          chunk_text: "Loose topical match",
          distance: 0.7, // similarity 0.65, between bound and unbound floors
        },
      ],
    });
    mistakesExecuteQueue.push({ rows: [] });

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-borderline",
      phase: "deep",
      subject: "Course updates this week",
      snippet: "A few course-related updates for you.",
      senderEmail: null,
    });

    // EMAIL_LIKELY_ACADEMIC fires (course keyword) so the gate doesn't
    // short-circuit, but the chunk fails the 0.78 unbound floor.
    expect(out.syllabusChunks).toEqual([]);
  });

  it("keeps the bound 0.55 floor when the email is class-bound", async () => {
    // Inbox row has a class binding. Even at the same 0.65 similarity
    // (distance 0.7), the chunk surfaces because we trust the binder
    // and use the lenient 0.55 floor.
    resultsByTable.set(inboxItemsSchema, [
      {
        classId: "cls-1",
        classBindingMethod: "subject_code",
        classBindingConfidence: 0.95,
        embedding: Array(1536).fill(0.05),
      },
    ]);
    resultsByTable.set(classesSchema, [{ name: "Linear Algebra", code: "MAT223" }]);
    // mistakes-by-class returns empty (recency loader, not vector).
    resultsByTable.set(mistakeNotesSchema, []);
    // syllabus-by-class loader runs through db.execute — same SQL
    // dispatch routes through syllabusExecuteQueue.
    syllabusExecuteQueue.push({
      rows: [
        {
          chunk_id: "c-bound",
          syllabus_id: "s-bound",
          class_id: "cls-1",
          syllabus_title: "MAT223 Syllabus",
          chunk_text: "Late submissions lose 10% per day.",
          distance: 0.7, // similarity 0.65 — passes 0.55 bound floor
        },
      ],
    });

    const { fanoutForInbox } = await import("@/lib/agent/email/fanout");
    const out = await fanoutForInbox({
      userId: "u1",
      inboxItemId: "ix-bound",
      phase: "deep",
      subject: "MAT223 — assignment 3",
      snippet: "Due Friday.",
      senderEmail: null,
    });

    expect(out.classBinding.method).toBe("subject_code");
    expect(out.syllabusChunks.length).toBe(1);
    expect(out.syllabusChunks[0]?.similarity).toBeCloseTo(0.65, 1);
  });
});
