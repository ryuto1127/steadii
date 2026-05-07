import "server-only";
import * as Sentry from "@sentry/nextjs";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  assignments,
  classes,
  emailEmbeddings,
  inboxItems,
  mistakeNotes,
  type ClassBindingMethod,
} from "@/lib/db/schema";
import {
  fetchUpcomingEvents,
  type DraftCalendarEvent,
} from "@/lib/integrations/google/calendar";
import {
  fetchUpcomingTasks,
  type DraftCalendarTask,
} from "@/lib/integrations/google/tasks";
import { fetchMsUpcomingEvents } from "@/lib/integrations/microsoft/calendar";
import { fetchMsUpcomingTasks } from "@/lib/integrations/microsoft/tasks";
import { fetchUpcomingIcalEvents } from "@/lib/integrations/ical/queries";
import { logEmailAudit } from "./audit";
import {
  searchSimilarEmails,
  type SimilarEmail,
} from "./retrieval";

// Per-source caps locked in §12.2 (per-source caps, not a single total
// budget). k_mistakes=3, k_syllabus=3, k_emails=5 (classify) / 20 (deep).
export const FANOUT_K_MISTAKES = 3;
export const FANOUT_K_SYLLABUS = 3;
export const FANOUT_K_EMAILS_CLASSIFY = 5;
export const FANOUT_K_EMAILS_DEEP = 20;

// Calendar windows. §12.10 locked decision: live both classify and draft.
export const FANOUT_CALENDAR_DAYS_CLASSIFY = 3;
export const FANOUT_CALENDAR_DAYS_DRAFT = 7;
export const FANOUT_CALENDAR_MAX_CLASSIFY = 8;
export const FANOUT_CALENDAR_MAX_DRAFT = 25;

// Per-source similarity floors. Engineer-35 (2026-05-06) split the single
// 0.55 floor into class-bound vs class-unbound after a recruiting email
// surfaced syllabus-1 64% in the draft details panel — at 0.55 the unbound
// vector search was catching topical-overlap chunks for emails that have
// nothing to do with any class. Keep the bound floor lenient (the email
// is already known-academic via the binding); raise the unbound floor so
// only strong semantic matches survive when there's no class anchor.
const SYLLABUS_SIM_FLOOR_BOUND = 0.55;
const SYLLABUS_SIM_FLOOR_UNBOUND = 0.78;

// Engineer-35 — when an email is structurally non-academic (recruiting,
// billing, OTP, vendor support) AND lacks a class binding, vector search
// at any threshold is too lossy. We bypass syllabus + vector-mistakes
// retrieval entirely for these emails. The predicate is keyword-based on
// (subject + snippet); false-positives intentionally pass through (better
// to over-retrieve than miss a real class email). Tuned via the
// fanout-quality-audit regression suite.
const EMAIL_LIKELY_ACADEMIC_KEYWORDS_EN = [
  "syllabus",
  "syllabi",
  "assignment",
  "assignments",
  "homework",
  "midterm",
  "midterms",
  "final exam",
  "finals",
  "lecture",
  "lectures",
  "professor",
  "professors",
  "TA",
  "TAs",
  "office hour",
  "office hours",
  "class",
  "classes",
  "course",
  "courses",
  "quiz",
  "quizzes",
  "textbook",
  "textbooks",
  "problem set",
  "problem sets",
];

const EMAIL_LIKELY_ACADEMIC_KEYWORDS_JA = [
  "シラバス",
  "課題",
  "宿題",
  "中間",
  "期末",
  "試験",
  "講義",
  "教授",
  "先生",
  "オフィスアワー",
  "授業",
  "履修",
  "レポート",
  "提出",
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// English keywords use \b boundaries so "TA" doesn't match "Toyota" /
// "data", "class" doesn't match "classify", etc. Japanese has no word
// boundaries so we substring-match — the JA keywords here are kanji
// compounds with low collision risk in non-academic Japanese text.
const ACADEMIC_EN_REGEX = new RegExp(
  `\\b(?:${EMAIL_LIKELY_ACADEMIC_KEYWORDS_EN.map(escapeRegExp).join("|")})\\b`,
  "i"
);

export function isEmailLikelyAcademic(
  subject: string | null,
  snippet: string | null
): boolean {
  const text = `${subject ?? ""}\n${snippet ?? ""}`;
  if (!text.trim()) return false;
  if (ACADEMIC_EN_REGEX.test(text)) return true;
  for (const kw of EMAIL_LIKELY_ACADEMIC_KEYWORDS_JA) {
    if (text.includes(kw)) return true;
  }
  return false;
}

// Per-source timeout. §4.6: calendar tolerates 100-500ms; structured/vector
// branches finish under 50ms but are wrapped for safety.
const SOURCE_TIMEOUT_MS = 500;

export type FanoutPhase = "classify" | "deep" | "draft";

export type FanoutMistake = {
  mistakeId: string;
  classId: string | null;
  title: string;
  unit: string | null;
  difficulty: string | null;
  bodySnippet: string;
  createdAt: Date;
};

export type FanoutSyllabusChunk = {
  chunkId: string;
  syllabusId: string;
  classId: string | null;
  syllabusTitle: string;
  chunkText: string;
  similarity: number;
};

export type FanoutSteadiiAssignment = {
  id: string;
  classId: string | null;
  className: string | null;
  title: string;
  due: string; // YYYY-MM-DD
  status: "not_started" | "in_progress" | "done";
  priority: "low" | "medium" | "high" | null;
};

export type FanoutCalendar = {
  events: DraftCalendarEvent[];
  tasks: DraftCalendarTask[];
  // Phase 7 W1 — Steadii's own assignments due in the fanout window.
  // Surfaced alongside Google events + Google Tasks in a single calendar
  // block so the L2 prompts see the user's full upcoming commitments.
  assignments: FanoutSteadiiAssignment[];
};

export type ClassBindingPayload = {
  classId: string | null;
  className: string | null;
  classCode: string | null;
  method: ClassBindingMethod;
  confidence: number;
};

export type FanoutResult = {
  classBinding: ClassBindingPayload;
  mistakes: FanoutMistake[];
  syllabusChunks: FanoutSyllabusChunk[];
  similarEmails: SimilarEmail[];
  totalSimilarCandidates: number;
  calendar: FanoutCalendar;
  // Per-source timing in ms — surfaced in audit logs + admin metrics.
  timings: {
    mistakes: number;
    syllabus: number;
    emails: number;
    calendar: number;
    total: number;
  };
  // Per-source timeouts that fired. Empty when everything completed inside
  // the budget. Surfaces in the email_fanout_timeout audit log.
  timeouts: string[];
};

export type FanoutInput = {
  userId: string;
  inboxItemId: string;
  phase: FanoutPhase;
  // Subject is used as the textual fallback when the cached email_embedding
  // hasn't been written yet (race in the synchronous ingest pipeline that
  // shouldn't fire today, but the fanout guards anyway).
  subject: string | null;
  snippet: string | null;
};

// Top-level fanout orchestrator. Runs all four sources in parallel with
// per-source timeouts, returns a structured result the prompt builders
// consume directly. Failures degrade to empty per-source results — the L2
// pipeline never blocks on a slow query.
export async function fanoutForInbox(
  input: FanoutInput
): Promise<FanoutResult> {
  return Sentry.startSpan(
    {
      name: "email.fanout",
      op: "db.query",
      attributes: {
        "steadii.user_id": input.userId,
        "steadii.inbox_item_id": input.inboxItemId,
        "steadii.phase": input.phase,
      },
    },
    async () => runFanout(input)
  );
}

async function runFanout(input: FanoutInput): Promise<FanoutResult> {
  const startedAt = Date.now();

  // Load the inbox row (class binding + cached embedding) in one go. The
  // cached embedding lets us issue ZERO fresh embed API calls per L2 invocation.
  const [row] = await db
    .select({
      classId: inboxItems.classId,
      classBindingMethod: inboxItems.classBindingMethod,
      classBindingConfidence: inboxItems.classBindingConfidence,
      embedding: emailEmbeddings.embedding,
    })
    .from(inboxItems)
    .leftJoin(
      emailEmbeddings,
      eq(emailEmbeddings.inboxItemId, inboxItems.id)
    )
    .where(eq(inboxItems.id, input.inboxItemId))
    .limit(1);

  const classId = row?.classId ?? null;
  const queryEmbedding = row?.embedding ?? null;
  const method: ClassBindingMethod =
    row?.classBindingMethod ?? "none";
  const confidence = row?.classBindingConfidence ?? 0;

  // Resolve class metadata for the provenance payload (one row, cheap).
  // Soft-deleted classes must not surface in agent provenance — when the
  // user deletes a class, fanout should treat it as if no class binding
  // exists rather than ghost the deleted name into the reasoning panel.
  let className: string | null = null;
  let classCode: string | null = null;
  if (classId) {
    const [c] = await db
      .select({ name: classes.name, code: classes.code })
      .from(classes)
      .where(and(eq(classes.id, classId), isNull(classes.deletedAt)))
      .limit(1);
    className = c?.name ?? null;
    classCode = c?.code ?? null;
  }

  // Engineer-35 — derived gates for non-academic / class-unbound emails.
  // `isClassBound` keys off the binder's verdict (any method other than
  // "none" means the L1 binding heuristic decided this email belongs to a
  // class). `shouldGateNonAcademic` short-circuits syllabus + vector
  // mistakes when the email is both unbound AND lacks academic keywords.
  const isClassBound = method !== "none";
  const isAcademic = isEmailLikelyAcademic(input.subject, input.snippet);
  const shouldGateNonAcademic = !isClassBound && !isAcademic;

  const k_emails =
    input.phase === "deep"
      ? FANOUT_K_EMAILS_DEEP
      : FANOUT_K_EMAILS_CLASSIFY;
  const calendarDays =
    input.phase === "classify"
      ? FANOUT_CALENDAR_DAYS_CLASSIFY
      : FANOUT_CALENDAR_DAYS_DRAFT;
  const calendarMax =
    input.phase === "classify"
      ? FANOUT_CALENDAR_MAX_CLASSIFY
      : FANOUT_CALENDAR_MAX_DRAFT;

  const timeouts: string[] = [];

  // Run all four sources in parallel. Per-source timing tracked individually
  // so admin metrics can surface the long-pole (calendar, usually).
  const [mistakes, syllabusChunks, emails, calendar] = await Promise.all([
    timed("mistakes", async () => {
      if (classId) {
        return loadMistakesByClass(input.userId, classId, FANOUT_K_MISTAKES);
      }
      if (!queryEmbedding) return [];
      // Engineer-35 — drop vector-mistakes retrieval for unbound +
      // non-academic emails (recruiting / billing / OTP / vendor
      // support). Keeps unrelated past mistakes out of the reasoning.
      if (shouldGateNonAcademic) return [];
      return loadVectorMistakes(
        input.userId,
        queryEmbedding,
        FANOUT_K_MISTAKES
      );
    }, timeouts),
    timed("syllabus", async () => {
      if (!queryEmbedding) {
        // No embedding → can't rank; skip.
        return [];
      }
      // Engineer-35 — same gate. Vector similarity at any threshold is
      // too lossy when the email is structurally non-academic.
      if (shouldGateNonAcademic) return [];
      const floor = isClassBound
        ? SYLLABUS_SIM_FLOOR_BOUND
        : SYLLABUS_SIM_FLOOR_UNBOUND;
      const rows = classId
        ? await loadSyllabusChunksByClass(
            input.userId,
            classId,
            queryEmbedding,
            FANOUT_K_SYLLABUS
          )
        : await loadVectorSyllabusChunks(
            input.userId,
            queryEmbedding,
            FANOUT_K_SYLLABUS
          );
      return rows.filter((r) => r.similarity >= floor);
    }, timeouts),
    timed("emails", async () => {
      const queryText =
        (input.subject ?? "").trim() + "\n" + (input.snippet ?? "").trim();
      if (!queryText.trim()) {
        return { results: [] as SimilarEmail[], totalCandidates: 0 };
      }
      // searchSimilarEmails issues its own embed call. We could optimize
      // by passing queryEmbedding directly when present; that's a follow-up
      // (the existing helper has a stable shape and other callers).
      return searchSimilarEmails({
        userId: input.userId,
        queryText,
        topK: k_emails,
        excludeInboxItemId: input.inboxItemId,
      });
    }, timeouts),
    timed(
      "calendar",
      async () => {
        // Five flavors per Phase 7 W-Integrations: Google events + Google
        // Tasks + MS Outlook events + MS To Do tasks + iCal-subscribed
        // events, all merged into Steadii's own assignments. Single
        // retrieval pipeline; the prompt renders the union as one calendar
        // block. Per-source soft-fail keeps a missing connection from
        // taking the whole block down.
        const [
          gEvents,
          gTasks,
          msEvents,
          msTasks,
          icalEvents,
          steadiiAssignments,
        ] = await Promise.all([
          safelyFetchEvents(input.userId, calendarDays, calendarMax),
          safelyFetchTasks(input.userId, calendarDays, calendarMax),
          safelyFetchMsEvents(input.userId, calendarDays, calendarMax),
          safelyFetchMsTasks(input.userId, calendarDays, calendarMax),
          safelyFetchIcalEvents(input.userId, calendarDays, calendarMax),
          safelyFetchSteadiiAssignments(
            input.userId,
            calendarDays,
            calendarMax
          ),
        ]);
        // Cap the merged event list at calendarMax so a user with both
        // Google and MS connected can't blow past the prompt budget.
        const events = [...gEvents, ...msEvents, ...icalEvents]
          .sort((a, b) => a.start.localeCompare(b.start))
          .slice(0, calendarMax);
        const tasks = [...gTasks, ...msTasks]
          .sort((a, b) => a.due.localeCompare(b.due))
          .slice(0, calendarMax);
        return { events, tasks, assignments: steadiiAssignments };
      },
      timeouts
    ),
  ]);

  const total = Date.now() - startedAt;

  // Audit row — joinable to email_l2_completed by resourceId. The detail
  // payload powers per-source latency / citation rate dashboards (PR 5).
  const detail = {
    phase: input.phase,
    classBinding: { classId, method, confidence },
    // Engineer-35 — surface the gate decision so admin metrics can chart
    // how many ingest cycles short-circuit syllabus/mistakes retrieval.
    academic_gate: {
      isClassBound,
      isAcademic,
      shouldGateNonAcademic,
    },
    counts: {
      mistakes: mistakes.value.length,
      syllabus: syllabusChunks.value.length,
      emails: emails.value.results.length,
      calendar:
        calendar.value.events.length +
        calendar.value.tasks.length +
        calendar.value.assignments.length,
    },
    timings_ms: {
      mistakes: mistakes.elapsed,
      syllabus: syllabusChunks.elapsed,
      emails: emails.elapsed,
      calendar: calendar.elapsed,
      total,
    },
    timeouts,
  };
  await logEmailAudit({
    userId: input.userId,
    action: "email_fanout_completed",
    result: "success",
    resourceId: input.inboxItemId,
    detail,
  });
  if (timeouts.length > 0) {
    await logEmailAudit({
      userId: input.userId,
      action: "email_fanout_timeout",
      result: "failure",
      resourceId: input.inboxItemId,
      detail: { phase: input.phase, sources: timeouts },
    });
  }

  return {
    classBinding: {
      classId,
      className,
      classCode,
      method,
      confidence,
    },
    mistakes: mistakes.value,
    syllabusChunks: syllabusChunks.value,
    similarEmails: emails.value.results,
    totalSimilarCandidates: emails.value.totalCandidates,
    calendar: calendar.value,
    timings: {
      mistakes: mistakes.elapsed,
      syllabus: syllabusChunks.elapsed,
      emails: emails.elapsed,
      calendar: calendar.elapsed,
      total,
    },
    timeouts,
  };
}

// ---------------------------------------------------------------------------
// Source loaders
// ---------------------------------------------------------------------------

async function loadMistakesByClass(
  userId: string,
  classId: string,
  k: number
): Promise<FanoutMistake[]> {
  // §12.4 — pure recency for mistakes. Topical rank deferred until α
  // observation shows topical-relevance gap (mistakes pulled but not
  // cited). Logged via email_fanout_completed.detail.counts so the
  // observation lever is in place from day 1.
  const rows = await db
    .select({
      id: mistakeNotes.id,
      classId: mistakeNotes.classId,
      title: mistakeNotes.title,
      unit: mistakeNotes.unit,
      difficulty: mistakeNotes.difficulty,
      bodyMarkdown: mistakeNotes.bodyMarkdown,
      createdAt: mistakeNotes.createdAt,
    })
    .from(mistakeNotes)
    .where(
      and(
        eq(mistakeNotes.userId, userId),
        eq(mistakeNotes.classId, classId),
        isNull(mistakeNotes.deletedAt)
      )
    )
    .orderBy(desc(mistakeNotes.createdAt))
    .limit(k);
  return rows.map((r) => ({
    mistakeId: r.id,
    classId: r.classId,
    title: r.title,
    unit: r.unit,
    difficulty: r.difficulty,
    bodySnippet: r.bodyMarkdown ?? "",
    createdAt: r.createdAt,
  }));
}

async function loadVectorMistakes(
  userId: string,
  queryEmbedding: number[],
  k: number
): Promise<FanoutMistake[]> {
  const vec = `[${queryEmbedding.join(",")}]`;
  const rowsRes = await db.execute<{
    mistake_id: string;
    class_id: string | null;
    title: string;
    unit: string | null;
    difficulty: string | null;
    body_markdown: string | null;
    created_at: Date | string;
    distance: number;
  }>(sql`
    SELECT DISTINCT ON (mn.id)
      mn.id AS mistake_id,
      mn.class_id AS class_id,
      mn.title AS title,
      mn.unit AS unit,
      mn.difficulty AS difficulty,
      mn.body_markdown AS body_markdown,
      mn.created_at AS created_at,
      (mc.embedding <=> ${vec}::vector(1536)) AS distance
    FROM mistake_note_chunks mc
    JOIN mistake_notes mn ON mn.id = mc.mistake_id
    WHERE mc.user_id = ${userId}
      AND mn.deleted_at IS NULL
    ORDER BY mn.id, mc.embedding <=> ${vec}::vector(1536)
    LIMIT ${k * 4}
  `);
  const raw = (rowsRes as unknown as {
    rows: Array<{
      mistake_id: string;
      class_id: string | null;
      title: string;
      unit: string | null;
      difficulty: string | null;
      body_markdown: string | null;
      created_at: Date | string;
      distance: number;
    }>;
  }).rows ?? [];
  // Re-sort by distance ascending across the de-duped mistake set, then
  // cap at k. The DISTINCT ON above gives us the best chunk per mistake.
  raw.sort((a, b) => Number(a.distance) - Number(b.distance));
  return raw.slice(0, k).map((r) => ({
    mistakeId: r.mistake_id,
    classId: r.class_id,
    title: r.title,
    unit: r.unit,
    difficulty: r.difficulty,
    bodySnippet: r.body_markdown ?? "",
    createdAt:
      r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}

async function loadSyllabusChunksByClass(
  userId: string,
  classId: string,
  queryEmbedding: number[],
  k: number
): Promise<FanoutSyllabusChunk[]> {
  const vec = `[${queryEmbedding.join(",")}]`;
  // Fetch more than k so dedup-by-syllabus_id can still return k distinct
  // syllabi when available.
  const rowsRes = await db.execute<{
    chunk_id: string;
    syllabus_id: string;
    class_id: string | null;
    syllabus_title: string;
    chunk_text: string;
    distance: number;
  }>(sql`
    SELECT
      sc.id AS chunk_id,
      sc.syllabus_id AS syllabus_id,
      s.class_id AS class_id,
      s.title AS syllabus_title,
      sc.chunk_text AS chunk_text,
      (sc.embedding <=> ${vec}::vector(1536)) AS distance
    FROM syllabus_chunks sc
    JOIN syllabi s ON s.id = sc.syllabus_id
    WHERE sc.user_id = ${userId}
      AND s.class_id = ${classId}
      AND s.deleted_at IS NULL
    ORDER BY sc.embedding <=> ${vec}::vector(1536)
    LIMIT ${k * 3}
  `);
  return dedupSyllabusChunks(parseSyllabusRows(rowsRes), k);
}

async function loadVectorSyllabusChunks(
  userId: string,
  queryEmbedding: number[],
  k: number
): Promise<FanoutSyllabusChunk[]> {
  const vec = `[${queryEmbedding.join(",")}]`;
  const rowsRes = await db.execute<{
    chunk_id: string;
    syllabus_id: string;
    class_id: string | null;
    syllabus_title: string;
    chunk_text: string;
    distance: number;
  }>(sql`
    SELECT
      sc.id AS chunk_id,
      sc.syllabus_id AS syllabus_id,
      s.class_id AS class_id,
      s.title AS syllabus_title,
      sc.chunk_text AS chunk_text,
      (sc.embedding <=> ${vec}::vector(1536)) AS distance
    FROM syllabus_chunks sc
    JOIN syllabi s ON s.id = sc.syllabus_id
    WHERE sc.user_id = ${userId}
      AND s.deleted_at IS NULL
    ORDER BY sc.embedding <=> ${vec}::vector(1536)
    LIMIT ${k * 3}
  `);
  return dedupSyllabusChunks(parseSyllabusRows(rowsRes), k);
}

function parseSyllabusRows(
  rowsRes: unknown
): FanoutSyllabusChunk[] {
  const raw = (rowsRes as {
    rows: Array<{
      chunk_id: string;
      syllabus_id: string;
      class_id: string | null;
      syllabus_title: string;
      chunk_text: string;
      distance: number;
    }>;
  }).rows ?? [];
  return raw.map((r) => ({
    chunkId: r.chunk_id,
    syllabusId: r.syllabus_id,
    classId: r.class_id,
    syllabusTitle: r.syllabus_title,
    chunkText: r.chunk_text,
    similarity: distanceToSimilarity(Number(r.distance)),
  }));
}

// Dedup §4.5 — at most one chunk per syllabus_id, in similarity-rank
// order. Caps at k.
function dedupSyllabusChunks(
  rows: FanoutSyllabusChunk[],
  k: number
): FanoutSyllabusChunk[] {
  const seen = new Set<string>();
  const out: FanoutSyllabusChunk[] = [];
  for (const r of rows) {
    if (seen.has(r.syllabusId)) continue;
    seen.add(r.syllabusId);
    out.push(r);
    if (out.length >= k) break;
  }
  return out;
}

async function safelyFetchEvents(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarEvent[]> {
  try {
    return await fetchUpcomingEvents(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "calendar_events" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchTasks(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarTask[]> {
  try {
    return await fetchUpcomingTasks(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "calendar_tasks" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchMsEvents(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarEvent[]> {
  try {
    return await fetchMsUpcomingEvents(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "ms_calendar_events" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchMsTasks(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarTask[]> {
  try {
    return await fetchMsUpcomingTasks(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "ms_calendar_tasks" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchIcalEvents(
  userId: string,
  days: number,
  max: number
): Promise<DraftCalendarEvent[]> {
  try {
    return await fetchUpcomingIcalEvents(userId, { days, max });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "ical_events" },
      user: { id: userId },
    });
    return [];
  }
}

async function safelyFetchSteadiiAssignments(
  userId: string,
  days: number,
  max: number
): Promise<FanoutSteadiiAssignment[]> {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: assignments.id,
        title: assignments.title,
        dueAt: assignments.dueAt,
        status: assignments.status,
        priority: assignments.priority,
        classId: assignments.classId,
        className: classes.name,
      })
      .from(assignments)
      .leftJoin(
        classes,
        and(eq(classes.id, assignments.classId), isNull(classes.deletedAt))
      )
      .where(
        and(
          eq(assignments.userId, userId),
          isNull(assignments.deletedAt),
          gte(assignments.dueAt, now),
          lt(assignments.dueAt, end)
        )
      )
      .limit(max);
    return rows
      .filter((r): r is typeof r & { dueAt: Date } => r.dueAt instanceof Date)
      .map((r) => ({
        id: r.id,
        classId: r.classId,
        className: r.className,
        title: r.title,
        due: r.dueAt.toISOString().slice(0, 10),
        status: r.status,
        priority: r.priority,
      }))
      .sort((a, b) => a.due.localeCompare(b.due));
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source: "calendar_steadii" },
      user: { id: userId },
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type Timed<T> = { value: T; elapsed: number; timedOut: boolean };

async function timed<T>(
  source: string,
  fn: () => Promise<T>,
  timeouts: string[]
): Promise<Timed<T>> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const empty: T = emptyForSource(source) as T;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          timeouts.push(source);
          resolve(empty);
        }, SOURCE_TIMEOUT_MS);
      }),
    ]);
    return { value, elapsed: Date.now() - startedAt, timedOut: false };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { feature: "email_fanout", source },
    });
    return { value: empty, elapsed: Date.now() - startedAt, timedOut: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function emptyForSource(source: string): unknown {
  switch (source) {
    case "mistakes":
      return [] as FanoutMistake[];
    case "syllabus":
      return [] as FanoutSyllabusChunk[];
    case "emails":
      return { results: [] as SimilarEmail[], totalCandidates: 0 };
    case "calendar":
      return {
        events: [] as DraftCalendarEvent[],
        tasks: [] as DraftCalendarTask[],
        assignments: [] as FanoutSteadiiAssignment[],
      };
    default:
      return null;
  }
}

function distanceToSimilarity(distance: number): number {
  const sim = 1 - distance / 2;
  if (!Number.isFinite(sim)) return 0;
  if (sim < 0) return 0;
  if (sim > 1) return 1;
  return sim;
}
